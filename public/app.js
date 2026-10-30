// Strømmen fra serveren, den fælles tilstand, fanerne og topbjælken. Hver fane er sit eget modul (docs/design.md).
import { token, $, el, setChildren, run, lensValue, bindTablist } from './ui.js';
import * as live from './live.js';
import * as startup from './startup.js';
import * as disk from './disk.js';
import * as clean from './clean.js';
import * as log from './log.js';

const TABS = { live, startup, disk, clean, log };
const LENS_KEYS = ['cpu', 'ram', 'gpu', 'vram'];
const LENS_STORAGE_KEY = 'trashguard-lens';

// Den ene sandhed for serverens data. Kun app.js skriver i den (linsen via setLens), og objektet skiftes aldrig ud.
const state = {
  groups: new Map(),
  history: new Map(),
  headlineHistory: emptyPerLens(),
  // Serverens config.historyLength; kommer med snapshot.
  historyLength: 0,
  lens: readStoredLens(),
  headlines: { cpu: 0, ram: 0, gpu: 0, vram: 0 },
  totals: { cpu: 0, gpu: 0, ramUsed: 0, ramTotal: 0, vramUsed: 0, vramTotal: 0 },
  inventory: null,
  boot: null,
  log: [],
  protectedServices: new Set(),
  disk: null,
};
const app = { tab: 'live', status: null, missedWhileHidden: false };
const context = { state, setLens };

function emptyPerLens() {
  return Object.fromEntries(LENS_KEYS.map((lens) => [lens, []]));
}

function readStoredLens() {
  try {
    const stored = localStorage.getItem(LENS_STORAGE_KEY);
    return LENS_KEYS.includes(stored) ? stored : 'cpu';
  } catch {
    return 'cpu';
  }
}

function setLens(lens) {
  state.lens = lens;
  try {
    localStorage.setItem(LENS_STORAGE_KEY, lens);
  } catch {
    // Privat vindue eller blokeret lager: linsen huskes bare ikke.
  }
  renderLivePill();
}

// ---------- Topbjælken ----------

function setStatus(text, mode, title = '') {
  app.status = mode;
  $('#status-text').textContent = text;
  $('#status').title = title;
  $('#status').classList.toggle('is-live', mode === 'live');
  $('#status').classList.toggle('is-offline', mode === 'offline');
}

// To ens animationer på skift, så pulsen genstarter uden at tvinge et layout.
function beat() {
  const dot = $('#beat');
  dot.dataset.beat = dot.dataset.beat === 'a' ? 'b' : 'a';
}

// Skriver kun det, der er ændret, fordi den kaldes ved hvert tick.
function renderLivePill() {
  const pill = $('#tab-live-value');
  const text = lensValue(state.lens, state.headlines[state.lens]);
  if (pill.textContent !== text) pill.textContent = text;
  if (pill.dataset.res !== state.lens) pill.dataset.res = state.lens;
  pill.hidden = false;
}

function renderTick() {
  if (app.status !== 'live') setStatus('Live', 'live');
  beat();
  renderLivePill();
}

// Døde poster: opstartsposter, opgaver og tjenester, der er slået til, men peger på en fil, der ikke findes.
function renderInventoryMarks() {
  const inventory = state.inventory;
  if (!inventory) return;
  const dead = [...inventory.startup, ...inventory.tasks, ...inventory.services].filter((item) => item.orphan && item.enabled !== false && item.startMode !== 'Disabled').length;
  const badge = $('#tab-startup-dead');
  badge.hidden = dead === 0;
  badge.title = `${dead} ${dead === 1 ? 'post' : 'poster'} ved opstart peger på en fil, der ikke findes`;
  setChildren(badge, String(dead), el('span', { className: 'visually-hidden' }, dead === 1 ? ' død post' : ' døde poster'));
  $('#admin-banner').hidden = inventory.admin;
}

function renderBootMark() {
  $('#tab-startup-slow').hidden = !state.boot?.sessions[0]?.slower;
}

// ---------- Fordeling til fanerne ----------

// Kun den synlige fane får besked, og kun mens dokumentet er synligt. Det, der går tabt imens, tegnes forfra bagefter.
function deliver(hook, data = null, renderTopbar = null) {
  if (document.hidden) {
    app.missedWhileHidden = true;
    return;
  }
  renderTopbar?.();
  TABS[app.tab][hook]?.(data);
}

function refreshAll() {
  app.missedWhileHidden = false;
  deliver('onSnapshot', null, () => {
    renderLivePill();
    renderInventoryMarks();
    renderBootMark();
  });
}

function selectTab(name) {
  if (name === app.tab) return;
  TABS[app.tab].hide?.();
  app.tab = name;
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== `tab-${name}`;
  TABS[name].show();
}

// ---------- Strømmen fra serveren ----------

const pushCapped = (list, value) => {
  list.push(value);
  if (list.length > state.historyLength) list.shift();
};

// Uændrede grupper sendes ikke, men deres tal er de samme som sidst, så alle får et punkt.
function appendHistory() {
  for (const [key, group] of state.groups) {
    const history = state.history.get(key) ?? emptyPerLens();
    for (const lens of LENS_KEYS) pushCapped(history[lens], group[lens]);
    state.history.set(key, history);
  }
}

function onSnapshot(data) {
  state.groups = new Map(data.groups.map((group) => [group.key, group]));
  state.historyLength = data.historyLength;
  state.history = new Map(Object.entries(data.history));
  state.headlineHistory = data.headlineHistory;
  state.headlines = data.headlines;
  state.totals = data.totals;
  state.inventory = data.inventory;
  state.boot = data.boot;
  state.log = data.log;
  state.protectedServices = new Set(data.protectedServices);
  state.disk = data.disk;
  setStatus(data.inventory ? 'Måler…' : 'Læser opstart og tjenester…', 'waiting', 'De første tal kommer om et par sekunder.');
  refreshAll();
}

function onTick(data) {
  for (const group of data.groups) state.groups.set(group.key, group);
  appendHistory();
  for (const lens of LENS_KEYS) pushCapped(state.headlineHistory[lens], data.headlines[lens]);
  state.headlines = data.headlines;
  state.totals = data.totals;
  deliver('onTick', data, renderTick);
}

function connect() {
  const stream = new EventSource(`/api/stream?t=${encodeURIComponent(token)}`);
  const on = (event, handler) => stream.addEventListener(event, (message) => handler(JSON.parse(message.data)));
  on('snapshot', onSnapshot);
  on('tick', onTick);
  on('inventory', (inventory) => {
    state.inventory = inventory;
    deliver('onInventory', null, renderInventoryMarks);
  });
  on('boot', (boot) => {
    state.boot = boot;
    deliver('onBoot', null, renderBootMark);
  });
  on('log', (entries) => {
    state.log = entries;
    deliver('onLog');
  });
  on('disk', (data) => {
    state.disk = data;
    deliver('onDisk');
  });
  on('problem', ({ message }) => {
    $('#problem-text').textContent = message;
    $('#problem').hidden = false;
  });
  stream.onerror = () => setStatus('Ingen forbindelse', 'offline', 'Er TrashGuard lukket? Start den fra genvejen.');
}

// ---------- Start ----------

for (const [name, module] of Object.entries(TABS)) module.mount($(`#tab-${name}`), context);
bindTablist($('#tabs'), (tab) => selectTab(tab.dataset.tab));
$('#refresh').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.classList.add('is-spinning');
  await run('/api/refresh', {}, button);
  button.classList.remove('is-spinning');
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && app.missedWhileHidden) refreshAll();
});
TABS[app.tab].show();
connect();
