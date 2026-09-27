import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractExe, isApprovedEnabled, approvedValue, parseJsonLine, signerName } from '../lib/parse.mjs';
import { cpuPercent, createSampler } from '../lib/sampler.mjs';
import { classifyAll, createKnownBloat, backgroundReasons, headlines } from '../lib/classify.mjs';
import { planAction, planUndo } from '../lib/actions.mjs';
import { hostAllowed, originAllowed, tokenMatches } from '../lib/guard.mjs';

const env = { windir: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\T\\AppData\\Local' };

test('exe-sti: anførselstegn, mellemrum uden anførselstegn, miljøvariabler', () => {
  assert.equal(extractExe('"C:\\Program Files\\Steam\\steam.exe" -silent', env), 'C:\\Program Files\\Steam\\steam.exe');
  assert.equal(extractExe('C:\\Program Files\\Elgato\\Volume Controller\\ElgatoAudioControlServerWatcher.exe', env),
    'C:\\Program Files\\Elgato\\Volume Controller\\ElgatoAudioControlServerWatcher.exe');
  assert.equal(extractExe('%WINDIR%\\system32\\svchost.exe -k netsvcs -p', env), 'C:\\Windows\\system32\\svchost.exe');
  assert.equal(extractExe('%LocalAppData%\\x\\y.exe', env), 'C:\\Users\\T\\AppData\\Local\\x\\y.exe');
  assert.equal(extractExe('\\??\\C:\\drv\\a.exe', env), 'C:\\drv\\a.exe');
  assert.equal(extractExe('', env), null);
});

test('StartupApproved: lige = aktiv, ulige = slået fra, mangler = aktiv', () => {
  assert.equal(isApprovedEnabled(null), true);
  assert.equal(isApprovedEnabled('020000000000000000000000'), true);
  assert.equal(isApprovedEnabled('060000000000000000000000'), true);
  assert.equal(isApprovedEnabled('030000002f06cce1b3b0dc01'), false);
  assert.equal(approvedValue(true), '020000000000000000000000');
  const disabled = approvedValue(false, Date.UTC(2026, 8, 27));
  assert.equal(disabled.length, 24);
  assert.equal(isApprovedEnabled(disabled), false);
});

test('JSON-linjer tåler BOM og affald; signaturnavn', () => {
  assert.deepEqual(parseJsonLine('\uFEFF{"a":1}'), { a: 1 });
  assert.equal(parseJsonLine('ikke json'), null);
  assert.equal(signerName('CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond'), 'Microsoft Corporation');
  assert.equal(signerName('CN="Discord, Inc."'), 'Discord, Inc.');
});

test('CPU: PID-genbrug og faldende CPU-tid giver 0, aldrig negativ', () => {
  const before = { cpu: 5_000_000, at: 1000, name: 'a.exe' };
  assert.equal(cpuPercent(before, { name: 'b.exe', cpu: 9_000_000 }, 3000, 4), 0);
  assert.equal(cpuPercent(before, { name: 'a.exe', cpu: 100 }, 3000, 4), 0);
  assert.equal(cpuPercent(undefined, { name: 'a.exe', cpu: 100 }, 3000, 4), 0);
  // 2 sek. på 4 kerner = 8e7 enheder; 2e7 brugt = 25 %
  assert.equal(cpuPercent(before, { name: 'a.exe', cpu: 25_000_000 }, 3000, 4), 25);
});

test('sampler: grupperer pr. exe, tjenesteværter pr. tjeneste, beholder lukkede programmer', () => {
  const sampler = createSampler({ cores: 1, historyLength: 3, minAverageWindowMs: 0 });
  const proc = (pid, ppid, name, cpu, path = `C:\\p\\${name}`) => ({ pid, ppid, name, path, cpu, ram: 10, win: false });
  const services = new Map([[30, [{ name: 'DiagTrack', display: 'Telemetri' }]]]);
  sampler.ingest({ at: 0, procs: [proc(10, 1, 'app.exe', 0), proc(11, 10, 'app.exe', 0), proc(30, 2, 'svchost.exe', 0)] }, services);
  const groups = sampler.ingest({ at: 1000, procs: [proc(10, 1, 'app.exe', 5_000_000), proc(11, 10, 'app.exe', 5_000_000), proc(30, 2, 'svchost.exe', 0)] }, services);
  const app = groups.find((group) => group.key === 'exe:c:\\p\\app.exe');
  assert.equal(app.count, 2);
  assert.deepEqual(app.rootPids, [10]);
  assert.equal(app.cpu, 100);
  assert.ok(groups.some((group) => group.key === 'svc:DiagTrack'));
  const after = sampler.ingest({ at: 2000, procs: [] }, services);
  assert.equal(after.find((group) => group.key === app.key).running, false);
});

const MB = 1048576;
const thresholds = { cpuPercent: 0.3, ramMb: 500, gpuPercent: 2, vramMb: 500 };

function classifyFixture({ meta = new Map(), trusted = new Set(), group = {} } = {}) {
  const base = { key: 'exe:c:\\windows\\system32\\svchost.exe', name: 'svchost.exe', path: 'C:\\Windows\\System32\\svchost.exe',
    services: [], pids: [5], rootPids: [5], running: true, win: false, cpu: 5, avg: 5, gpu: 0, gpuAvg: 0, ram: 0, vram: 0, ancestors: [], ...group };
  const ctx = {
    inventory: { servicesByName: new Map(), byExe: new Map() },
    knownBloat: createKnownBloat({ exe: { 'adobearm.exe': 'updater' } }),
    meta, trusted, selfPids: new Set([999]),
    config: { protectedProcesses: new Set(['lsass.exe']), windowsDir: 'C:\\Windows', thresholds, weights: { background: 2, autostart: 1.5, knownBloat: 2 } },
  };
  return classifyAll([base], ctx).get(base.key);
}

test('klassificering: Windows-fil uden kendt signatur er låst; beskyttet slår alt', () => {
  assert.equal(classifyFixture().lock, 'pending');
  assert.equal(classifyFixture().killLocked, true);
  const signed = new Map([['c:\\windows\\system32\\svchost.exe', { signer: 'Microsoft Corporation', valid: true }]]);
  assert.equal(classifyFixture({ meta: signed }).lock, 'windows');
  const fake = new Map([['c:\\windows\\system32\\svchost.exe', { signer: 'Evil Ltd', valid: true }]]);
  assert.equal(classifyFixture({ meta: fake }).killLocked, false);
  assert.equal(classifyFixture({ group: { name: 'lsass.exe' } }).category, 'critical');
  assert.equal(classifyFixture({ group: { pids: [999] } }).category, 'self');
});

test('klassificering: kendt bloat er mistænkt, tillid vinder, baggrundsæder får score', () => {
  const adobe = { key: 'exe:c:\\a\\adobearm.exe', name: 'AdobeARM.exe', path: 'C:\\a\\AdobeARM.exe' };
  const result = classifyFixture({ group: adobe });
  assert.equal(result.category, 'suspect');
  assert.equal(result.scores.cpu, 5 * 2 * 2);
  assert.deepEqual(result.background, ['CPU']);
  assert.equal(classifyFixture({ group: adobe, trusted: new Set([adobe.key]) }).category, 'trusted');
  const withWindow = classifyFixture({ group: { key: 'exe:c:\\x\\app.exe', name: 'app.exe', path: 'C:\\x\\app.exe', win: true } });
  assert.equal(withWindow.category, 'yours');
});

test('sampler: GPU holdes mellem målinger, snit over tid, VRAM loftes af kortets forbrug', () => {
  const sampler = createSampler({ cores: 1, historyLength: 5, minAverageWindowMs: 0 });
  const proc = (extra) => ({ pid: 7, ppid: 1, name: 'voicemod.exe', path: 'C:\\v\\voicemod.exe', cpu: 0, ram: 200 * MB, priv: 400 * MB, vram: 27000 * MB, win: false, ...extra });
  sampler.ingest({ at: 0, system: { gpuTotal: 40, vramUsed: 3600 * MB }, procs: [proc({ gpu: 40 })] }, new Map());
  const [held] = sampler.ingest({ at: 1000, system: { gpuTotal: null, vramUsed: 3600 * MB }, procs: [proc()] }, new Map());
  assert.equal(held.gpu, 40);
  assert.equal(held.gpuAvg, 40);
  assert.equal(held.vram, 3600 * MB);
  assert.equal(held.priv, 400 * MB);
  assert.deepEqual(held.history.gpu, [40, 40]);
  const [dropped] = sampler.ingest({ at: 2000, system: { gpuTotal: 0, vramUsed: 3600 * MB }, procs: [proc({ gpu: 0 })] }, new Map());
  assert.equal(dropped.gpu, 0);
  assert.equal(dropped.gpuAvg, 20);
});

test('baggrund: hver ressource har sin tærskel; vindue eller lukket = aldrig baggrund', () => {
  const group = { running: true, win: false, avg: 0, gpuAvg: 0, ram: 0, vram: 0 };
  assert.deepEqual(backgroundReasons(group, thresholds), []);
  assert.deepEqual(backgroundReasons({ ...group, ram: 600 * MB }, thresholds), ['RAM']);
  assert.deepEqual(backgroundReasons({ ...group, gpuAvg: 3, vram: 800 * MB }, thresholds), ['GPU', 'VRAM']);
  assert.deepEqual(backgroundReasons({ ...group, ram: 600 * MB, win: true }, thresholds), []);
  assert.deepEqual(backgroundReasons({ ...group, ram: 600 * MB, running: false }, thresholds), []);
  const hog = classifyFixture({ group: { key: 'exe:c:\\x\\hog.exe', name: 'hog.exe', path: 'C:\\x\\hog.exe', avg: 0, ram: 3000 * MB } });
  assert.equal(hog.category, 'suspect');
  assert.equal(hog.scores.ram, 3000 * 2);
  assert.equal(hog.scores.cpu, 0);
});

test('overskrift: kun syndere tæller, GPU max 100 %', () => {
  const groups = [
    { key: 'a', running: true, cpu: 2, ram: 100, gpu: 70, vram: 10 },
    { key: 'b', running: true, cpu: 3, ram: 200, gpu: 60, vram: 20 },
    { key: 'c', running: true, cpu: 50, ram: 999, gpu: 99, vram: 999 },
  ];
  const results = new Map([['a', { category: 'suspect' }], ['b', { category: 'suspect' }], ['c', { category: 'yours' }]]);
  assert.deepEqual(headlines(groups, results), { cpu: 5, ram: 300, gpu: 100, vram: 30 });
});

const inventory = {
  servicesByName: new Map([
    ['diagtrack', { name: 'DiagTrack', display: 'Telemetri', startMode: 'Auto', delayed: false, state: 'Running' }],
    ['rpcss', { name: 'RpcSs', display: 'RPC', startMode: 'Auto', state: 'Running' }],
    ['driverx', { name: 'DriverX', display: 'Driver', startMode: 'Boot', state: 'Running' }],
  ]),
  startupById: new Map([['run:HKCU:Discord', { id: 'run:HKCU:Discord', name: 'Discord', approvedKey: 'HKCU\\X', approvedHex: null, enabled: true }]]),
  tasksById: new Map(),
};
const actionState = { groups: new Map([['k', { key: 'k', name: 'lsass.exe', killLocked: true, rootPids: [5] }]]), inventory, protectedServices: new Set(['rpcss']) };

test('handlinger: server afviser beskyttede mål uanset klienten', () => {
  assert.ok(planAction({ type: 'kill', key: 'k' }, actionState).error);
  assert.ok(planAction({ type: 'service', name: 'RpcSs', mode: 'manual' }, actionState).error);
  assert.ok(planAction({ type: 'service', name: 'DriverX', mode: 'manual' }, actionState).error);
  assert.ok(planAction({ type: 'service', name: 'DiagTrack', mode: 'sletalt' }, actionState).error);
  assert.ok(planAction({ type: 'startup', id: 'findes-ikke', enable: false }, actionState).error);
  const plan = planAction({ type: 'service', name: 'DiagTrack', mode: 'manual' }, actionState);
  assert.deepEqual(plan.steps.at(-1).args, ['config', 'DiagTrack', 'start=', 'demand']);
});

test('deaktiverede tjenester kan aktiveres igen, også låste', () => {
  const disabledInventory = { ...inventory, servicesByName: new Map([
    ['xblgamesave', { name: 'XblGameSave', display: 'Xbox', startMode: 'Disabled', delayed: false, state: 'Stopped' }],
    ['rpcss', { name: 'RpcSs', display: 'RPC', startMode: 'Disabled', delayed: false, state: 'Stopped' }],
  ]) };
  const disabledState = { ...actionState, inventory: disabledInventory };
  const auto = planAction({ type: 'service', name: 'XblGameSave', mode: 'auto' }, disabledState);
  assert.deepEqual(auto.steps.map((current) => current.args), [['config', 'XblGameSave', 'start=', 'auto'], ['start', 'XblGameSave']]);
  assert.equal(auto.prev.startMode, 'Disabled');
  assert.match(auto.label, /aktiveret som Automatisk/);
  const manual = planAction({ type: 'service', name: 'RpcSs', mode: 'manual' }, disabledState);
  assert.deepEqual(manual.steps.at(-1).args, ['config', 'RpcSs', 'start=', 'demand']);
  assert.ok(planAction({ type: 'service', name: 'RpcSs', mode: 'disabled' }, actionState).error);
  const undo = planUndo({ type: 'service', target: { name: 'XblGameSave' }, prev: auto.prev, undoable: true }, { inventory: disabledInventory });
  assert.deepEqual(undo.steps[0].args, ['config', 'XblGameSave', 'start=', 'disabled']);
});

test('fortryd bygges fra tidligere tilstand og afviser en beskadiget log', () => {
  const plan = planAction({ type: 'startup', id: 'run:HKCU:Discord', enable: false }, actionState);
  const entry = { type: 'startup', target: plan.target, prev: plan.prev, undoable: true, undone: false };
  assert.deepEqual(planUndo(entry, { inventory }).steps[0].args.slice(0, 1), ['delete']);
  assert.ok(planUndo({ ...entry, prev: { approvedHex: '02 & calc' } }, { inventory }).error);
  const service = { type: 'service', target: { name: 'DiagTrack' }, prev: { startMode: 'Auto', delayed: true, state: 'Running' }, undoable: true };
  const steps = planUndo(service, { inventory }).steps;
  assert.deepEqual(steps[0].args, ['config', 'DiagTrack', 'start=', 'delayed-auto']);
  assert.deepEqual(steps[1].args, ['start', 'DiagTrack']);
});

test('vagt: kun lokal host, egen origin og korrekt token', () => {
  assert.equal(hostAllowed('127.0.0.1:4319', 4319), true);
  assert.equal(hostAllowed('evil.example:4319', 4319), false);
  assert.equal(originAllowed(undefined, 4319), true);
  assert.equal(originAllowed('http://evil.example', 4319), false);
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abd', 'abc'), false);
  assert.equal(tokenMatches(undefined, 'abc'), false);
});
