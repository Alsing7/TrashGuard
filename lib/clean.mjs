// Ryd op: kendte cache-mapper (kendt-bloat.json, `clean`) måles og tømmes til papirkurven.
// Mapperne bliver stående; deres børn flyttes. Klienten sender rækkenavne, aldrig stier.
import { readdir, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { startScan, normalizePath, joinPath } from './disk.mjs';
import { expandEnv } from './parse.mjs';
import { recycleError, recycleList, formatSize } from './disk-service.mjs';
import { text, inLang } from './text.mjs';

// Ægte mappe: findes, og hverken den eller en mappe over den er en junction eller symlink.
// Ellers ligger filerne måske på et andet drev, end stien siger, og papirkurv-tjekket ser det forkerte drev.
async function isRealDir(path) {
  const info = await lstat(path).catch(() => null);
  if (!info?.isDirectory()) return false;
  const real = await realpath(path).catch(() => null);
  return Boolean(real) && normalizePath(real).toLowerCase() === path.toLowerCase();
}

// Et `*` matcher ét stiled: alle ægte mapper på det niveau.
async function expandPattern(pattern) {
  let bases = [''];
  for (const part of pattern.split('\\')) {
    if (part !== '*') {
      bases = bases.map((base) => (base ? joinPath(base, part) : `${part}\\`));
      continue;
    }
    const next = [];
    for (const base of bases) {
      const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink()) next.push(joinPath(base, entry.name));
    }
    bases = next;
  }
  return bases;
}

export async function expandRows(rows, { env, rules }) {
  const expanded = [];
  for (const { name, text: description, paths } of rows) {
    const found = [];
    for (const pattern of paths) {
      const absolute = expandEnv(pattern, env);
      // En variabel, der ikke findes, efterlader %X%, som ellers ville blive en sti under cwd.
      if (!/^[a-z]:\\/i.test(absolute)) continue;
      for (const candidate of await expandPattern(absolute)) {
        const path = normalizePath(candidate);
        if (rules.lockReason(path, false) === null && await isRealDir(path)) found.push(path);
      }
    }
    // key er rækkens faste id (klienten sender det tilbage); name kan være { da, en }.
    if (found.length) expanded.push({ key: inLang(name, 'da'), name, text: description, paths: [...new Set(found)] });
  }
  return expanded;
}

export async function listChildren(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => !entry.isSymbolicLink()).map((entry) => join(dir, entry.name));
}

export function createCleanService({ rows, rules, scanOptions, recycleScript, dataDir, runPowerShell, onLog, timeoutMs, env = process.env }) {
  let busy = false;

  const measure = async (path) => (await startScan(path, scanOptions).done).tree;

  async function measuredRows() {
    const result = [];
    for (const row of await expandRows(rows, { env, rules })) {
      let size = 0;
      let files = 0;
      for (const path of row.paths) {
        const tree = await measure(path);
        size += tree.size;
        files += tree.files;
      }
      result.push({ ...row, size, files });
    }
    return result.sort((a, b) => b.size - a.size);
  }

  const rowSize = async (row) => {
    let size = 0;
    for (const path of row.paths) size += (await measure(path)).size;
    return size;
  };

  // Ét kald pr. mappe (én mappe er altid på ét drev). En afvisning stopper resten.
  // Rækken logges, så snart den er flyttet, så loggen passer, selv om en senere række går galt.
  async function recycleRow(row) {
    const before = await rowSize(row);
    let failed = 0;
    let refusal = null;
    let status = 400;
    for (const path of row.paths) {
      const children = (await listChildren(path)).filter((child) => rules.lockReason(child, false) === null);
      if (!children.length) continue;
      let result;
      try {
        result = await recycleList({ runPowerShell, recycleScript, dataDir, timeoutMs }, children, (await measure(path)).size);
      } catch {
        refusal = text('PowerShell svarede ikke eller gik ned undervejs. Det, der nåede at blive flyttet, ligger i papirkurven. Mål igen og prøv resten.', 'PowerShell did not answer or crashed along the way. What was moved is in the Recycle Bin. Measure again and try the rest.');
        status = 500;
        break;
      }
      if (result.reason === 'missing') continue;
      refusal = recycleError(result);
      if (refusal) break;
      failed += result.failed;
    }
    const movedBytes = Math.max(0, before - await rowSize(row));
    if (movedBytes > 0) {
      const label = text(`Ryddede op til papirkurven: ${inLang(row.name, 'da')} (${formatSize(movedBytes)})`, `Cleaned up to the Recycle Bin: ${inLang(row.name, 'en')} (${formatSize(movedBytes, 'en')})`);
      onLog({ type: 'recycle', label, target: { key: row.key }, undoable: false });
    }
    return { movedBytes, failed, refusal, status };
  }

  async function exclusive(work) {
    if (busy) return [409, { error: text('Ryd op er allerede i gang.', 'Clean up is already running.') }];
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  }

  const routes = {
    '/api/clean/list': () => exclusive(async () => [200, { rows: await measuredRows() }]),

    '/api/clean/run': (body) => exclusive(async () => {
      const names = body.names;
      if (!Array.isArray(names) || !names.length || !names.every((name) => typeof name === 'string')) return [400, { error: text('Vælg mindst én.', 'Choose at least one.') }];
      const before = await measuredRows();
      const chosen = before.filter((row) => names.includes(row.key));
      if (chosen.length !== new Set(names).size) return [400, { error: text('Ukendt eller tom placering. Mål igen.', 'Unknown or empty location. Measure again.') }];

      let movedBytes = 0;
      let failed = 0;
      for (const row of chosen) {
        const result = await recycleRow(row);
        movedBytes += result.movedBytes;
        failed += result.failed;
        if (result.refusal) return [result.status, { error: result.refusal, rows: await measuredRows() }];
      }
      const message = text(`Flyttede ${formatSize(movedBytes)} til papirkurven.`, `Moved ${formatSize(movedBytes, 'en')} to the Recycle Bin.`);
      if (failed > 0) {
        message.da += ` ${failed} ting var i brug: luk programmet og prøv igen.`;
        message.en += ` ${failed} ${failed === 1 ? 'item was' : 'items were'} in use: close the program and try again.`;
      }
      return [200, { message, rows: await measuredRows() }];
    }),
  };

  return { routes };
}
