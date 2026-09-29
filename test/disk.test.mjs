import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, link, symlink, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startScan, findNode, removeNode, replaceNode, toJson, fromJson, buildView, createDiskRules,
  normalizePath, isInside, makeDir, addFile, collapseSmall, addShadowStorage,
} from '../lib/disk.mjs';

const KB = 1024;
const MIN_ITEM = 100 * KB;

async function fixture() {
  const root = normalizePath(await mkdtemp(join(tmpdir(), 'trashguard-')));
  await mkdir(join(root, 'store', 'dyb'), { recursive: true });
  await mkdir(join(root, 'lille'));
  await writeFile(join(root, 'store', 'film.bin'), Buffer.alloc(300 * KB));
  await writeFile(join(root, 'store', 'dyb', 'arkiv.bin'), Buffer.alloc(200 * KB));
  await writeFile(join(root, 'store', 'note.txt'), Buffer.alloc(10 * KB));
  await writeFile(join(root, 'lille', 'a.txt'), Buffer.alloc(5 * KB));
  await link(join(root, 'store', 'film.bin'), join(root, 'store', 'film-hardlink.bin'));
  await symlink(join(root, 'store'), join(root, 'genvej'), 'junction');
  return root;
}

test('scanning: hardlinks én gang, junctions følges ikke, små mapper foldes ind', async () => {
  const root = await fixture();
  try {
    const scan = startScan(root, { concurrency: 4, minItemBytes: MIN_ITEM });
    const { tree, stats, stopped } = await scan.done;
    assert.equal(stopped, false);
    assert.equal(stats.files, 4);
    assert.equal(tree.size, (300 + 200 + 10 + 5) * KB);
    const store = findNode(tree, root, `${root}\\STORE`);
    assert.equal(store.size, 510 * KB);
    assert.equal(store.smallCount, 1);
    assert.ok(findNode(tree, root, `${root}\\store\\dyb\\arkiv.bin`));
    assert.equal(findNode(tree, root, `${root}\\lille`), null, 'lille mappe foldet ind');
    assert.equal(tree.smallSize, 5 * KB);
    assert.equal(findNode(tree, root, `${root}\\genvej`), null, 'junction ikke fulgt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanning: låste filer (som pagefile.sys) slås op og tælles med', async () => {
  const root = normalizePath(await mkdtemp(join(tmpdir(), 'trashguard-')));
  await writeFile(join(root, 'laast.bin'), Buffer.alloc(200 * KB));
  // Sådan svarer Windows for pagefile.sys og hiberfil.sys; en test kan ikke låse en fil på den måde.
  const deniedForLocked = (path, options) => (path.endsWith('laast.bin')
    ? Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    : lstat(path, options));
  try {
    let asked = null;
    const scan = startScan(root, {
      concurrency: 2, minItemBytes: MIN_ITEM, statFile: deniedForLocked,
      resolveUnreadable: async (wanted) => {
        asked = wanted;
        return { [root]: { 'laast.bin': 200 * KB } };
      },
    });
    const { tree, stats } = await scan.done;
    assert.deepEqual(asked, { [root]: ['laast.bin'] });
    assert.equal(tree.size, 200 * KB);
    assert.equal(stats.unreadable, 0);
    assert.ok(findNode(tree, root, `${root}\\laast.bin`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('gendannelsespunkter lægges i System Volume Information og tæller i drevets total', () => {
  const tree = makeDir('C:\\');
  addShadowStorage(tree, 5000, 100);
  addShadowStorage(makeDir('D:\\'), null, 100);
  assert.equal(tree.size, 5000);
  assert.equal(findNode(tree, 'C:\\', 'C:\\System Volume Information\\Gendannelsespunkter').size, 5000);
});

test('træ: fjern og erstat retter størrelser hele vejen op; JSON rundtur', () => {
  const tree = makeDir('C:\\');
  const users = makeDir('Users', tree);
  tree.children.push(users);
  addFile(users, 'a.bin', 500, 100);
  addFile(users, 'b.txt', 50, 100);
  assert.equal(tree.size, 550);
  assert.equal(tree.files, 2);

  const copy = fromJson(JSON.parse(JSON.stringify(toJson(tree))));
  assert.equal(findNode(copy, 'C:\\', 'C:\\Users\\a.bin').size, 500);
  assert.equal(findNode(copy, 'C:\\', 'C:\\Users').parent, copy);

  removeNode(findNode(tree, 'C:\\', 'C:\\Users\\a.bin'));
  assert.equal(tree.size, 50);
  const fresh = makeDir('ny');
  addFile(fresh, 'c.bin', 900, 100);
  replaceNode(users, fresh);
  assert.equal(tree.size, 900);
  assert.equal(findNode(tree, 'C:\\', 'C:\\Users\\c.bin').size, 900);
});

test('stier: normalisering og indenfor', () => {
  assert.equal(normalizePath('c:'), 'C:\\');
  assert.equal(normalizePath('c:/Users/Teddy/'), 'C:\\Users\\Teddy');
  assert.equal(isInside('C:\\Users\\Teddy', 'C:\\'), true);
  assert.equal(isInside('C:\\UsersX', 'C:\\Users'), false);
  assert.equal(isInside('c:\\users', 'C:\\Users'), true);
});

const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\Teddy' };
const rules = createDiskRules(
  { lockedTrees: ['%SystemRoot%', '%ProgramFiles%'], lockedExact: ['C:\\Users', '%USERPROFILE%'], lockedRootFolders: ['$Recycle.Bin'] },
  { node_modules: 'npm-pakker', 'AppData\\Local\\Temp': 'Midlertidige filer' },
  env,
);

test('låst: rod, rodfiler, systemtræer, nødvendige mapper; resten er fri', () => {
  assert.equal(rules.lockReason('D:\\', false), 'root');
  assert.equal(rules.lockReason('C:\\pagefile.sys', true), 'rootfile');
  assert.equal(rules.lockReason('C:\\Games', false), null);
  assert.equal(rules.lockReason('C:\\Windows\\WinSxS', false), 'system');
  assert.equal(rules.lockReason('C:\\WindowsApps', false), null);
  assert.equal(rules.lockReason('D:\\$Recycle.Bin\\x', false), 'windowsOwn');
  assert.equal(rules.lockReason('C:\\Users\\Teddy', false), 'needed');
  assert.equal(rules.lockReason('C:\\Users\\Teddy\\Downloads', false), null);
});

test('kendt skrald: navn eller sti-slutning', () => {
  assert.equal(rules.junkText('D:\\kode\\app\\node_modules'), 'npm-pakker');
  assert.equal(rules.junkText('C:\\Users\\Teddy\\AppData\\Local\\Temp'), 'Midlertidige filer');
  assert.equal(rules.junkText('C:\\Temp'), null);
});

test('visning: dybde, "Små filer", "Andet" og arvet skrald', () => {
  const tree = makeDir('D:\\');
  const code = makeDir('node_modules', tree);
  tree.children.push(code);
  const pkg = makeDir('react', code);
  code.children.push(pkg);
  addFile(pkg, 'big.js', 800, 100);
  for (let index = 0; index < 20; index += 1) addFile(tree, `tiny${index}.bin`, 101, 100);
  addFile(tree, 'x.txt', 5, 100);
  collapseSmall(tree, 100);

  const view = buildView(tree, 'D:\\', { depth: 2, minFraction: 0.1, maxChildren: 50, rules });
  assert.equal(view.children[0].kind, 'other', 'størst først: 20 små filer samlet');
  const first = view.children.find((child) => child.name === 'node_modules');
  assert.equal(first.junk, 'npm-pakker');
  assert.equal(first.children[0].inJunk, true);
  assert.equal(first.children[0].children, undefined, 'dybde 2 stopper her');
  const other = view.children.find((child) => child.kind === 'other');
  assert.equal(other.size, 20 * 101 + 5);
  assert.equal(view.size, view.children.reduce((sum, child) => sum + child.size, 0));
});
