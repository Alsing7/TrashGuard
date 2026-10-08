// Live-fanen: overskriften med linser og spol tilbage, boblefeltet (field.js), listen og detaljen (docs/design.md, Live).
import {
  el, setChildren, icon, chip, toggle, cssColor, run, confirmButton, cancelConfirm, drawLine, serviceControl, startModeLabel,
  percentParts, percent, memoryParts, memory,
} from './ui.js';
import { mountField, startField, stopField, renderField, renderLegend, selectBubble, popBubble, FULL_RELAX } from './field.js';

// Én linse = én enhed. rankBy sorterer listen; fieldMin er det forbrug, der fylder feltet; idle er grænsen for "i hvile".
const LENSES = {
  cpu: {
    name: 'CPU', text: "af CPU'en går til ting, du ikke selv har åbnet", rankBy: 'avg', parts: percentParts,
    second: { key: 'avg', label: 'snit', format: percent },
    used: (totals) => totals.cpu, capacity: () => 100, total: (totals) => `${percent(totals.cpu)} i alt`,
    graphMin: 5, sparkMin: 1, sortStep: 0.1, fieldMin: 5, idle: 0.05,
  },
  ram: {
    name: 'RAM', text: 'RAM optaget af ting, du ikke selv har åbnet', rankBy: 'ram', parts: memoryParts,
    second: { key: 'priv', label: 'privat', format: memory },
    used: (totals) => totals.ramUsed, capacity: (totals) => totals.ramTotal, total: (totals) => `${memory(totals.ramUsed)} af ${memory(totals.ramTotal)} brugt`,
    graphMin: 1024, sparkMin: 256, sortStep: 10, fieldMin: 4096, idle: 1,
  },
  gpu: {
    name: 'GPU', text: 'af grafikkortet går til ting, du ikke selv har åbnet', rankBy: 'gpuAvg', parts: percentParts,
    second: { key: 'gpuAvg', label: 'snit', format: percent },
    used: (totals) => totals.gpu, capacity: () => 100, total: (totals) => `${percent(totals.gpu)} i alt`,
    graphMin: 5, sparkMin: 1, sortStep: 0.1, fieldMin: 5, idle: 0.05,
  },
  vram: {
    name: 'VRAM', text: 'VRAM optaget af ting, du ikke selv har åbnet', rankBy: 'vram', parts: memoryParts,
    second: null,
    used: (totals) => totals.vramUsed, capacity: (totals) => totals.vramTotal, total: (totals) => `${memory(totals.vramUsed)} af ${memory(totals.vramTotal)} brugt`,
    graphMin: 512, sparkMin: 128, sortStep: 10, fieldMin: 1024, idle: 1,
  },
};
const LENS_KEYS = Object.keys(LENSES);
const SECTIONS = { suspect: 'Syndere', yours: 'Dine programmer', trusted: 'Du stoler på', windows: 'Windows selv' };
const SECTION_OF = { suspect: 'suspect', yours: 'yours', trusted: 'trusted', self: 'trusted', windows: 'windows', critical: 'windows', pending: 'windows' };
const CATEGORY_CHIP = { suspect: 'Synder', yours: 'Dit program', trusted: 'Du stoler på', self: 'TrashGuard selv', windows: 'Windows', critical: 'Windows, kritisk', pending: 'Tjekkes' };
const LOCK_TEXT = {
  critical: 'Afslut er låst: Windows kan ikke køre uden den',
  windows: 'Afslut er låst: Windows-fil signeret af Microsoft',
  pending: 'Afslut er låst, mens signaturen tjekkes',
  stopped: 'Kører ikke lige nu',
  nopath: 'Afslut er låst: Windows skjuler stien',
  self: 'Det er TrashGuard selv',
};
const SOURCE_KIND = { startup: ['power', 'Opstart'], task: ['calendar-check', 'Opgave'], service: ['gear', 'Tjeneste'] };
// Detaljens fire ressourcefelter: [tal, etiket, format, andet tal, dets etiket, dets format].
const DETAIL_STATS = [
  ['cpu', 'CPU', percent, 'avg', 'snit', percent],
  ['ram', 'RAM', memory, 'priv', 'privat', memory],
  ['gpu', 'GPU', percent, 'gpuAvg', 'snit', percent],
  ['vram', 'VRAM', memory, null, null, null],
];
// Tallet tæller i trin over TWEEN_MS (et trin hver 80 ms, ikke hvert billede: hvert trin koster et billede).
const TWEEN_MS = 400;
const TWEEN_STEPS = 5;
// Serverens sampleIntervalMs: 150 punkter er 5 minutter.
const SAMPLE_MS = 2000;
const CURVE_LINE = 3;
const SPARK_LINE = 2;
// Som drawLine i ui.js: kurven slutter ved prikken, der er stregen + 1 px.
const CURVE_DOT = CURVE_LINE + 1;
// Tættere på kanten end dette står spol tilbage-etiketten på den anden side af markøren.
const SCRUB_LABEL_ROOM = 90;
const SCRUB_KEYS = { ArrowLeft: 1, ArrowRight: -1, PageUp: 15, PageDown: -15 };
const SCRUB_SHIFT_FACTOR = 15;
const WIDE_QUERY = '(min-width: 1180px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const lensButton = (lens) => `
  <button type="button" class="lens" data-lens="${lens}" data-res="${lens}" aria-pressed="false">
    <span class="lens-name">${LENSES[lens].name}</span><span class="lens-value"></span>
    <span class="lens-top"><span class="bi bi-fire" aria-hidden="true"></span><span class="visually-hidden">, bruger mest: </span><span class="lens-top-name"></span><b class="lens-top-value"></b></span>
    <canvas class="lens-spark" aria-hidden="true"></canvas>
  </button>`;
const sectionMarkup = ([section, name]) => `
  <details class="section" data-section="${section}" data-cat="${section}"${section === 'suspect' ? ' open' : ''}>
    <summary><span class="dot" aria-hidden="true"></span><span class="section-name">${name}</span><span class="count"></span><span class="bi bi-chevron-right section-chevron" aria-hidden="true"></span><span class="col-head">nu</span><span class="col-head is-second"></span></summary>
    <ol class="rows"></ol>
  </details>`;

const TEMPLATE = `
  <div class="lenses" role="group" aria-label="Vælg, hvad der skal måles">${LENS_KEYS.map(lensButton).join('')}</div>
  <div class="hero">
    <div class="hero-main">
      <div class="hero-number">
        <p class="headline"><span class="headline-number">–</span><span class="headline-unit"></span></p>
        <p class="top-user" title="Bruger mest lige nu"><span class="bi bi-fire" aria-hidden="true"></span><span class="visually-hidden">Bruger mest lige nu: </span><span class="top-name"></span><b class="top-value"></b></p>
      </div>
      <p class="headline-text"></p>
      <div class="meter" aria-hidden="true"><span class="meter-rest"></span><span class="meter-bg"></span></div>
      <p class="meter-labels"><span class="meter-key">baggrund</span><span class="meter-key is-rest">andet <b class="meter-rest-value"></b></span><span class="meter-total"></span></p>
    </div>
    <figure class="hero-graph">
      <div class="curve" tabindex="0" role="slider" aria-label="Spol tilbage i de seneste 5 minutter" aria-valuemin="0" aria-valuemax="149" aria-valuenow="149" aria-valuetext="Nu">
        <canvas class="curve-canvas" aria-hidden="true"></canvas>
        <div class="scrub" aria-hidden="true"><span class="scrub-label"><b class="scrub-value"></b><span class="scrub-time"></span></span></div>
      </div>
      <figcaption class="axis" aria-hidden="true"><span>−5 min</span><span>−4</span><span>−3</span><span>−2</span><span>−1</span><span>nu</span></figcaption>
    </figure>
  </div>
  <div class="live">
    <div class="field" role="group" aria-label="Programmerne som bobler. Størrelse er forbrug lige nu, farve er kategori. Listen har de samme programmer."></div>
    <div class="list">${Object.entries(SECTIONS).map(sectionMarkup).join('')}</div>
    <aside class="detail" aria-label="Detaljer" hidden></aside>
  </div>`;

// Fælles tilstand fra app.js (samme objekt hele tiden) og fanens egen visningstilstand.
let state = null;
let context = null;
const view = {
  active: false,
  rows: new Map(),
  // Rækkernes rang i den nuværende linse (se stickyRank).
  ranks: new Map(),
  selected: null,
  detailSignature: null,
  detail: null,
  scrub: null,
  scrubFrame: 0,
  scrubPending: null,
  tween: { timer: 0, lens: null, value: 0 },
  sizes: new Map(),
  colors: {},
  // Sidst skrevne værdier, så et tick kun skriver det, der er ændret.
  written: new Map(),
};

// ---------- Små hjælpere ----------

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sectionOf = (group) => SECTION_OF[group.category] ?? 'windows';
const isVisible = (group) => group.running || (group.category === 'suspect' && (group.avg > 0 || group.bloatText));
const serviceLabel = (group) => group.sources.find((source) => source.kind === 'service')?.label;
// Menneskenavnet først: beskrivelsen, ellers den første tjeneste, ellers exe-navnet. Nogle filer har " " som beskrivelse.
const humanName = (group) => group.desc?.trim() || serviceLabel(group) || group.name;
const processes = (count) => `${count} ${count === 1 ? 'proces' : 'processer'}`;

// Skifter tekstknudens data, når der er én, så layoutet ikke skal bygge en ny knude.
function setText(node, text) {
  const first = node.firstChild;
  if (first && first === node.lastChild && first.nodeType === Node.TEXT_NODE) {
    if (first.data !== text) first.data = text;
  } else if (node.textContent !== text) node.textContent = text;
}

const lensText = (lens, value) => LENSES[lens].parts(value).join(' ');
const byName = new Intl.Collator('da').compare;

function setAttr(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

function write(key, value, apply) {
  if (view.written.get(key) === value) return;
  view.written.set(key, value);
  apply(value);
}

function ago(offset) {
  const seconds = Math.round((offset * SAMPLE_MS) / 1000);
  const minutes = Math.floor(seconds / 60);
  if (!minutes) return `for ${seconds} s siden`;
  return seconds % 60 ? `for ${minutes} min ${seconds % 60} s siden` : `for ${minutes} min siden`;
}

function groupsBySection() {
  const bySection = Object.fromEntries(Object.keys(SECTIONS).map((section) => [section, []]));
  for (const group of state.groups.values()) if (isVisible(group)) bySection[sectionOf(group)].push(group);
  return bySection;
}

// ---------- Overskriften ----------

// Den gruppe, der bruger mest af hver ressource lige nu, på tværs af kategorierne.
function topUsers() {
  const top = Object.fromEntries(LENS_KEYS.map((lens) => [lens, null]));
  for (const group of state.groups.values()) {
    if (!group.running) continue;
    for (const lens of LENS_KEYS) if (group[lens] > (top[lens]?.[lens] ?? 0)) top[lens] = group;
  }
  return top;
}

function patchTopUser(parts, lens, group) {
  setHidden(parts.top, !group);
  if (!group) return;
  setText(parts.topName, humanName(group));
  setText(parts.topValue, lensText(lens, group[lens]));
}

function renderLenses(top) {
  for (const lens of LENS_KEYS) {
    const parts = view.lenses[lens];
    setAttr(parts.button, 'aria-pressed', String(lens === state.lens));
    setText(parts.value, lensText(lens, state.headlines[lens]));
    patchTopUser(parts, lens, top[lens]);
  }
}

function writeHeadline(lens, value) {
  const [number, unit] = LENSES[lens].parts(value);
  setText(view.hero.number, number);
  setText(view.hero.unit, unit);
}

// Tallet tæller op eller ned til den nye værdi i TWEEN_STEPS trin. Et linseskift springer direkte.
function countTo(lens, value) {
  const tween = view.tween;
  const from = tween.lens === lens ? tween.value : value;
  clearTimeout(tween.timer);
  tween.lens = lens;
  if (from === value || view.reducedMotion.matches) {
    tween.value = value;
    writeHeadline(lens, value);
    return;
  }
  let step = 0;
  const next = () => {
    step += 1;
    const progress = step / TWEEN_STEPS;
    tween.value = step === TWEEN_STEPS ? value : from + (value - from) * (1 - (1 - progress) ** 3);
    writeHeadline(lens, tween.value);
    tween.timer = step < TWEEN_STEPS ? setTimeout(next, TWEEN_MS / TWEEN_STEPS) : 0;
  };
  next();
}

const meterShift = (share) => `translateX(${((clamp(share, 0, 1) - 1) * 100).toFixed(1)}%)`;

function renderHero(top) {
  const lens = state.lens;
  const config = LENSES[lens];
  const hero = view.hero;
  const value = state.headlines[lens];
  const used = config.used(state.totals);
  const capacity = config.capacity(state.totals);
  setAttr(hero.node, 'data-res', lens);
  setAttr(hero.node, 'data-at', String(LENS_KEYS.indexOf(lens)));
  countTo(lens, value);
  setText(hero.text, config.text);
  patchTopUser(hero, lens, top[lens]);
  write('meter-bg', meterShift(capacity ? value / capacity : 0), (shift) => { hero.meterBg.style.transform = shift; });
  write('meter-rest', meterShift(capacity ? used / capacity : 0), (shift) => { hero.meterRest.style.transform = shift; });
  setText(hero.restValue, lensText(lens, Math.max(0, used - value)));
  setText(hero.total, config.total(state.totals));
}

// Lærrederne tegnes kun, når observeren har givet deres størrelse, så tegningen aldrig læser layoutet.
function drawSized(canvas, values, minScale, color, lineWidth) {
  const size = view.sizes.get(canvas);
  if (!size?.width || !size.height) return;
  drawLine(canvas, values, minScale, color, state.historyLength, { lineWidth, size });
}

function drawCurves() {
  const lens = state.lens;
  drawSized(view.hero.canvas, state.headlineHistory[lens], LENSES[lens].graphMin, view.colors.ink, CURVE_LINE);
  for (const key of LENS_KEYS) {
    if (key !== lens) drawSized(view.lenses[key].spark, state.headlineHistory[key], LENSES[key].graphMin, view.colors[key], SPARK_LINE);
  }
  drawDetailSpark();
}

// ---------- Spol tilbage ----------

function curveStep(width) {
  return (width - CURVE_DOT) / Math.max(1, state.historyLength - 1);
}

function offsetAt(event) {
  const size = view.sizes.get(view.hero.canvas);
  if (!size) return null;
  return Math.round((size.width - CURVE_DOT - event.offsetX) / curveStep(size.width));
}

function queueScrub(offset) {
  view.scrubPending = offset;
  view.scrubFrame ||= requestAnimationFrame(() => {
    view.scrubFrame = 0;
    scrubTo(view.scrubPending);
  });
}

function scrubTo(offset) {
  const length = state.headlineHistory[state.lens].length;
  if (offset === null || length < 2) return leaveScrub();
  const next = clamp(offset, 0, length - 1);
  if (next === view.scrub) return;
  view.scrub = next;
  renderScrub();
  renderBubbles();
}

function leaveScrub() {
  cancelAnimationFrame(view.scrubFrame);
  view.scrubFrame = 0;
  if (view.scrub === null) return;
  view.scrub = null;
  renderScrub();
  renderBubbles();
}

function renderScrub() {
  const { curve, scrub, scrubValue, scrubTime, canvas } = view.hero;
  const history = state.headlineHistory[state.lens];
  const newest = Math.max(0, history.length - 1);
  const offset = view.scrub;
  curve.classList.toggle('is-scrubbing', offset !== null);
  setAttr(curve, 'aria-valuemax', String(newest));
  setAttr(curve, 'aria-valuenow', String(newest - (offset ?? 0)));
  if (offset === null) {
    setAttr(curve, 'aria-valuetext', 'Nu');
    return;
  }
  const value = lensText(state.lens, history[newest - offset] ?? 0);
  const when = offset ? ago(offset) : 'nu';
  setText(scrubValue, value);
  setText(scrubTime, when);
  setAttr(curve, 'aria-valuetext', `${when}: ${value}`);
  const size = view.sizes.get(canvas);
  if (!size) return;
  const x = size.width - CURVE_DOT - offset * curveStep(size.width);
  scrub.style.transform = `translateX(${x.toFixed(1)}px)`;
  scrub.classList.toggle('is-left', x < SCRUB_LABEL_ROOM);
  scrub.classList.toggle('is-right', x > size.width - SCRUB_LABEL_ROOM);
}

function onCurveKey(event) {
  if (event.key === 'Escape') {
    if (view.scrub === null) return;
    event.stopPropagation();
    leaveScrub();
    return;
  }
  const oldest = state.headlineHistory[state.lens].length - 1;
  const jumps = { Home: oldest, End: 0 };
  if (event.key in jumps) {
    event.preventDefault();
    scrubTo(jumps[event.key]);
    return;
  }
  const step = SCRUB_KEYS[event.key];
  if (!step) return;
  event.preventDefault();
  scrubTo((view.scrub ?? 0) + step * (event.shiftKey ? SCRUB_SHIFT_FACTOR : 1));
}

function bindCurve(curve) {
  curve.addEventListener('pointerdown', (event) => {
    curve.setPointerCapture(event.pointerId);
    queueScrub(offsetAt(event));
  });
  curve.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse' || curve.hasPointerCapture(event.pointerId)) queueScrub(offsetAt(event));
  });
  curve.addEventListener('pointerup', (event) => { if (event.pointerType !== 'mouse') leaveScrub(); });
  curve.addEventListener('pointercancel', leaveScrub);
  curve.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') leaveScrub(); });
  curve.addEventListener('keydown', onCurveKey);
  curve.addEventListener('blur', leaveScrub);
}

// ---------- Boblefeltet ----------

// Nu: de synlige grupper. Spol tilbage: værdien for offset punkter siden; grupper med kortere historik er ikke med.
function fieldEntries() {
  const lens = state.lens;
  const offset = view.scrub;
  const entries = [];
  for (const group of state.groups.values()) {
    let value = group.running ? group[lens] : 0;
    if (offset === null) {
      if (!isVisible(group)) continue;
    } else {
      const history = state.history.get(group.key)?.[lens];
      value = history?.[history.length - 1 - offset];
      if (value === undefined || !(value > 0 || isVisible(group))) continue;
    }
    const steady = offset === null ? group[LENSES[lens].rankBy] : value;
    entries.push({ key: group.key, section: sectionOf(group), value, steady, group, stopped: offset === null && !group.running, bloat: Boolean(group.bloatText) });
  }
  return entries;
}

function describeBubble(item) {
  const name = humanName(item.group);
  const value = lensText(state.lens, item.value);
  return { name: name.replace(/\.exe$/i, ''), value, title: `${name}: ${value}` };
}

function renderBubbles(steps) {
  const config = LENSES[state.lens];
  renderField(fieldEntries(), { fieldMin: config.fieldMin, idle: config.idle, steps, keepMissing: view.scrub !== null, describe: describeBubble });
}

// Forklaringen og "+N" er genveje: de åbner kategorien i listen.
function openSection(section) {
  if (!view.wide.matches) closeDetail();
  const details = view.sections[section].node;
  details.open = true;
  details.scrollIntoView({ behavior: view.reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
}

// ---------- Listen ----------

function tagsFor(group) {
  if (group.category !== 'suspect') return [];
  const via = group.autostartVia;
  // Baggrund viser kun ressourcerne ved månen; skærmlæseren får ordet med.
  const background = group.background.length && chip(group.background.join(' '), { iconName: 'moon-stars', title: `Baggrund: ${group.background.join(', ')}` });
  if (background) background.prepend(el('span', { className: 'visually-hidden' }, 'Baggrund: '));
  return [
    group.bloatText && chip('Kendt bloat', { iconName: 'trash3', tone: 'junk', title: group.bloatText }),
    background,
    group.autostart && chip(el('span', { className: 'chip-text' }, via ? `via ${via.replace(/\.exe$/i, '')}` : 'Autostart'), { iconName: 'power', title: via ? `Autostart via ${via}` : 'Starter automatisk' }),
    !group.running && chip('Lukket nu', { tone: 'dashed' }),
  ].filter(Boolean);
}

function createRow(key) {
  const name = el('span', { className: 'row-name' });
  const exe = el('span', { className: 'row-exe' });
  const chips = el('span', { className: 'chips row-chips' });
  const now = el('span', { className: 'row-number' });
  const second = el('span', { className: 'row-number is-second' });
  const button = el('button', { type: 'button', className: 'row', 'data-key': key },
    el('span', { className: 'row-main' }, el('span', { className: 'row-title' }, name, exe), chips), now, second);
  const row = { node: el('li', {}, button), button, name, exe, chips, now, second, group: null, lens: null, current: false, look: null, numbers: null };
  view.rows.set(key, row);
  return row;
}

// app.js skifter kun de ændrede grupper ud, så en række med samme gruppeobjekt og linse er allerede rigtig.
function patchRow(row, group, lens) {
  if (row.group === group && row.lens === lens) return;
  row.group = group;
  row.lens = lens;
  const look =[humanName(group), group.name, group.count, group.running, group.category, group.bloatText, group.background.join(), group.autostart, group.autostartVia].join('|');
  if (row.look !== look) {
    row.look = look;
    const name = humanName(group);
    row.name.textContent = name;
    row.exe.textContent = [name === group.name ? '' : group.name, group.count > 1 ? `(${group.count})` : ''].join(' ').trim();
    row.button.title = `${name}${name === group.name ? '' : `, ${group.name}`}, ${processes(group.count)}`;
    setChildren(row.chips, tagsFor(group));
    row.button.classList.toggle('is-stopped', !group.running);
  }
  const second = LENSES[lens].second;
  const numbers = `${lens}|${group[lens]}|${second ? group[second.key] : ''}`;
  if (row.numbers === numbers) return;
  row.numbers = numbers;
  setText(row.now, lensText(lens, group[lens]));
  setText(row.second, second ? second.format(group[second.key]) : '');
}

// Rangen er forbruget i hele sortStep, og den skifter først, når forbruget er et helt trin fra den forrige rang.
// Ellers bytter rækker ved en afrundingsgrænse plads ved hvert tick, og hver flytning bygger rækken om.
function stickyRank(key, steps) {
  const previous = view.ranks.get(key);
  if (previous !== undefined && Math.abs(steps - previous) < 1) return previous;
  const rank = Math.round(steps);
  view.ranks.set(key, rank);
  return rank;
}

function sortGroups(groups, section) {
  const lens = state.lens;
  const { rankBy, sortStep } = LENSES[lens];
  const ranks = new Map(groups.map((group) => [group, stickyRank(group.key, (section === 'suspect' ? group.scores[lens] : group[rankBy]) / sortStep)]));
  const rank = (group) => ranks.get(group);
  return groups.sort((a, b) => rank(b) - rank(a)
    || (section === 'suspect' ? Number(Boolean(b.bloatText)) - Number(Boolean(a.bloatText)) : 0)
    || byName(a.name, b.name));
}

// Den længste delfølge af items, hvis position stiger (patience sorting).
function longestIncreasing(items, position) {
  const tails = [];
  const previous = [];
  items.forEach((item, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (position(items[tails[middle]]) < position(item)) low = middle + 1;
      else high = middle;
    }
    previous[index] = low ? tails[low - 1] : -1;
    tails[low] = index;
  });
  const result = new Set();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) result.add(items[index]);
  return result;
}

// Sætter rækkerne i rækkefølge med så få flytninger som muligt, fordi hver flytning bygger rækken om (stil og layout).
// De rækker, der allerede står indbyrdes rigtigt, bliver stående; de andre sættes ind foran deres efterfølger.
function placeRows(list, nodes) {
  if (nodes.length === list.children.length && nodes.every((node, index) => list.children[index] === node)) return;
  const before = new Map([...list.children].map((node, index) => [node, index]));
  const keep = longestIncreasing(nodes.filter((node) => before.has(node)), (node) => before.get(node));
  let next = null;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (!keep.has(nodes[index])) list.insertBefore(nodes[index], next);
    next = nodes[index];
  }
}

// Sammenfoldede sektioner har ingen rækker i DOM, og en skjult liste (detaljen har taget pladsen) tegnes ikke.
function renderList(bySection) {
  const lens = state.lens;
  const listHidden = Boolean(view.selected) && !view.wide.matches;
  const shown = new Set();
  for (const [section, groups] of Object.entries(bySection)) {
    const parts = view.sections[section];
    setText(parts.count, String(groups.length));
    setText(parts.secondHead, LENSES[lens].second?.label ?? '');
    if (!parts.node.open || listHidden) {
      if (listHidden) for (const group of groups) shown.add(group.key);
      continue;
    }
    const nodes = sortGroups(groups, section).map((group) => {
      shown.add(group.key);
      const row = view.rows.get(group.key) ?? createRow(group.key);
      patchRow(row, group, lens);
      const current = group.key === view.selected;
      if (row.current !== current) {
        row.current = current;
        row.button.setAttribute('aria-current', String(current));
      }
      return row.node;
    });
    placeRows(parts.rows, nodes);
  }
  for (const [key, row] of view.rows) {
    if (shown.has(key) && row.node.isConnected) continue;
    row.node.remove();
    view.rows.delete(key);
    view.ranks.delete(key);
  }
}

// ---------- Detaljen ----------

function select(key, { focusDetail = !view.wide.matches } = {}) {
  if (view.selected === key) return;
  cancelConfirm();
  view.selected = key;
  view.detailSignature = null;
  selectBubble(key);
  renderSelection();
  if (focusDetail) view.detail?.title.focus();
}

function closeDetail() {
  const key = view.selected;
  if (!key) return;
  const hadFocus = view.detailPanel.contains(document.activeElement);
  cancelConfirm();
  view.selected = null;
  view.detailSignature = null;
  selectBubble(null);
  renderSelection();
  if (hadFocus || !view.wide.matches) view.rows.get(key)?.button.focus();
}

function renderSelection() {
  renderList(groupsBySection());
  renderDetail();
}

function chainFor(group) {
  const items = group.sources.map((source) => {
    const [iconName, kind] = SOURCE_KIND[source.kind];
    return el('li', { className: 'is-source' }, el('span', { className: 'chain-kind' }, icon(iconName), kind), source.label);
  });
  for (const ancestor of group.ancestors) {
    const exists = ancestor.key && state.groups.has(ancestor.key);
    items.push(el('li', {}, exists
      ? el('button', { type: 'button', title: `Vis ${ancestor.name}`, onclick: () => select(ancestor.key, { focusDetail: true }) }, ancestor.name)
      : ancestor.name));
  }
  items.push(el('li', { className: 'is-self', 'data-cat': sectionOf(group) }, group.name));
  return el('ol', { className: 'chain', 'aria-label': 'Hvad programmet hænger sammen med' }, items);
}

function actionRow(iconName, title, note, ...controls) {
  return el('div', { className: 'action' },
    el('p', { className: 'action-text' }, icon(iconName), el('span', {}, el('b', {}, title), note && el('small', {}, note))),
    controls);
}

function killAction(group) {
  if (group.killLocked) return el('p', { className: 'lock-note action' }, icon('lock'), LOCK_TEXT[group.lock] ?? 'Afslut er låst');
  const kill = async (button) => {
    if (await run('/api/action', { type: 'kill', key: group.key }, button)) popBubble(group.key);
  };
  return actionRow('x-octagon', 'Afslut nu', 'kan ikke fortrydes',
    confirmButton('Afslut', `Bekræft: ${processes(group.count)}`, kill, 'button button-small button-danger', 'x-octagon'));
}

function sourceAction(source) {
  const [iconName, kind] = SOURCE_KIND[source.kind];
  if (source.kind !== 'service') {
    const flip = (button) => run('/api/action', { type: source.kind, id: source.id, enable: !source.enabled }, button);
    return actionRow(iconName, source.label, `${kind}, ${source.enabled ? 'slået til' : 'slået fra'}`, toggle(`${kind}: ${source.label}`, source.enabled, flip));
  }
  const service = state.inventory?.services.find((candidate) => candidate.name === source.id);
  if (!service) return actionRow(iconName, source.label, kind);
  const status = `${startModeLabel(service)}, ${service.state === 'Running' ? 'kører' : 'stoppet'}`;
  return actionRow(iconName, source.label, status, ...serviceControl(service, state.protectedServices.has(service.name.toLowerCase())));
}

function trustAction(group) {
  const trusted = group.category === 'trusted';
  const flip = (event) => run('/api/trust', { key: group.key }, event.currentTarget);
  return actionRow('shield-check', trusted ? 'Du stoler på den' : 'Stol på den', trusted ? 'foreslås ikke som synder' : 'flyttes ud af Syndere',
    el('button', { type: 'button', className: 'button button-small', onclick: flip }, icon(trusted ? 'shield-slash' : 'shield-check'), trusted ? 'Fjern tillid' : 'Stol på'));
}

function statTile([stat, label]) {
  const value = el('span', { className: 'stat-value' });
  const second = el('span', { className: 'stat-second' });
  const node = el('div', { className: 'stat', 'data-res': stat }, el('dt', {}, label), el('dd', {}, value, second));
  return { stat, node, value, second };
}

function buildDetail(group) {
  const section = sectionOf(group);
  const name = humanName(group);
  const category = chip(CATEGORY_CHIP[group.category] ?? SECTIONS[section], { tone: 'fill' });
  category.dataset.cat = section;
  const tiles = DETAIL_STATS.map(statTile);
  const tags = tagsFor(group);
  const meta = [
    group.path && el('li', {}, icon('folder'), group.path),
    group.signer ? el('li', {}, icon('shield-check'), `Signeret af ${group.signer}`) : group.signed === false ? el('li', {}, icon('exclamation-triangle'), 'Ikke signeret') : null,
  ].filter(Boolean);
  const parts = {
    title: el('h2', { className: 'detail-title', tabindex: '-1' }, name),
    sub: el('p', { className: 'detail-sub' }),
    spark: el('canvas', { className: 'spark', 'aria-hidden': 'true' }),
    tiles,
  };
  parts.nodes = [
    el('div', { className: 'detail-top' },
      el('button', { type: 'button', className: 'icon-button icon-button-small detail-back', 'aria-label': 'Tilbage til listen', title: 'Tilbage til listen', onclick: closeDetail }, icon('chevron-left')),
      category,
      el('button', { type: 'button', className: 'icon-button icon-button-small detail-close', 'aria-label': 'Luk', title: 'Luk (Esc)', onclick: closeDetail }, icon('x-lg'))),
    parts.title,
    parts.sub,
    tags.length ? el('div', { className: 'chips' }, tags) : null,
    group.bloatText ? el('p', { className: 'callout callout-junk' }, icon('trash3'), el('span', {}, group.bloatText)) : null,
    el('dl', { className: 'stats' }, tiles.map((tile) => tile.node)),
    parts.spark,
    chainFor(group),
    meta.length ? el('ul', { className: 'meta' }, meta) : null,
    el('div', { className: 'actions' }, killAction(group), group.sources.map(sourceAction), trustAction(group)),
  ];
  return parts;
}

// Det, der bygger detaljen om. Tallene patches for sig.
function detailSignature(group) {
  const ancestors = group.ancestors.map((ancestor) => [ancestor.name, Boolean(ancestor.key && state.groups.has(ancestor.key))]);
  return JSON.stringify([group.key, group.sources, group.killLocked, group.lock, group.category, group.running, group.bloatText, ancestors,
    group.name, group.desc, group.company, group.path, group.signer, group.signed, group.background, group.autostart, group.autostartVia, Boolean(state.inventory)]);
}

function patchDetail(group) {
  const parts = view.detail;
  const name = humanName(group);
  setText(parts.sub, [name === group.name ? null : group.name, group.company, processes(group.count)].filter(Boolean).join(', '));
  for (const tile of parts.tiles) {
    const [, , format, second, secondLabel, secondFormat] = DETAIL_STATS.find(([stat]) => stat === tile.stat);
    setText(tile.value, format(group[tile.stat]));
    setText(tile.second, second ? `${secondLabel} ${secondFormat(group[second])}` : '');
    tile.node.classList.toggle('is-lens', tile.stat === state.lens);
  }
  drawDetailSpark();
}

function drawDetailSpark() {
  const group = view.detail && state.groups.get(view.selected);
  if (!group) return;
  const lens = state.lens;
  drawSized(view.detail.spark, state.history.get(group.key)?.[lens] ?? [], LENSES[lens].sparkMin, view.colors[lens], SPARK_LINE);
}

function renderDetail() {
  const group = view.selected && state.groups.get(view.selected);
  if (view.selected && !group) {
    view.selected = null;
    selectBubble(null);
  }
  view.live.classList.toggle('has-detail', Boolean(group));
  setHidden(view.detailPanel, !group);
  if (!group) {
    if (view.detail) view.observer.unobserve(view.detail.spark);
    view.detail = null;
    view.detailSignature = null;
    return;
  }
  const signature = detailSignature(group);
  if (signature !== view.detailSignature) {
    cancelConfirm();
    if (view.detail) view.observer.unobserve(view.detail.spark);
    view.detail = buildDetail(group);
    setChildren(view.detailPanel, view.detail.nodes);
    view.observer.observe(view.detail.spark);
    view.detailSignature = signature;
  }
  patchDetail(group);
}

// ---------- Tegning ----------

function render(steps) {
  const bySection = groupsBySection();
  const top = topUsers();
  renderLenses(top);
  renderHero(top);
  drawCurves();
  renderList(bySection);
  renderLegend(Object.fromEntries(Object.entries(bySection).map(([section, groups]) => [section, groups.length])));
  renderDetail();
  renderBubbles(steps);
  if (view.scrub !== null) renderScrub();
}

// Tegner alt forfra fra state: intet, der er husket fra før, springes over.
function redraw() {
  view.detailSignature = null;
  view.written.clear();
  view.ranks.clear();
  view.tween.lens = null;
  for (const row of view.rows.values()) row.group = row.look = row.numbers = null;
  render(FULL_RELAX);
}

function pickLens(lens) {
  if (lens === state.lens) return;
  context.setLens(lens);
  view.ranks.clear();
  view.scrub = null;
  renderScrub();
  render(FULL_RELAX);
}

function onCanvasResize(entries) {
  for (const entry of entries) {
    const [box] = entry.contentBoxSize;
    view.sizes.set(entry.target, { width: box.inlineSize, height: box.blockSize });
  }
  drawCurves();
  if (view.scrub !== null) renderScrub();
}

function onKey(event) {
  if (event.key === 'Escape' && view.selected) closeDetail();
}

function onWideChange() {
  renderSelection();
}

function onSectionToggle() {
  if (view.active) renderList(groupsBySection());
}

function readColors() {
  return { ink: cssColor('--ink'), ...Object.fromEntries(LENS_KEYS.map((lens) => [lens, cssColor(`--res-${lens}`)])) };
}

// ---------- Modulkontrakten (se docs/design.md) ----------

export function mount(panel, appContext) {
  context = appContext;
  state = appContext.state;
  panel.innerHTML = TEMPLATE;
  const find = (selector) => panel.querySelector(selector);
  view.live = find('.live');
  view.list = find('.list');
  view.detailPanel = find('.detail');
  view.field = find('.field');
  view.hero = {
    node: find('.hero'), number: find('.headline-number'), unit: find('.headline-unit'), text: find('.headline-text'),
    top: find('.top-user'), topName: find('.top-name'), topValue: find('.top-value'),
    meterBg: find('.meter-bg'), meterRest: find('.meter-rest'), restValue: find('.meter-rest-value'), total: find('.meter-total'),
    curve: find('.curve'), canvas: find('.curve-canvas'), scrub: find('.scrub'), scrubValue: find('.scrub-value'), scrubTime: find('.scrub-time'),
  };
  view.lenses = Object.fromEntries([...panel.querySelectorAll('.lens')].map((button) => [button.dataset.lens, {
    button, value: button.querySelector('.lens-value'), top: button.querySelector('.lens-top'),
    topName: button.querySelector('.lens-top-name'), topValue: button.querySelector('.lens-top-value'), spark: button.querySelector('.lens-spark'),
  }]));
  view.sections = Object.fromEntries([...panel.querySelectorAll('.section')].map((node) => [node.dataset.section, {
    node, rows: node.querySelector('.rows'), count: node.querySelector('.count'), secondHead: node.querySelector('.col-head.is-second'),
  }]));
  view.wide = matchMedia(WIDE_QUERY);
  view.reducedMotion = matchMedia(REDUCED_MOTION_QUERY);
  view.observer = new ResizeObserver(onCanvasResize);

  for (const parts of Object.values(view.lenses)) parts.button.addEventListener('click', () => pickLens(parts.button.dataset.lens));
  for (const parts of Object.values(view.sections)) parts.node.addEventListener('toggle', onSectionToggle);
  view.list.addEventListener('click', (event) => {
    const row = event.target.closest('.row');
    if (row) select(row.dataset.key);
  });
  bindCurve(view.hero.curve);
  mountField(view.field, { sectionNames: SECTIONS, onSelect: (key) => select(key), onOpenSection: openSection });
}

export function show() {
  view.active = true;
  view.colors = readColors();
  document.addEventListener('keydown', onKey);
  view.wide.addEventListener('change', onWideChange);
  startField();
  for (const canvas of [view.hero.canvas, ...Object.values(view.lenses).map((parts) => parts.spark)]) view.observer.observe(canvas);
  if (view.detail) view.observer.observe(view.detail.spark);
  redraw();
}

export function hide() {
  view.active = false;
  document.removeEventListener('keydown', onKey);
  view.wide.removeEventListener('change', onWideChange);
  stopField();
  view.observer.disconnect();
  clearTimeout(view.tween.timer);
  cancelAnimationFrame(view.scrubFrame);
  view.scrubFrame = 0;
  view.scrub = null;
  view.hero.curve.classList.remove('is-scrubbing');
  cancelConfirm();
}

export const onSnapshot = redraw;
export const onTick = () => render();
export function onInventory() {
  view.detailSignature = null;
  renderDetail();
}
