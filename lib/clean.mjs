// Ryd op: kendte cache-mapper (kendt-bloat.json, `clean`) måles og tømmes til papirkurven.
// Mapperne bliver stående; deres børn flyttes. Klienten sender rækkenavne, aldrig stier.
import { readdir, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startScan, normalizePath, joinPath } from './disk.mjs';
import { expandEnv } from './parse.mjs';
import { recycleError, recycleList, formatSize } from './disk-service.mjs';

// Ægte mappe: findes og er ikke en junction eller symlink.
async function isRealDir(path) {
  const info = await lstat(path).catch(() => null);
  return Boolean(info?.isDirectory() && !info.isSymbolicLink());
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
  for (const { name, text, paths } of rows) {
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
    if (found.length) expanded.push({ name, text, paths: [...new Set(found)] });
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

  // Ét kald pr. mappe (én mappe er altid på ét drev). En afvisning stopper resten.
  async function recycleRows(chosen) {
    const listFile = join(dataDir, 'ryd-op.json');
    await mkdir(dataDir, { recursive: true });
    let failed = 0;
    for (const row of chosen) {
      for (const path of row.paths) {
        const children = (await listChildren(path)).filter((child) => rules.lockReason(child, false) === null);
        if (!children.length) continue;
        const result = await recycleList({ runPowerShell, recycleScript, listFile, timeoutMs }, children, (await measure(path)).size);
        if (result.reason === 'missing') continue;
        const refusal = recycleError(result);
        if (refusal) return { refusal, failed };
        failed += result.failed;
      }
    }
    return { refusal: null, failed };
  }

  async function exclusive(work) {
    if (busy) return [409, { error: 'Ryd op er allerede i gang.' }];
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
      if (!Array.isArray(names) || !names.length || !names.every((name) => typeof name === 'string')) return [400, { error: 'Vælg mindst én.' }];
      const before = await measuredRows();
      const chosen = before.filter((row) => names.includes(row.name));
      if (chosen.length !== new Set(names).size) return [400, { error: 'Ukendt eller tom placering. Mål igen.' }];

      const { refusal, failed } = await recycleRows(chosen);
      const after = await measuredRows();
      const sizeOf = (list) => list.filter((row) => names.includes(row.name)).reduce((sum, row) => sum + row.size, 0);
      const movedBytes = Math.max(0, sizeOf(before) - sizeOf(after));
      if (movedBytes > 0) {
        onLog({ type: 'recycle', label: `Ryddede op til papirkurven: ${chosen.map((row) => row.name).join(', ')} (${formatSize(movedBytes)})`, target: { names }, undoable: false });
      }
      if (refusal) return [400, { error: refusal, rows: after }];
      const busyText = failed > 0 ? ` ${failed} ting var i brug: luk programmet og prøv igen.` : '';
      return [200, { message: `Flyttede ${formatSize(movedBytes)} til papirkurven.${busyText}`, rows: after }];
    }),
  };

  return { routes };
}
