import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandRows, listChildren, createCleanService } from '../lib/clean.mjs';
import { createDiskRules, normalizePath } from '../lib/disk.mjs';

const LOCKS = { lockedTrees: ['%LOCALAPPDATA%\\Låst'], lockedExact: [], lockedRootFolders: [] };

async function fixture() {
  const root = normalizePath(await mkdtemp(join(tmpdir(), 'trashguard-ryd-')));
  const data = join(root, 'App', 'User Data');
  await mkdir(join(data, 'Default', 'Cache'), { recursive: true });
  await mkdir(join(data, 'Profile 1', 'Cache'), { recursive: true });
  await symlink(join(data, 'Default'), join(data, 'Link'), 'junction');
  await writeFile(join(data, 'Default', 'Cache', 'a.bin'), Buffer.alloc(1000));
  await writeFile(join(data, 'Profile 1', 'Cache', 'b.bin'), Buffer.alloc(500));
  await mkdir(join(root, 'Låst', 'Cache'), { recursive: true });
  await mkdir(join(root, 'Ægte'));
  await symlink(join(root, 'Ægte'), join(root, 'Flyttet'), 'junction');
  const env = { LOCALAPPDATA: root };
  return { root, env, rules: createDiskRules(LOCKS, {}, env) };
}

const ROWS = [
  { name: 'App', text: 'Cache.', paths: ['%LOCALAPPDATA%\\App\\User Data\\*\\Cache', '%LOCALAPPDATA%\\Findes ikke'] },
  { name: 'Låst', text: 'Låst.', paths: ['%LOCALAPPDATA%\\Låst\\Cache'] },
  { name: 'Flyttet', text: 'Junction.', paths: ['%LOCALAPPDATA%\\Flyttet'] },
  { name: 'Ukendt', text: 'Ingen variabel.', paths: ['%FINDES_IKKE%\\Cache'] },
];

function service(fx, runPowerShell) {
  const calls = [];
  const logs = [];
  const clean = createCleanService({
    rows: ROWS, rules: fx.rules, env: fx.env, dataDir: join(fx.root, 'data'), recycleScript: 'recycle.ps1', timeoutMs: 1000,
    scanOptions: { concurrency: 2, minItemBytes: 1 },
    runPowerShell: async (...args) => { calls.push(args); return runPowerShell(...args); },
    onLog: (entry) => logs.push(entry),
  });
  return { clean, calls, logs };
}

test('expandRows: * foldes ud, junctions, låste og manglende stier droppes, tomme rækker forsvinder', async () => {
  const fx = await fixture();
  try {
    const rows = await expandRows(ROWS, { env: fx.env, rules: fx.rules });
    assert.deepEqual(rows.map((row) => row.name), ['App']);
    assert.deepEqual(rows[0].paths.sort(), [
      `${fx.root}\\App\\User Data\\Default\\Cache`,
      `${fx.root}\\App\\User Data\\Profile 1\\Cache`,
    ]);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('listChildren springer junctions over', async () => {
  const fx = await fixture();
  try {
    const dir = join(fx.root, 'Børn');
    await mkdir(join(dir, 'under'), { recursive: true });
    await writeFile(join(dir, 'a.bin'), 'a');
    await symlink(join(fx.root, 'Ægte'), join(dir, 'genvej'), 'junction');
    assert.deepEqual((await listChildren(dir)).sort(), [join(dir, 'a.bin'), join(dir, 'under')]);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('list: størrelse og antal filer pr. række', async () => {
  const fx = await fixture();
  try {
    const { clean } = service(fx, async () => '');
    const [status, body] = await clean.routes['/api/clean/list']({});
    assert.equal(status, 200);
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].size, 1500);
    assert.equal(body.rows[0].files, 2);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('run: sti og ukendt navn afvises uden PowerShell', async () => {
  const fx = await fixture();
  try {
    const { clean, calls } = service(fx, async () => '');
    for (const names of [['C:\\Windows'], ['Findes ikke'], ['Låst'], 'App', []]) {
      const [status] = await clean.routes['/api/clean/run']({ names });
      assert.equal(status, 400, JSON.stringify(names));
    }
    assert.equal(calls.length, 0);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('run: hver mappes børn til papirkurven, i brug tælles, én logpost', async () => {
  const fx = await fixture();
  try {
    // Som scriptet: flytter alt i listen, men én ting pr. kald er i brug.
    const { clean, calls, logs } = service(fx, async (script, args) => {
      const paths = JSON.parse(await readFile(args[1], 'utf8'));
      for (const path of paths) await rm(path, { recursive: true });
      return JSON.stringify({ ok: true, moved: paths.length, failed: 1 });
    });
    const [status, body] = await clean.routes['/api/clean/run']({ names: ['App', 'App'] });
    assert.equal(status, 200);
    assert.equal(calls.length, 2, 'ét kald pr. mappe, navnet kun én gang');
    assert.deepEqual(calls[0][1].slice(0, 1), ['-ListFile']);
    assert.match(body.message, /2 ting var i brug: luk programmet og prøv igen/);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].type, 'recycle');
    assert.equal(logs[0].undoable, false);
    assert.match(body.message, /^Flyttede 0 MB til papirkurven\./, '1500 byte rundes til 0 MB');
    assert.match(logs[0].label, /App/);
    assert.equal(body.rows[0].size, 0, 'målt igen bagefter');
    assert.equal(body.rows[0].name, 'App');
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('run: for stor til papirkurven stopper resten', async () => {
  const fx = await fixture();
  try {
    const { clean, calls } = service(fx, async () => '{"ok":false,"reason":"too-big","maxBytes":1073741824}');
    const [status, body] = await clean.routes['/api/clean/run']({ names: ['App'] });
    assert.equal(status, 400);
    assert.match(body.error, /For stor til papirkurven \(maks\. 1 GB/);
    assert.equal(calls.length, 1);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('list og run samtidig giver 409', async () => {
  const fx = await fixture();
  try {
    const { clean } = service(fx, async () => '{"ok":true,"moved":1,"failed":0}');
    const listing = clean.routes['/api/clean/list']({});
    const [status] = await clean.routes['/api/clean/run']({ names: ['App'] });
    assert.equal(status, 409);
    await listing;
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});
