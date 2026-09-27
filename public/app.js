import { token, $, el, icon, percent, oneDecimal, memoryParts, memory, cssColor, run, confirmButton, cancelConfirm, drawLine } from './ui.js';
import { initDisk, onDiskState, onDiskInventory, showDisk, hideDisk } from './disk.js';

const LENS_STORAGE_KEY = 'trashguard-lens';
// Én linse = én enhed. CPU og GPU i %, rangeret efter snit; RAM og VRAM i MB, rangeret efter nu.
const LENSES = {
  cpu: {
    memory: false, avg: 'avg', second: 'snit', totalLabel: 'Samlet CPU', total: (totals) => percent(totals.cpu),
    text: 'af din CPU går lige nu til ting i baggrunden, som du ikke selv har åbnet.',
    barFull: 25, graphMin: 5, sparkMin: 1, sortStep: 0.1,
  },
  ram: {
    memory: true, avg: null, second: 'privat', totalLabel: 'RAM brugt', total: (totals) => `${memory(totals.ramUsed)} af ${memory(totals.ramTotal)}`,
    text: 'af din RAM er optaget af ting i baggrunden, som du ikke selv har åbnet.',
    barFull: 4096, graphMin: 1024, sparkMin: 256, sortStep: 10,
  },
  gpu: {
    memory: false, avg: 'gpuAvg', second: 'snit', totalLabel: 'Samlet GPU', total: (totals) => percent(totals.gpu),
    text: 'af dit grafikkort går lige nu til ting i baggrunden, som du ikke selv har åbnet.',
    barFull: 25, graphMin: 5, sparkMin: 1, sortStep: 0.1,
  },
  vram: {
    memory: true, avg: null, second: null, totalLabel: 'VRAM brugt', total: (totals) => `${memory(totals.vramUsed)} af ${memory(totals.vramTotal)}`,
    text: 'af dit grafikkorts hukommelse er optaget af ting i baggrunden, som du ikke selv har åbnet.',
    barFull: 2048, graphMin: 512, sparkMin: 128, sortStep: 10,
  },
};
const SECTION_OF = { suspect: 'suspect', yours: 'yours', trusted: 'trusted', self: 'trusted', windows: 'windows', critical: 'windows', pending: 'windows' };
const START_MODE = { Auto: 'Automatisk', Manual: 'Manuel', Disabled: 'Deaktiveret', Boot: 'Driver', System: 'Driver' };
const LOCK_TEXT = {
  critical: 'Windows kan ikke køre uden denne proces, så Afslut er låst.',
  windows: 'Windows-fil signeret af Microsoft, så Afslut er låst. Tjenester og opgaver herunder kan stadig slås fra.',
  pending: 'Signaturen bliver tjekket. Afslut er låst så længe.',
  stopped: 'Kører ikke lige nu.',
  nopath: 'Windows skjuler stien til denne proces, så den kan ikke vurderes. Afslut er låst.',
  self: 'Det er TrashGuard selv.',
};

const state = {
  groups: new Map(),
  history: new Map(),
  headlineHistory: { cpu: [], ram: [], gpu: [], vram: [] },
  historyLength: 150,
  lens: readStoredLens(),
  headlines: { cpu: 0, ram: 0, gpu: 0, vram: 0 },
  totals: { cpu: 0, gpu: 0, ramUsed: 0, ramTotal: 0, vramUsed: 0, vramTotal: 0 },
  inventory: null,
  log: [],
  protectedServices: new Set(),
  selected: null,
  detailSignature: null,
  tab: 'live',
  needsRender: false,
};

const sections = Object.fromEntries([...document.querySelectorAll('.section')].map((section) => [section.dataset.section, section]));
const rows = new Map();

// ---------- Små hjælpere ----------

function readStoredLens() {
  try {
    const stored = localStorage.getItem(LENS_STORAGE_KEY);
    return stored in LENSES ? stored : 'cpu';
  } catch {
    return 'cpu';
  }
}

const lensValue = (lens, value) => (LENSES[lens].memory ? memory(value) : percent(value));

// ---------- Live-listen ----------

function isVisible(group) {
  return group.running || (group.category === 'suspect' && (group.avg > 0 || group.bloatText));
}

function tagsFor(group) {
  if (group.category !== 'suspect') return [];
  return [
    group.bloatText && el('span', { className: 'tag tag-bloat' }, 'Kendt bloat'),
    group.background.length && el('span', { className: 'tag' }, `Baggrund: ${group.background.join(', ')}`),
    group.autostart && el('span', { className: 'tag' }, group.autostartVia ? `Autostart via ${group.autostartVia}` : 'Autostart'),
    !group.running && el('span', { className: 'tag' }, 'Lukket nu'),
  ];
}

function subtitle(group) {
  const services = group.sources.filter((source) => source.kind === 'service').map((source) => source.label);
  if (services.length) return services.length > 2 ? `${services.slice(0, 2).join(', ')} og ${services.length - 2} mere` : services.join(', ');
  return group.desc || group.company || group.path || '';
}

function createRow(key) {
  const name = el('span', { className: 'row-name' });
  const sub = el('span', { className: 'row-sub' });
  const tags = el('div', { className: 'tags' });
  const now = el('span');
  const second = el('span');
  const secondLabel = el('small');
  const bar = el('span');
  const secondCell = el('div', { className: 'row-number' }, second, secondLabel);
  const node = el('li', { className: 'row', tabindex: '0', 'data-key': key },
    el('div', {}, name, sub, tags),
    el('div', { className: 'row-number' }, now, el('small', {}, 'nu')),
    secondCell,
    el('div', { className: 'row-bar' }, bar));
  node.addEventListener('click', () => select(key));
  node.addEventListener('keydown', (event) => { if (event.key === 'Enter') select(key); });
  const row = { node, name, sub, tags, now, second, secondLabel, secondCell, bar, last: null };
  rows.set(key, row);
  return row;
}

// Anden kolonne: snit for CPU og GPU, privat hukommelse for RAM, intet for VRAM.
function secondValue(group, lens) {
  const config = LENSES[lens];
  if (config.avg) return percent(group[config.avg]);
  return lens === 'ram' ? memory(group.priv) : '';
}

function patchRow(row, group) {
  const lens = state.lens;
  const config = LENSES[lens];
  const signature = [lens, group.name, subtitle(group), group[lens], secondValue(group, lens), group.category, group.running, group.background, group.autostart, group.bloatText].join('|');
  if (row.last === signature) return;
  row.last = signature;
  row.name.textContent = group.count > 1 ? `${group.name} (${group.count})` : group.name;
  row.sub.textContent = subtitle(group);
  row.tags.replaceChildren(...tagsFor(group).filter(Boolean));
  row.now.textContent = lensValue(lens, group[lens]);
  row.second.textContent = secondValue(group, lens);
  row.secondLabel.textContent = config.second ?? '';
  row.secondCell.hidden = !config.second;
  row.bar.style.width = `${Math.min(100, (group[lens] / config.barFull) * 100)}%`;
  row.node.classList.toggle('is-stopped', !group.running);
}

// Afrundet, så rækkerne ikke hopper rundt ved hvert lille udsving.
function sortGroups(groups, section) {
  const lens = state.lens;
  const { avg, sortStep } = LENSES[lens];
  const stable = (value) => Math.round(value / sortStep);
  const rank = (group) => (section === 'suspect' ? group.scores[lens] : group[avg ?? lens]);
  const byName = (a, b) => a.name.localeCompare(b.name, 'da');
  return groups.sort((a, b) => stable(rank(b)) - stable(rank(a))
    || (section === 'suspect' ? Number(Boolean(b.bloatText)) - Number(Boolean(a.bloatText)) : 0)
    || byName(a, b));
}

function renderList() {
  const bySection = { suspect: [], yours: [], trusted: [], windows: [] };
  for (const group of state.groups.values()) {
    if (isVisible(group)) bySection[SECTION_OF[group.category] ?? 'windows'].push(group);
  }
  const shown = new Set();
  for (const [section, groups] of Object.entries(bySection)) {
    const list = sections[section].querySelector('.rows');
    const ordered = sortGroups(groups, section);
    ordered.forEach((group, index) => {
      shown.add(group.key);
      const row = rows.get(group.key) ?? createRow(group.key);
      patchRow(row, group);
      row.node.setAttribute('aria-current', String(group.key === state.selected));
      if (list.children[index] !== row.node) list.insertBefore(row.node, list.children[index] ?? null);
    });
    sections[section].querySelector('.count').textContent = groups.length;
  }
  for (const [key, row] of rows) {
    if (shown.has(key)) continue;
    row.node.remove();
    rows.delete(key);
  }
  $('#fact-suspects').textContent = bySection.suspect.filter((group) => group.running).length;
}

// ---------- Detaljepanelet ----------

function select(key) {
  state.selected = key;
  state.detailSignature = null;
  render();
}

function closeDetail() {
  cancelConfirm();
  state.selected = null;
  state.detailSignature = null;
  render();
}

function sourceLabel(source) {
  if (source.kind === 'startup') return `Opstart: ${source.label}`;
  if (source.kind === 'task') return `Opgave: ${source.label}`;
  return `Tjeneste: ${source.label}`;
}

function chainFor(group) {
  const links = [];
  const arrow = () => icon('arrow-right-short');
  group.sources.forEach((source) => links.push(el('span', { className: 'chain-link chain-source' }, sourceLabel(source)), arrow()));
  for (const ancestor of group.ancestors) {
    const target = ancestor.key && state.groups.get(ancestor.key);
    links.push(target
      ? el('button', { type: 'button', className: 'chain-link', onclick: () => select(ancestor.key) }, ancestor.name)
      : el('span', { className: 'chain-link' }, ancestor.name), arrow());
  }
  links.push(el('span', { className: 'chain-link chain-self' }, group.count > 1 ? `${group.name} (${group.count} processer)` : group.name));
  return el('div', { className: 'chain', 'aria-label': 'Hvad programmet hænger sammen med' }, links);
}

// Slå fra kræver bekræftelse; at aktivere en deaktiveret tjeneste igen er ét klik.
function serviceButtons(service) {
  const act = (mode) => (button) => run('/api/action', { type: 'service', name: service.name, mode }, button);
  if (service.startMode === 'Disabled') {
    return [
      el('button', { type: 'button', className: 'button button-small button-signal', onclick: (event) => act('manual')(event.currentTarget) }, 'Aktivér (Manuel)'),
      el('button', { type: 'button', className: 'button button-small', onclick: (event) => act('auto')(event.currentTarget) }, 'Aktivér (Automatisk)'),
    ];
  }
  if (state.protectedServices.has(service.name.toLowerCase())) return [el('span', { className: 'lock-note' }, 'Låst: Windows har brug for den.')];
  if (!(service.startMode in { Auto: 1, Manual: 1 })) return [];
  const buttons = [];
  if (service.startMode === 'Auto' || service.state === 'Running') {
    buttons.push(confirmButton('Stop og sæt til Manuel', 'Bekræft: Manuel', act('manual'), 'button button-small button-signal'));
  }
  buttons.push(confirmButton('Deaktivér helt', 'Sikker? Intet kan starte den', act('disabled'), 'button button-small button-danger'));
  return buttons;
}

const serviceState = (service) => `${START_MODE[service.startMode] ?? service.startMode}${service.delayed ? ' (forsinket)' : ''}, ${service.state === 'Running' ? 'kører' : 'stoppet'}`;

function serviceActions(source) {
  const service = state.inventory?.services.find((candidate) => candidate.name === source.id);
  const text = el('p', { className: 'action-text' }, sourceLabel(source), el('small', {}, service ? serviceState(service) : ''));
  return el('div', { className: 'action' }, text, service ? serviceButtons(service) : []);
}

function toggleAction(source) {
  const isStartup = source.kind === 'startup';
  const offLabel = isStartup ? 'Slå fra ved opstart' : 'Deaktivér opgave';
  const onLabel = isStartup ? 'Slå til ved opstart' : 'Aktivér opgave';
  const text = el('p', { className: 'action-text' }, sourceLabel(source), el('small', {}, source.enabled ? 'Aktiv' : 'Slået fra'));
  const button = el('button', {
    type: 'button',
    className: `button button-small${source.enabled ? ' button-signal' : ''}`,
    onclick: (event) => run('/api/action', { type: source.kind, id: source.id, enable: !source.enabled }, event.currentTarget),
  }, source.enabled ? offLabel : onLabel);
  return el('div', { className: 'action' }, text, button);
}

// Detaljepanelet viser altid alle fire ressourcer, uanset linse.
const DETAIL_STATS = [
  ['cpu', 'CPU nu', percent], ['avg', 'CPU snit', percent], ['gpu', 'GPU nu', percent], ['gpuAvg', 'GPU snit', percent],
  ['ram', 'RAM', memory], ['priv', 'Privat RAM', memory], ['vram', 'VRAM', memory], ['count', 'Processer', String],
];

function detailSignature(group) {
  return JSON.stringify([group.key, group.sources, group.killLocked, group.lock, group.category, group.running, group.bloatText, group.ancestors, group.count, group.desc, group.signer, state.inventory ? 1 : 0]);
}

function buildDetail(group) {
  const trusted = group.category === 'trusted';
  const meta = [group.path, group.signer ? `Signeret af ${group.signer}` : group.signed === false ? 'Ikke signeret' : null].filter(Boolean);
  const killRow = group.killLocked
    ? el('p', { className: 'lock-note' }, LOCK_TEXT[group.lock] ?? 'Afslut er låst.')
    : el('div', { className: 'action' },
      el('p', { className: 'action-text' }, 'Afslut nu', el('small', {}, 'Kan ikke fortrydes. Den kommer igen, hvis noget starter den.')),
      confirmButton('Afslut', `Bekræft: afslut ${group.count} ${group.count === 1 ? 'proces' : 'processer'}`, (button) => run('/api/action', { type: 'kill', key: group.key }, button), 'button button-small button-danger'));

  return el('div', {},
    el('div', { className: 'detail-head' },
      el('div', {}, el('h2', { className: 'detail-title' }, group.desc || group.name),
        el('p', { className: 'detail-meta' }, [group.desc ? group.name : null, group.company].filter(Boolean).join(', '))),
      el('button', { type: 'button', className: 'detail-close', 'aria-label': 'Luk', onclick: closeDetail }, icon('x-lg'))),
    meta.length ? el('p', { className: 'detail-meta' }, meta.join('. ')) : null,
    group.bloatText ? el('p', { className: 'detail-bloat' }, group.bloatText) : null,
    chainFor(group),
    el('dl', { className: 'detail-stats' },
      DETAIL_STATS.map(([stat, label]) => el('div', {}, el('dt', {}, label), el('dd', { 'data-stat': stat })))),
    el('canvas', { className: 'spark', 'aria-label': 'CPU-forbrug i denne session' }),
    el('div', { className: 'actions' },
      killRow,
      group.sources.map((source) => (source.kind === 'service' ? serviceActions(source) : toggleAction(source))),
      el('div', { className: 'action' },
        el('p', { className: 'action-text' }, trusted ? 'Du stoler på den' : 'Stol på den', el('small', {}, trusted ? 'Den bliver ikke foreslået som synder.' : 'Flyt den ud af Syndere, så den ikke bliver foreslået igen.')),
        el('button', { type: 'button', className: 'button button-small', onclick: (event) => run('/api/trust', { key: group.key }, event.currentTarget) }, trusted ? 'Fjern tillid' : 'Stol på'))));
}

function renderDetail() {
  const panel = $('#detail');
  const group = state.selected && state.groups.get(state.selected);
  if (!group) {
    if (state.detailSignature !== 'empty') {
      panel.replaceChildren(el('p', { className: 'empty' }, 'Vælg et program på listen for at se, hvad det hænger sammen med.'));
      state.detailSignature = 'empty';
    }
    return;
  }
  const signature = detailSignature(group);
  if (signature !== state.detailSignature) {
    cancelConfirm();
    panel.replaceChildren(buildDetail(group));
    state.detailSignature = signature;
  }
  for (const [stat, , format] of DETAIL_STATS) panel.querySelector(`[data-stat="${stat}"]`).textContent = format(group[stat]);
  drawLine(panel.querySelector('.spark'), state.history.get(group.key)?.[state.lens] ?? [], LENSES[state.lens].sparkMin, cssColor('--signal'), state.historyLength);
}

// ---------- Opstart og baggrund ----------

function stateCell(enabled, running) {
  return el('td', {}, el('span', { className: enabled ? '' : 'state-off' }, enabled ? 'Til' : 'Fra'),
    running ? el('span', { className: 'state-running' }, ', kører nu') : null);
}

function nameCell(title, sub, item) {
  return el('td', {}, title,
    sub ? el('div', { className: 'cell-path' }, sub) : null,
    el('div', { className: 'tags' },
      item.bloatText && el('span', { className: 'tag tag-bloat', title: item.bloatText }, 'Kendt bloat'),
      item.orphan && el('span', { className: 'tag tag-orphan' }, 'Filen findes ikke')));
}

const header = (...titles) => el('thead', {}, el('tr', {}, titles.map((title) => el('th', {}, title))));
const byBloatThenName = (a, b) => Number(Boolean(b.bloatText || b.orphan)) - Number(Boolean(a.bloatText || a.orphan)) || String(a.name).localeCompare(String(b.name), 'da');

function renderStartupTab() {
  const inventory = state.inventory;
  if (!inventory) return;
  const showWindows = $('#show-windows').checked;
  const running = new Set([...state.groups.values()].filter((group) => group.running && group.path).map((group) => group.path.toLowerCase()));
  const isRunning = (exe) => Boolean(exe && running.has(exe.toLowerCase()));

  $('#table-startup').replaceChildren(header('Navn', 'Program', 'Status', ''), el('tbody', {},
    [...inventory.startup].sort(byBloatThenName).map((item) => el('tr', {},
      nameCell(item.name, item.type === 'folder' ? 'Startmappen' : `Registreringsdatabasen (${item.scope})`, item),
      el('td', { className: 'cell-path' }, item.exe || item.command),
      stateCell(item.enabled, isRunning(item.exe)),
      el('td', {}, el('button', { type: 'button', className: 'button button-small', onclick: (event) => run('/api/action', { type: 'startup', id: item.id, enable: !item.enabled }, event.currentTarget) }, item.enabled ? 'Slå fra' : 'Slå til'))))));

  const tasks = inventory.tasks.filter((task) => showWindows || !task.microsoft || task.bloatText);
  $('#table-tasks').replaceChildren(header('Navn', 'Program', 'Status', ''), el('tbody', {},
    tasks.sort(byBloatThenName).map((task) => el('tr', {},
      nameCell(task.name, task.path, task),
      el('td', { className: 'cell-path' }, task.exe || 'Intet program (intern Windows-handling)'),
      stateCell(task.enabled, isRunning(task.exe)),
      el('td', {}, el('button', { type: 'button', className: 'button button-small', onclick: (event) => run('/api/action', { type: 'task', id: task.id, enable: !task.enabled }, event.currentTarget) }, task.enabled ? 'Deaktivér' : 'Aktivér'))))));

  // Deaktiverede står altid øverst og skjules aldrig, så de er hurtige at aktivere igen.
  const isDisabled = (service) => service.startMode === 'Disabled';
  const services = inventory.services.filter((service) => showWindows || !service.windows || service.bloatText || isDisabled(service));
  $('#table-services').replaceChildren(header('Navn', 'Program', 'Opstart', ''), el('tbody', {},
    services.sort((a, b) => Number(isDisabled(b)) - Number(isDisabled(a)) || byBloatThenName({ ...a, name: a.display }, { ...b, name: b.display })).map((service) => el('tr', {},
      nameCell(service.display, service.name, service),
      el('td', { className: 'cell-path' }, service.exe || ''),
      el('td', {}, `${START_MODE[service.startMode] ?? service.startMode}${service.delayed ? ' (forsinket)' : ''}`,
        el('div', { className: service.state === 'Running' ? 'state-running' : 'state-off' }, service.state === 'Running' ? 'Kører' : 'Stoppet')),
      el('td', {}, el('div', { className: 'cell-actions' }, serviceButtons(service)))))));
}

// ---------- Log ----------

function renderLog() {
  const list = $('#log');
  if (!state.log.length) {
    list.replaceChildren(el('li', {}, 'Ingen handlinger endnu. Alt, du slår fra, bliver skrevet her, så du kan fortryde det.'));
    return;
  }
  list.replaceChildren(...state.log.map((entry) => el('li', {},
    el('time', { datetime: new Date(entry.at).toISOString() }, new Date(entry.at).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' })),
    el('span', { className: `log-label${entry.undone ? ' is-undone' : ''}` }, entry.label),
    entry.undoable && !entry.undone
      ? el('button', { type: 'button', className: 'button button-small', onclick: (event) => run('/api/undo', { id: entry.id }, event.currentTarget) }, 'Fortryd')
      : el('span', { className: 'state-off' }, entry.undone ? 'Fortrudt' : entry.type === 'recycle' ? 'Gendan fra papirkurven' : 'Kan ikke fortrydes'))));
}

// ---------- Samlet rendering ----------

function renderHero() {
  const lens = state.lens;
  const config = LENSES[lens];
  const value = state.headlines[lens];
  const [number, unit] = config.memory ? memoryParts(value) : [oneDecimal(value), '%'];
  $('#headline').textContent = number;
  $('#headline-unit').textContent = unit;
  $('#headline-text').textContent = config.text;
  $('#fact-total-label').textContent = config.totalLabel;
  $('#fact-total').textContent = config.total(state.totals);
  for (const button of document.querySelectorAll('.lens')) {
    button.setAttribute('aria-pressed', String(button.dataset.lens === lens));
    button.querySelector('.lens-value').textContent = lensValue(button.dataset.lens, state.headlines[button.dataset.lens]);
  }
  drawLine($('#headline-graph'), state.headlineHistory[lens], config.graphMin, cssColor('--signal'), state.historyLength);
}

function renderOrphans() {
  const inventory = state.inventory;
  if (!inventory) return;
  const orphans = [...inventory.startup, ...inventory.tasks, ...inventory.services].filter((item) => item.orphan && item.enabled !== false && item.startMode !== 'Disabled');
  $('#fact-orphans').textContent = orphans.length;
  $('#admin-banner').hidden = inventory.admin;
}

function render() {
  if (document.hidden) {
    state.needsRender = true;
    return;
  }
  state.needsRender = false;
  renderHero();
  if (state.tab === 'live') {
    renderList();
    renderDetail();
  }
}

// ---------- Strømmen fra serveren ----------

const pushCapped = (list, value) => {
  list.push(value);
  if (list.length > state.historyLength) list.shift();
};

// Uændrede grupper sendes ikke, men deres tal er de samme som sidst, så alle får et punkt.
function appendHistory() {
  for (const [key, group] of state.groups) {
    const history = state.history.get(key) ?? { cpu: [], ram: [], gpu: [], vram: [] };
    for (const lens of Object.keys(LENSES)) pushCapped(history[lens], group[lens]);
    state.history.set(key, history);
  }
}

function onSnapshot(data) {
  state.groups = new Map(data.groups.map((group) => [group.key, group]));
  state.history = new Map(Object.entries(data.history));
  state.headlineHistory = data.headlineHistory;
  state.headlines = data.headlines;
  state.totals = data.totals;
  state.inventory = data.inventory;
  state.log = data.log;
  state.protectedServices = new Set(data.protectedServices);
  onDiskInventory(data.inventory?.drives);
  onDiskState(data.disk);
  renderOrphans();
  renderLog();
  if (state.tab === 'startup') renderStartupTab();
  render();
}

function onTick(data) {
  for (const group of data.groups) state.groups.set(group.key, group);
  appendHistory();
  for (const lens of Object.keys(LENSES)) pushCapped(state.headlineHistory[lens], data.headlines[lens]);
  state.headlines = data.headlines;
  state.totals = data.totals;
  $('#status').textContent = 'Live';
  $('#status').classList.add('is-live');
  render();
}

function connect() {
  const stream = new EventSource(`/api/stream?t=${encodeURIComponent(token)}`);
  const on = (event, handler) => stream.addEventListener(event, (message) => handler(JSON.parse(message.data)));
  on('snapshot', (data) => {
    $('#status').textContent = data.inventory ? 'Måler… (første tal kommer om et par sekunder)' : 'Læser opstart og tjenester…';
    $('#status').classList.remove('is-live');
    onSnapshot(data);
  });
  on('tick', onTick);
  on('inventory', (inventory) => {
    state.inventory = inventory;
    onDiskInventory(inventory.drives);
    renderOrphans();
    if (state.tab === 'startup') renderStartupTab();
    state.detailSignature = null;
    render();
  });
  on('log', (log) => { state.log = log; renderLog(); });
  on('disk', onDiskState);
  on('problem', ({ message }) => { $('#problem').textContent = message; $('#problem').hidden = false; });
  stream.onerror = () => {
    $('#status').textContent = 'Ingen forbindelse. Er TrashGuard lukket? Start den fra genvejen.';
    $('#status').classList.remove('is-live');
  };
}

// ---------- Faner og knapper ----------

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    if (state.tab === tab.dataset.tab) return;
    if (state.tab === 'disk') hideDisk();
    state.tab = tab.dataset.tab;
    for (const other of document.querySelectorAll('.tab')) other.setAttribute('aria-selected', String(other === tab));
    for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== `tab-${state.tab}`;
    // Overskriften handler om processer; på Disk-fanen skal kortet have pladsen.
    $('.hero').hidden = state.tab === 'disk';
    if (state.tab === 'startup') renderStartupTab();
    if (state.tab === 'disk') showDisk();
    render();
  });
}

for (const button of document.querySelectorAll('.lens')) {
  button.addEventListener('click', () => {
    state.lens = button.dataset.lens;
    try {
      localStorage.setItem(LENS_STORAGE_KEY, state.lens);
    } catch {
      // Privat vindue eller blokeret lager: linsen huskes bare ikke.
    }
    render();
  });
}

$('#show-windows').addEventListener('change', renderStartupTab);
$('#refresh').addEventListener('click', (event) => run('/api/refresh', {}, event.currentTarget));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.selected) closeDetail(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.needsRender) render(); });
window.addEventListener('resize', () => render());

initDisk();
connect();
