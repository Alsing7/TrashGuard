// Disk-fanens server-side: scanninger (gemt pr. rod), udsnit til klienten, genscanning,
// papirkurv og "Åbn i Stifinder". Kun én scanning ad gangen.
import { stat, lstat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  startScan, findNode, removeNode, replaceNode, toJson, fromJson, buildView, normalizePath, isInside, addShadowStorage,
} from './disk.mjs';
import { parseJsonLine } from './parse.mjs';

const BYTES_PER_MB = 1048576;
const FILE_HASH_LENGTH = 16;
const RECYCLE_REASONS = {
  missing: 'Den findes ikke længere.',
  'no-bin-settings': 'Kunne ikke læse papirkurvens indstillinger for drevet, så den bliver ikke rørt.',
  'bin-disabled': 'Papirkurven er slået fra på dette drev. Windows ville slette permanent, så TrashGuard gør det ikke.',
};
const LOCK_REASONS = {
  root: 'Et helt drev kan ikke flyttes til papirkurven.',
  rootfile: "Systemfil i drevets rod, styret af Windows. Dvalefilen (hiberfil.sys) forsvinder med 'powercfg /h off'; sidefilen (pagefile.sys) styres under Avancerede systemindstillinger.",
  system: 'Windows- eller programmappe. Afinstallér programmet i stedet.',
  windowsOwn: "Windows' egen mappe. Den styres af Windows.",
  needed: 'Windows har brug for selve mappen. Indholdet må gerne ryddes.',
};

const lower = (text) => String(text).toLowerCase();

export function createDiskService({ settings, rules, dataDir, recycleScript, sizesScript, runPowerShell, broadcast, onLog }) {
  const indexPath = join(dataDir, 'index.json');
  const minItemBytes = settings.minItemMb * BYTES_PER_MB;
  const scanOptions = { concurrency: settings.concurrency, minItemBytes };
  let index = [];
  const loaded = new Map();
  let active = null;
  let progressTimer = null;

  const ready = readFile(indexPath, 'utf8').then((text) => { index = parseJsonLine(text) ?? []; }, () => {});

  function state() {
    return {
      index,
      active: active && {
        root: active.root, path: active.path, whole: active.path === active.root,
        files: active.scan.stats.files, bytes: active.scan.stats.bytes, startedAt: active.scan.stats.startedAt,
      },
      locks: LOCK_REASONS,
    };
  }

  const publish = () => broadcast('disk', state());
  // Kort hash som filnavn: selve stien kan være for lang til Windows' 260-tegnsgrænse.
  const fileFor = (root) => `${createHash('sha1').update(lower(root)).digest('hex').slice(0, FILE_HASH_LENGTH)}.json`;

  async function loadTree(root) {
    const key = lower(root);
    if (loaded.has(key)) return loaded.get(key);
    const entry = index.find((candidate) => lower(candidate.root) === key);
    if (!entry) return null;
    const tree = fromJson(JSON.parse(await readFile(join(dataDir, entry.file), 'utf8')));
    loaded.set(key, tree);
    return tree;
  }

  async function saveTree(root, tree, meta) {
    await mkdir(dataDir, { recursive: true });
    const file = fileFor(root);
    await writeFile(join(dataDir, file), JSON.stringify(toJson(tree)), 'utf8');
    const previous = index.find((entry) => lower(entry.root) === lower(root));
    const entry = { ...previous, ...meta, root, file, size: tree.size, files: tree.files };
    index = [...index.filter((candidate) => candidate !== previous), entry].sort((a, b) => a.root.localeCompare(b.root));
    await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
    loaded.set(lower(root), tree);
  }

  // Den længste gemte (eller igangværende) rod, som stien ligger i.
  async function scanFor(target) {
    const roots = [...index.map((entry) => entry.root), ...(active ? [active.root] : [])]
      .filter((root) => isInside(target, root))
      .sort((a, b) => b.length - a.length);
    const root = roots[0];
    if (!root) return null;
    const live = active && active.path === active.root && lower(active.root) === lower(root);
    return { root, tree: live ? active.scan.tree : await loadTree(root), live };
  }

  function track(root, path, scan) {
    active = { root, path, scan };
    progressTimer = setInterval(publish, settings.progressMs);
    publish();
  }

  function untrack() {
    clearInterval(progressTimer);
    active = null;
    publish();
  }

  // Slår størrelser på låste filer op via mappeoversigten (ps/sizes.ps1). På et drevs rod også gendannelsespunkter.
  function sizeLookupFor(target) {
    const shadowDrive = /^[A-Z]:\\$/.test(target) ? target.slice(0, 2) : '';
    const lookup = { shadowBytes: null };
    lookup.resolve = async (wanted) => {
      if (!Object.keys(wanted).length && !shadowDrive) return {};
      await mkdir(dataDir, { recursive: true });
      const listFile = join(dataDir, 'ulaeselige.json');
      await writeFile(listFile, JSON.stringify(wanted), 'utf8');
      const output = await runPowerShell(sizesScript, ['-ListFile', listFile, ...(shadowDrive ? ['-ShadowDrive', shadowDrive] : [])]);
      const result = parseJsonLine(output) ?? {};
      lookup.shadowBytes = result.shadowBytes ?? null;
      return result.sizes ?? {};
    };
    return lookup;
  }

  function scanWithLookup(target) {
    const lookup = sizeLookupFor(target);
    const scan = startScan(target, { ...scanOptions, resolveUnreadable: lookup.resolve });
    scan.finished = scan.done.then((result) => {
      if (!result.stopped) addShadowStorage(result.tree, lookup.shadowBytes, minItemBytes);
      return result;
    });
    return scan;
  }

  async function existingDirectory(target) {
    const info = await stat(target).catch(() => null);
    return Boolean(info?.isDirectory());
  }

  // Scanner en mappe i en scanning igen og sætter resultatet ind i træet.
  async function rescanPath(target) {
    const found = await scanFor(target);
    if (!found || found.live) return 'Scan hele drevet først.';
    const node = findNode(found.tree, found.root, target);
    if (!node) return 'Den findes ikke i scanningen. Scan mappen over den igen.';
    const info = await lstat(target).catch(() => null);
    if (!info) {
      removeNode(node);
    } else if (!node.dir) {
      replaceNode(node, { name: node.name, dir: false, size: info.size, files: 1 });
    } else {
      const scan = scanWithLookup(target);
      track(found.root, target, scan);
      const { tree: fresh, stopped } = await scan.finished.finally(untrack);
      if (stopped) return 'Genscanning stoppet.';
      if (node === found.tree) {
        fresh.name = found.root;
        loaded.set(lower(found.root), fresh);
        found.tree = fresh;
      } else {
        replaceNode(node, fresh);
      }
    }
    await saveTree(found.root, found.tree, {});
    return null;
  }

  function resolveTarget(body) {
    if (typeof body.path !== 'string' || !body.path.trim()) return null;
    return normalizePath(body.path);
  }

  const routes = {
    '/api/disk/scan': async (body) => {
      await ready;
      const target = resolveTarget(body);
      if (!target || !(await existingDirectory(target))) return [400, { error: 'Mappen findes ikke.' }];
      if (active) return [409, { error: 'En scanning kører allerede.' }];
      const scan = scanWithLookup(target);
      track(target, target, scan);
      scan.finished
        .then(({ tree, stats, stopped }) => stopped || saveTree(target, tree, {
          scannedAt: Date.now(), durationMs: Date.now() - stats.startedAt,
          denied: stats.denied, deniedPaths: stats.deniedPaths, unreadable: stats.unreadable,
        }))
        .catch((error) => broadcast('problem', { message: `Scanningen kunne ikke gemmes: ${error.message}` }))
        .finally(untrack);
      return [200, { message: `Scanner ${target}` }];
    },

    '/api/disk/stop': async () => {
      if (!active) return [400, { error: 'Der kører ingen scanning.' }];
      active.scan.stop();
      return [200, { message: 'Scanningen stopper. Den gamle scanning bruges igen.' }];
    },

    '/api/disk/view': async (body) => {
      await ready;
      const target = resolveTarget(body);
      const found = target && await scanFor(target);
      if (!found) return [404, { error: 'Ikke scannet endnu.' }];
      const node = findNode(found.tree, found.root, target);
      if (!node) return [404, { error: 'Findes ikke i scanningen. Scan mappen over den igen.' }];
      const depth = Math.min(settings.maxDepth, Math.max(1, Number(body.depth) || 1));
      const view = buildView(node, target, { depth, minFraction: settings.minFraction, maxChildren: settings.maxChildren, rules });
      return [200, { root: found.root, live: found.live, view }];
    },

    '/api/disk/rescan': async (body) => {
      await ready;
      const target = resolveTarget(body);
      if (!target) return [400, { error: 'Ukendt sti.' }];
      if (active) return [409, { error: 'En scanning kører allerede.' }];
      const problem = await rescanPath(target);
      return problem ? [400, { error: problem }] : [200, { message: `Scannet igen: ${target}` }];
    },

    '/api/disk/recycle': async (body) => {
      await ready;
      const target = resolveTarget(body);
      if (!target) return [400, { error: 'Ukendt sti.' }];
      if (active) return [409, { error: 'Vent til scanningen er færdig.' }];
      const found = await scanFor(target);
      const node = found && findNode(found.tree, found.root, target);
      if (!node) return [404, { error: 'Findes ikke i scanningen.' }];
      const lock = rules.lockReason(target, !node.dir);
      if (lock) return [400, { error: LOCK_REASONS[lock] }];

      // Mål den friske størrelse, så papirkurv-tjekket ikke bygger på en gammel scanning.
      const problem = await rescanPath(target);
      if (problem) return [400, { error: problem }];
      const fresh = findNode(found.tree, found.root, target);
      if (!fresh) return [404, { error: 'Den findes ikke længere.' }];

      const output = await runPowerShell(recycleScript, ['-Path', target, '-Bytes', String(fresh.size)], settings.recycleTimeoutMs);
      const result = parseJsonLine(output) ?? { ok: false, reason: 'failed' };
      if (!result.ok) {
        if (result.reason === 'failed') {
          await rescanPath(target);
          return [500, { error: `Windows kunne ikke flytte det hele (fejlkode ${result.code}). Noget er nok i brug. Det, der blev flyttet, ligger i papirkurven.` }];
        }
        if (result.reason === 'too-big') {
          return [400, { error: `For stor til papirkurven (maks. ${Math.round(result.maxBytes / BYTES_PER_MB / 1024)} GB på dette drev). Windows ville slette den permanent, så TrashGuard gør det ikke. Slet den selv, hvis du er sikker.` }];
        }
        return [400, { error: RECYCLE_REASONS[result.reason] ?? 'Papirkurven afviste den.' }];
      }

      removeNode(fresh);
      await saveTree(found.root, found.tree, {});
      const label = `Flyttede til papirkurven: ${target} (${formatSize(fresh.size)})`;
      onLog({ type: 'recycle', label, target: { path: target }, undoable: false });
      publish();
      return [200, { message: label }];
    },

    '/api/disk/reveal': async (body) => {
      const target = resolveTarget(body);
      const info = target && await lstat(target).catch(() => null);
      if (!info) return [404, { error: 'Den findes ikke længere.' }];
      // Stier kan ikke indeholde ", så ordret citering er sikker. Explorer starter som din almindelige bruger.
      execFile('explorer.exe', [`/select,"${target}"`], { windowsVerbatimArguments: true }, () => {});
      return [200, { message: 'Åbnet i Stifinder.' }];
    },
  };

  return { routes, state, ready };
}

function formatSize(bytes) {
  const gigabytes = bytes / BYTES_PER_MB / 1024;
  return gigabytes >= 1 ? `${gigabytes.toFixed(1).replace('.', ',')} GB` : `${Math.round(bytes / BYTES_PER_MB)} MB`;
}

