// Disk-scanning: træ over mapper og store filer, bygget parallelt og tegnet løbende.
// Små filer og små mapper samles pr. mappe, så træet kan gemmes og tegnes.
import { opendir, lstat } from 'node:fs/promises';
import { win32 } from 'node:path';
import { expandEnv } from './parse.mjs';

const OPENDIR_BUFFER = 512;

const lower = (text) => String(text).toLowerCase();

export function joinPath(parent, name) {
  return parent.endsWith('\\') ? parent + name : `${parent}\\${name}`;
}

// "c:" og "C:/x/" -> "C:\" og "C:\x". Store bogstaver på drevet, ingen afsluttende \ undtagen i roden.
// Et bart "C:" er roden (Windows ville ellers tolke det som den aktuelle mappe på C:).
export function normalizePath(input) {
  const text = String(input).trim();
  const resolved = win32.resolve(/^[a-z]:$/i.test(text) ? `${text}\\` : text);
  const trimmed = /^[a-z]:\\$/i.test(resolved) ? resolved : resolved.replace(/\\+$/, '');
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function isInside(target, root) {
  const targetLower = lower(target);
  const rootLower = lower(root);
  return targetLower === rootLower || targetLower.startsWith(rootLower.endsWith('\\') ? rootLower : `${rootLower}\\`);
}

// ---------- Træet ----------

export function makeDir(name, parent = null) {
  return { name, dir: true, size: 0, files: 0, smallSize: 0, smallCount: 0, children: [], parent };
}

function grow(node, size, files) {
  for (let current = node; current; current = current.parent) {
    current.size += size;
    current.files += files;
  }
}

export function addFile(dirNode, name, size, minItemBytes) {
  if (size >= minItemBytes) dirNode.children.push({ name, dir: false, size, files: 1, parent: dirNode });
  else {
    dirNode.smallSize += size;
    dirNode.smallCount += 1;
  }
  grow(dirNode, size, 1);
}

// Mapper under grænsen foldes ind i forælderens "Små filer". Roden foldes aldrig.
export function collapseSmall(node, minItemBytes) {
  for (const child of node.children) if (child.dir) collapseSmall(child, minItemBytes);
  node.children = node.children.filter((child) => {
    if (!child.dir || child.size >= minItemBytes) return true;
    node.smallSize += child.size;
    node.smallCount += child.files;
    return false;
  });
}

export function findNode(tree, rootPath, targetPath) {
  if (lower(targetPath) === lower(rootPath)) return tree;
  const parts = targetPath.slice(rootPath.length).split('\\').filter(Boolean);
  let current = tree;
  for (const part of parts) {
    current = current.children?.find((child) => lower(child.name) === lower(part));
    if (!current) return null;
  }
  return current;
}

export function removeNode(node) {
  const parent = node.parent;
  if (!parent) return;
  parent.children = parent.children.filter((child) => child !== node);
  grow(parent, -node.size, -node.files);
}

export function replaceNode(oldNode, freshNode) {
  const parent = oldNode.parent;
  freshNode.name = oldNode.name;
  if (!parent) return freshNode;
  removeNode(oldNode);
  freshNode.parent = parent;
  parent.children.push(freshNode);
  grow(parent, freshNode.size, freshNode.files);
  return freshNode;
}

export function toJson(node) {
  if (!node.dir) return { n: node.name, s: node.size };
  return { n: node.name, s: node.size, f: node.files, ss: node.smallSize, sc: node.smallCount, c: node.children.map(toJson) };
}

export function fromJson(data, parent = null) {
  if (!data.c) return { name: data.n, dir: false, size: data.s, files: 1, parent };
  const node = { name: data.n, dir: true, size: data.s, files: data.f, smallSize: data.ss, smallCount: data.sc, children: [], parent };
  node.children = data.c.map((child) => fromJson(child, node));
  return node;
}

// ---------- Scanning ----------

// Parallel scanning af en mappe. Junctions og symlinks følges ikke; hardlinks tælles én gang.
export function startScan(rootPath, { concurrency, minItemBytes }) {
  const tree = makeDir(rootPath);
  const stats = { files: 0, bytes: 0, denied: 0, startedAt: Date.now() };
  const queue = [[rootPath, tree]];
  const seenLinks = new Set();
  let active = 0;
  let stopped = false;

  async function scanDir(dirPath, node) {
    let handle;
    try {
      handle = await opendir(dirPath, { bufferSize: OPENDIR_BUFFER });
    } catch {
      stats.denied += 1;
      return;
    }
    const sizeJobs = [];
    try {
      for await (const entry of handle) {
        if (stopped) break;
        if (entry.isSymbolicLink()) continue;
        const fullPath = joinPath(dirPath, entry.name);
        if (entry.isDirectory()) {
          const child = makeDir(entry.name, node);
          node.children.push(child);
          queue.push([fullPath, child]);
        } else if (entry.isFile()) {
          sizeJobs.push(lstat(fullPath, { bigint: true }).then((info) => countFile(node, entry.name, info), () => {}));
        }
      }
    } catch {
      stats.denied += 1;
    }
    await Promise.all(sizeJobs);
  }

  function countFile(node, name, info) {
    if (info.nlink > 1n) {
      const linkKey = `${info.dev}:${info.ino}`;
      if (seenLinks.has(linkKey)) return;
      seenLinks.add(linkKey);
    }
    const size = Number(info.size);
    stats.files += 1;
    stats.bytes += size;
    addFile(node, name, size, minItemBytes);
  }

  const done = new Promise((resolve) => {
    function pump() {
      while (!stopped && active < concurrency && queue.length) {
        const [dirPath, node] = queue.pop();
        active += 1;
        scanDir(dirPath, node).finally(() => {
          active -= 1;
          pump();
        });
      }
      if (!active && (stopped || !queue.length)) {
        if (!stopped) collapseSmall(tree, minItemBytes);
        resolve({ tree, stats, stopped });
      }
    }
    pump();
  });

  return { tree, stats, done, stop: () => { stopped = true; } };
}

// ---------- Regler: låst og kendt skrald ----------

export function createDiskRules({ lockedTrees, lockedExact, lockedRootFolders }, junkFolders, env = process.env) {
  const expand = (list) => list.map((entry) => lower(normalizePath(expandEnv(entry, env))));
  const trees = expand(lockedTrees);
  const exact = new Set(expand(lockedExact));
  const rootFolders = new Set(lockedRootFolders.map(lower));
  const junk = Object.entries(junkFolders ?? {}).map(([pattern, text]) => [lower(pattern), text]);

  return {
    // null = må flyttes til papirkurven. Ellers en kort årsag, som klienten oversætter.
    lockReason(targetPath, isFile) {
      const target = lower(targetPath);
      if (/^[a-z]:\\$/.test(target)) return 'root';
      const parts = target.split('\\');
      if (parts.length === 2 && isFile) return 'rootfile';
      if (rootFolders.has(parts[1])) return 'system';
      if (trees.some((tree) => target === tree || target.startsWith(`${tree}\\`))) return 'system';
      if (exact.has(target)) return 'needed';
      return null;
    },
    // Mønster med \ matcher slutningen af stien; ellers mappens navn.
    junkText(targetPath) {
      const target = lower(targetPath);
      const name = target.split('\\').pop();
      return junk.find(([pattern]) => (pattern.includes('\\') ? target.endsWith(`\\${pattern}`) : name === pattern))?.[1] ?? null;
    },
  };
}

// ---------- Visning ----------

// Et beskåret udsnit til klienten: `depth` niveauer, og ting under `minFraction` af udsnittet samles i "Andet".
export function buildView(node, nodePath, { depth, minFraction, maxChildren, rules }) {
  const threshold = node.size * minFraction;

  function describe(current, currentPath, depthLeft, inJunk) {
    const junk = current.dir ? rules.junkText(currentPath) : null;
    const item = {
      name: current.name, path: currentPath, size: current.size, files: current.files,
      kind: current.dir ? 'dir' : 'file',
      junk, inJunk: inJunk || Boolean(junk),
      locked: rules.lockReason(currentPath, !current.dir),
    };
    if (!current.dir || depthLeft === 0) return item;

    const shown = current.children
      .filter((child) => child.size >= threshold && child.size > 0)
      .sort((a, b) => b.size - a.size)
      .slice(0, maxChildren);
    item.children = shown.map((child) => describe(child, joinPath(currentPath, child.name), depthLeft - 1, item.inJunk));
    let restSize = current.size - shown.reduce((sum, child) => sum + child.size, 0);
    let restCount = current.children.length - shown.length;
    if (current.smallSize >= threshold && current.smallSize > 0) {
      item.children.push({ kind: 'small', name: 'Små filer', path: currentPath, size: current.smallSize, files: current.smallCount, inJunk: item.inJunk });
      restSize -= current.smallSize;
    } else {
      restCount += current.smallCount;
    }
    if (restSize >= threshold && restSize > 0) {
      item.children.push({ kind: 'other', name: 'Andet', path: currentPath, size: restSize, files: restCount, inJunk: item.inJunk });
    }
    item.children.sort((a, b) => b.size - a.size);
    return item;
  }

  return describe(node, nodePath, depth, false);
}
