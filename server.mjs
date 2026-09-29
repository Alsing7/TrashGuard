// TrashGuard: lokalt dashboard over CPU-slugere og baggrunds-bloat.
// Måler kun mens en fane er åben; lukker sig selv, når den sidste fane er væk.
import http from 'node:http';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { parseJsonLine, signerName } from './lib/parse.mjs';
import { createSampler, LENSES } from './lib/sampler.mjs';
import { classifyAll, createKnownBloat, headlines } from './lib/classify.mjs';
import { runPowerShell, enrichInventory } from './lib/inventory.mjs';
import { planAction, planUndo, runSteps, createJsonStore, logEntry, appendLog } from './lib/actions.mjs';
import { hostAllowed, originAllowed, tokenMatches } from './lib/guard.mjs';
import { createDiskRules } from './lib/disk.mjs';
import { createDiskService } from './lib/disk-service.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const readJson = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const lower = (text) => String(text).toLowerCase();

const config = readJson('config.json');
const knownBloatList = readJson('kendt-bloat.json');
const knownBloat = createKnownBloat(knownBloatList);
const windowsDir = process.env.SystemRoot ?? 'C:\\Windows';
const cores = os.cpus().length;
const token = randomBytes(24).toString('hex');
const baseUrl = `http://127.0.0.1:${config.port}`;
const MAX_BODY_BYTES = 10 * 1024;
const PERCENT_DECIMALS = 100;
const BYTES_PER_MB = 1048576;
const MEMORY_LENSES = new Set(['ram', 'vram']);
const STATIC_FILES = {
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/ui.js': ['ui.js', 'text/javascript; charset=utf-8'],
  '/disk.js': ['disk.js', 'text/javascript; charset=utf-8'],
};
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

const logStore = createJsonStore(join(root, 'data', 'handlinger.json'), []);
const trustStore = createJsonStore(join(root, 'data', 'stol-paa.json'), []);
const classifyConfig = {
  protectedProcesses: new Set(config.protectedProcesses.map(lower)),
  windowsDir,
  thresholds: config.backgroundThresholds,
  weights: config.weights,
};
const protectedServices = new Set(config.protectedServices.map(lower));
const sampler = createSampler({ cores, historyLength: config.historyLength, minAverageWindowMs: config.minAverageWindowMs });

const state = {
  inventory: null,
  meta: new Map(),
  servicesByPid: new Map(),
  groups: [],
  signals: new Map(),
  // Klientens enheder: CPU og GPU i %, RAM og VRAM i MB.
  headlines: { cpu: 0, ram: 0, gpu: 0, vram: 0 },
  headlineHistory: Object.fromEntries(LENSES.map((lens) => [lens, []])),
  totals: { cpu: 0, gpu: 0, ramUsed: 0, ramTotal: 0, vramUsed: 0, vramTotal: 0 },
  log: logStore.read(),
  trusted: new Set(trustStore.read()),
  lastSent: new Map(),
};
const clients = new Set();
const disk = createDiskService({
  settings: config.disk,
  rules: createDiskRules(config.disk, knownBloatList.folders),
  dataDir: join(root, 'data', 'disk'),
  recycleScript: join(root, 'ps', 'recycle.ps1'),
  sizesScript: join(root, 'ps', 'sizes.ps1'),
  runPowerShell,
  broadcast,
  onLog: (entry) => {
    state.log = appendLog(state.log, logEntry(entry.type, entry));
    logStore.write(state.log);
    broadcast('log', state.log);
  },
});
let samplerProcess = null;
let shutdownTimer = null;
let inventoryRefresh = null;

// ---------- Visning til klienten ----------

const roundPercent = (value) => Math.round(value * PERCENT_DECIMALS) / PERCENT_DECIMALS;
const toMb = (bytes) => Math.round(bytes / BYTES_PER_MB);
const lensUnit = (lens, value) => (MEMORY_LENSES.has(lens) ? toMb(value) : roundPercent(value));
const perLens = (source) => Object.fromEntries(LENSES.map((lens) => [lens, lensUnit(lens, source[lens])]));

function groupView(group) {
  const signals = state.signals.get(group.key) ?? {};
  const file = state.meta.get(lower(group.path));
  return {
    key: group.key, name: group.name, path: group.path ?? null,
    desc: file?.desc || null, company: file?.company || null, signer: file?.signer ?? null, signed: file ? file.valid : null,
    running: group.running, count: group.count, win: group.win,
    cpu: roundPercent(group.cpu), avg: roundPercent(group.avg), gpu: roundPercent(group.gpu), gpuAvg: roundPercent(group.gpuAvg),
    ram: toMb(group.ram), priv: toMb(group.priv), vram: toMb(group.vram),
    category: signals.category ?? 'pending', killLocked: signals.killLocked ?? true, lock: signals.lock ?? null,
    scores: Object.fromEntries(LENSES.map((lens) => [lens, roundPercent(signals.scores?.[lens] ?? 0)])),
    background: signals.background ?? [], autostart: Boolean(signals.autostart), autostartVia: signals.autostartVia ?? null,
    bloatText: signals.bloatText ?? null, sources: signals.sources ?? [], ancestors: group.ancestors,
  };
}

function inventoryView() {
  const inventory = state.inventory;
  if (!inventory) return null;
  const pick = (item, fields) => Object.fromEntries(fields.map((field) => [field, item[field] ?? null]));
  return {
    admin: inventory.admin,
    drives: inventory.drives,
    startup: inventory.startup.map((item) => pick(item, ['id', 'name', 'type', 'scope', 'command', 'exe', 'enabled', 'orphan', 'bloatText'])),
    tasks: inventory.tasks.map((item) => pick(item, ['id', 'name', 'path', 'state', 'exe', 'arguments', 'author', 'enabled', 'microsoft', 'orphan', 'bloatText'])),
    services: inventory.services.map((item) => pick(item, ['id', 'name', 'display', 'description', 'startMode', 'delayed', 'state', 'exe', 'windows', 'orphan', 'bloatText'])),
  };
}

function snapshot() {
  return {
    cores, baseUrl,
    groups: state.groups.map(groupView),
    history: Object.fromEntries(state.groups.map((group) => [group.key,
      Object.fromEntries(LENSES.map((lens) => [lens, group.history[lens].map((value) => lensUnit(lens, value))]))])),
    headlineHistory: state.headlineHistory,
    headlines: state.headlines, totals: state.totals,
    inventory: inventoryView(),
    log: state.log,
    protectedServices: [...protectedServices],
    disk: disk.state(),
  };
}

function send(client, event, data) {
  client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const client of clients) send(client, event, data);
}

// ---------- Måling ----------

function classifyContext() {
  return {
    inventory: state.inventory, knownBloat, meta: state.meta, trusted: state.trusted, config: classifyConfig,
    selfPids: new Set([process.pid, samplerProcess?.pid].filter(Boolean)),
  };
}

// Sender kun grupper, hvis visning har ændret sig siden sidst.
function publish(at, isTick = false) {
  if (!state.inventory) return;
  state.signals = classifyAll(state.groups, classifyContext());
  state.headlines = perLens(headlines(state.groups, state.signals));
  if (isTick) {
    for (const lens of LENSES) {
      state.headlineHistory[lens].push(state.headlines[lens]);
      if (state.headlineHistory[lens].length > config.historyLength) state.headlineHistory[lens].shift();
    }
  }
  const changed = [];
  for (const group of state.groups) {
    const view = groupView(group);
    const serialized = JSON.stringify(view);
    if (state.lastSent.get(group.key) === serialized) continue;
    state.lastSent.set(group.key, serialized);
    changed.push(view);
  }
  broadcast('tick', { at, headlines: state.headlines, totals: state.totals, groups: changed });
}

function handleSamplerLine(line) {
  const message = parseJsonLine(line);
  if (message?.type === 'meta') {
    for (const [path, file] of Object.entries(message.files)) {
      state.meta.set(lower(path), { signer: signerName(file.subject), valid: file.valid, company: file.company, desc: file.desc });
    }
    return;
  }
  if (message?.type !== 'tick') return;
  if (message.services) {
    state.servicesByPid = new Map();
    for (const service of message.services) {
      state.servicesByPid.set(service.pid, [...(state.servicesByPid.get(service.pid) ?? []), service]);
    }
  }
  state.groups = sampler.ingest(message, state.servicesByPid);
  const system = message.system ?? {};
  state.totals = {
    cpu: roundPercent(state.groups.reduce((sum, group) => sum + group.cpu, 0)),
    gpu: system.gpuTotal == null ? state.totals.gpu : roundPercent(system.gpuTotal),
    ramUsed: toMb(system.ramUsed ?? 0), ramTotal: toMb(system.ramTotal ?? 0),
    vramUsed: toMb(system.vramUsed ?? 0), vramTotal: toMb(system.vramTotal ?? 0),
  };
  publish(message.at, true);
}

function ensureSampler() {
  if (samplerProcess) return;
  samplerProcess = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'ps', 'sampler.ps1'),
    '-IntervalMs', String(config.sampleIntervalMs), '-SignaturesPerTick', String(config.signaturesPerTick),
    '-ServiceEveryTicks', String(config.serviceEveryTicks), '-GpuEveryTicks', String(config.gpuEveryTicks),
    '-ParentPid', String(process.pid),
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  samplerProcess.stdout.setEncoding('utf8');
  createInterface({ input: samplerProcess.stdout }).on('line', handleSamplerLine);
  samplerProcess.on('exit', () => {
    samplerProcess = null;
    if (clients.size) setTimeout(ensureSampler, config.sampleIntervalMs);
  });
}

function refreshInventory() {
  inventoryRefresh ??= runPowerShell(join(root, 'ps', 'inventory.ps1'))
    .then((output) => {
      state.inventory = enrichInventory(parseJsonLine(output), knownBloat, windowsDir);
      broadcast('inventory', inventoryView());
      publish(Date.now());
    })
    .catch((error) => broadcast('problem', { message: `Kunne ikke læse opstart og tjenester: ${error.message}` }))
    .finally(() => { inventoryRefresh = null; });
  return inventoryRefresh;
}

// ---------- Livscyklus ----------

function scheduleShutdown(delayMs) {
  clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    samplerProcess?.kill();
    console.log('Ingen faner åbne. TrashGuard lukker.');
    process.exit(0);
  }, delayMs);
}

function openStream(request, response) {
  response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
  clients.add(response);
  clearTimeout(shutdownTimer);
  ensureSampler();
  send(response, 'snapshot', snapshot());
  request.on('close', () => {
    clients.delete(response);
    if (!clients.size) scheduleShutdown(config.shutdownGraceMs);
  });
}

// ---------- Handlinger ----------

async function performAction(body) {
  const groups = new Map(state.groups.map((group) => [group.key, { ...group, killLocked: state.signals.get(group.key)?.killLocked ?? true }]));
  const plan = planAction(body, { groups, inventory: state.inventory, protectedServices });
  if (plan.error) return [400, { error: plan.error }];
  await runSteps(plan.steps);
  state.log = appendLog(state.log, logEntry(body.type, plan));
  logStore.write(state.log);
  broadcast('log', state.log);
  if (body.type !== 'kill') await refreshInventory();
  return [200, { message: plan.label }];
}

async function performUndo(body) {
  const entry = state.log.find((candidate) => candidate.id === body.id);
  const plan = planUndo(entry, { inventory: state.inventory });
  if (plan.error) return [400, { error: plan.error }];
  await runSteps(plan.steps);
  entry.undone = true;
  logStore.write(state.log);
  broadcast('log', state.log);
  await refreshInventory();
  return [200, { message: `Fortrudt: ${entry.label}` }];
}

function toggleTrust(body) {
  const key = String(body.key);
  if (!state.groups.some((group) => group.key === key)) return [400, { error: 'Programmet findes ikke.' }];
  if (state.trusted.has(key)) state.trusted.delete(key);
  else state.trusted.add(key);
  trustStore.write([...state.trusted]);
  publish(Date.now());
  return [200, { message: state.trusted.has(key) ? 'Du stoler nu på den.' : 'Tillid fjernet.' }];
}

const POST_ROUTES = {
  '/api/action': performAction,
  '/api/undo': performUndo,
  '/api/trust': toggleTrust,
  '/api/refresh': async () => { await refreshInventory(); return [200, { message: 'Opdateret.' }]; },
  ...disk.routes,
};

// ---------- HTTP ----------

function reply(response, status, data) {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return reject(new Error('For stor forespørgsel.'));
      chunks.push(chunk);
    });
    request.on('end', () => resolve(parseJsonLine(Buffer.concat(chunks).toString('utf8')) ?? {}));
    request.on('error', reject);
  });
}

function serveFile(response, file, type, transform = (text) => text) {
  response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type });
  response.end(transform(readFileSync(join(root, 'public', file), 'utf8')));
}

const server = http.createServer(async (request, response) => {
  if (!hostAllowed(request.headers.host, config.port)) return reply(response, 403, { error: 'Forkert host.' });
  const url = new URL(request.url, baseUrl);

  if (request.method === 'GET') {
    if (url.pathname === '/') return serveFile(response, 'index.html', 'text/html; charset=utf-8', (html) => html.replace('__TOKEN__', token));
    if (STATIC_FILES[url.pathname]) return serveFile(response, ...STATIC_FILES[url.pathname]);
    if (url.pathname === '/api/stream') {
      if (!tokenMatches(url.searchParams.get('t'), token)) return reply(response, 403, { error: 'Forkert token.' });
      return openStream(request, response);
    }
  }

  const route = request.method === 'POST' && POST_ROUTES[url.pathname];
  if (!route) return reply(response, 404, { error: 'Findes ikke.' });
  if (!originAllowed(request.headers.origin, config.port) || !tokenMatches(request.headers['x-trashguard-token'], token)) {
    return reply(response, 403, { error: 'Afvist.' });
  }
  try {
    const [status, data] = await route(await readBody(request));
    reply(response, status, data);
  } catch (error) {
    reply(response, 500, { error: error.message });
  }
});

function openBrowser() {
  // Via explorer.exe, så browseren starter som din almindelige bruger og ikke som administrator.
  execFile('explorer.exe', [baseUrl + '/'], () => {});
}

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.log('TrashGuard kører allerede. Åbner den i stedet.');
  openBrowser();
  setTimeout(() => process.exit(0), 500);
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`TrashGuard kører på ${baseUrl}/`);
  console.log('Luk fanen, så lukker TrashGuard sig selv efter lidt tid. Du kan også lukke dette vindue.');
  scheduleShutdown(config.firstClientTimeoutMs);
  if (!process.argv.includes('--no-browser')) openBrowser();
  refreshInventory();
});
