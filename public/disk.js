// Disk-fanen: kort over pladsforbrug som kasser (treemap) eller solstråle.
// Skjult fane = intet arbejde: ingen ResizeObserver, ingen lyttere på dokumentet, ingen hentning.
import { $, el, setChildren, icon, chip, memory, memoryParts, post, run, toast, confirmButton, cancelConfirm, prepareCanvas, cssColor } from './ui.js';

const TEMPLATE = `
  <div class="disk-bar">
    <div class="drives" id="disk-drives"></div>
    <form class="disk-path" id="disk-path-form">
      <input class="disk-input" id="disk-path" type="text" placeholder="Eller en mappe, fx D:\\Spil" aria-label="Mappe der skal scannes" autocomplete="off" spellcheck="false">
      <button type="submit" class="button button-primary"><span class="bi bi-search" aria-hidden="true"></span>Scan</button>
    </form>
  </div>
  <div class="disk-status" id="disk-status"></div>
  <div class="disk-nav" id="disk-nav">
    <nav class="disk-crumbs" id="disk-crumbs" aria-label="Sti"></nav>
    <div class="segment disk-modes" role="group" aria-label="Visning">
      <button type="button" data-disk-mode="boxes" aria-pressed="true"><span class="bi bi-grid-1x2" aria-hidden="true"></span>Kasser</button>
      <button type="button" data-disk-mode="sunburst" aria-pressed="false"><span class="bi bi-bullseye" aria-hidden="true"></span>Solstråle</button>
    </div>
  </div>
  <div class="disk-main" id="disk-main">
    <div>
      <div class="disk-map">
        <canvas id="disk-canvas" aria-label="Kort over pladsforbrug. Listen Største indhold viser det samme som tekst."></canvas>
        <div class="disk-empty" id="disk-empty"></div>
        <div class="disk-tip" id="disk-tip" role="tooltip" hidden></div>
      </div>
      <p class="disk-legend" id="disk-legend">
        <span><span class="disk-swatch is-junk"></span>Kendt skrald</span>
        <span title="Windows, programmer og systemfiler. Kan ikke flyttes til papirkurven herfra."><span class="disk-swatch is-locked"></span>Låst</span>
        <span title="Hver mappe i udsnittet har sin egen tone. En mappe, hvis indhold vises, er en mørkere ramme om det."><span class="disk-swatch is-tones"><i></i><i></i><i></i></span>Alt andet</span>
        <span class="disk-legend-hint"><kbd>Backspace</kbd> går op</span>
      </p>
    </div>
    <aside class="disk-detail" id="disk-detail"></aside>
  </div>`;

const MODE_KEY = 'trashguard-disk-mode';
const DEPTH = { boxes: 3, sunburst: 4 };
const VIEW_REFRESH_MS = 1500;
const BYTES_PER_MB = 1048576;
const LIST_LIMIT = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Drevringen: SVG-mål, og hvornår et drev er næsten fuldt.
const RING_SIZE = 52;
const RING_RADIUS = 22;
const FULL_SHARE = 0.9;
// "needed" låser kun selve mappen (Users, AppData …); indholdet er dit, så den tegnes ikke skraveret.
const CONTENT_LOCK = 'needed';
// Farver: hver mappe øverst i udsnittet får sin tone (--tile-0..4). Blade har tonen selv; en mappe, der har
// tegnede niveauer inde i sig, er LEVEL_SHADE mørkere pr. niveau, så den står som en ramme om indholdet.
const TILE_TOKENS = ['--tile-0', '--tile-1', '--tile-2', '--tile-3', '--tile-4'];
const LEVEL_SHADE = 0.12;
// Kasser
const MAP_PADDING = 6;
const BOX_INSET = 1.5;
const OUTLINE_INSET = 2.5;
const BOX_RADIUS = [12, 8];
const HEADER_HEIGHT = 22;
const NEST_MIN_WIDTH = 64;
const NEST_MIN_HEIGHT = 48;
const NEST_PADDING = 4;
const LABEL_MIN_WIDTH = 46;
const LABEL_MIN_HEIGHT = 20;
const LABEL_PADDING = 8;
const LABEL_TOP = 6;
// Mellem navnet og størrelsen i en overskrift.
const LABEL_GAP = 6;
const HEADER_FONT_PX = { top: 13, nested: 12 };
const SIZE_FONT_PX = 12;
// Færre tegn end dette før "…" siger ikke noget, så etiketten udelades (med mindre hele navnet er der plads til).
const LABEL_MIN_CHARS = 6;
const BIG_LABEL_WIDTH = 150;
const BIG_LABEL_HEIGHT = 90;
// Navnet står nameRise × skriftstørrelsen over midten og størrelsen sizeDrop × under.
const BIG_FONT = { min: 15, max: 34, widthShare: 1 / 9, heightShare: 1 / 4, sizeShare: 0.55, minSize: 12, nameRise: 0.45, sizeDrop: 0.6 };
// Skravering for låst: streger i --text med lav alfa, så --text-etiketter stadig står over 4,5:1.
const HATCH_GAP = 8;
const HATCH_WIDTH = 1.5;
const HATCH_ALPHA = 0.13;
// Solstråle
const CORE_SHARE = 0.22;
const SUNBURST_MARGIN = 10;
const SUNBURST_GAP = 3;
// Buer, der er smallere end mellemrummet, tegnes ikke (de ville kun være streg).
const MIN_ARC_PX = 5;
// Etiketter langs buen i de inderste ringe; height er tekstens højde, padding afstanden til buens kanter.
const ARC_LABEL = { levels: 2, fontPx: 12, height: 14, padding: 4 };
// Kernen: navn og størrelse over og under midten; navnet må være widthShare × kernens radius bredt.
const CORE_FONT = { namePx: 22, sizePx: 13, nameRise: 10, sizeDrop: 14, widthShare: 1.7 };
const START_ANGLE = -Math.PI / 2;
const FULL_TURN = Math.PI * 2;
// Markering
const SELECTED_WIDTH = 3;
const HOVER_WIDTH = 2;
const TIP_OFFSET = 14;
// Tippens mindste afstand til kortets kant.
const TIP_MARGIN = 4;
const FONT = {
  display: '"Futura XBlk BT", "Futura Extra Black", Bahnschrift, "Segoe UI", sans-serif',
  data: 'Bahnschrift, "Segoe UI Variable Text", "Segoe UI", sans-serif',
};

const disk = {
  visible: false,
  drives: [],
  index: [],
  active: null,
  locks: {},
  path: null,
  root: null,
  view: null,
  error: null,
  mode: readStoredMode(),
  size: null,
  shapes: [],
  hovered: null,
  selected: null,
  // "Vis alle" i Største indhold; nulstilles, når stien skifter.
  showAll: false,
  tipSize: null,
  fetchTimer: null,
  lastFetch: 0,
  // Tælles op ved hvert kald og hvert stiskift, så et gammelt svar aldrig overskriver et nyere.
  fetchTicket: 0,
  // data-focus på det element, fokus skal lande på, hvis det fokuserede element bygges om (fx rækken, man kom fra).
  focusHint: null,
  observer: null,
  // Signaturer, så uændrede dele ikke bygges om. Nulstilles i show().
  rendered: freshRendered(),
};

// Sættes af mount(). state er app.js' fælles tilstand (samme objekt hele tiden).
let state = null;
let panel = null;
let canvas = null;
let tip = null;
let palette = null;
let hatch = null;
const megabytes = (bytes) => memory(bytes / BYTES_PER_MB);
const count = (value) => Number(value).toLocaleString('da-DK');
const lower = (text) => String(text).toLowerCase();
const isInside = (target, root) => lower(target) === lower(root) || lower(target).startsWith(lower(root).endsWith('\\') ? lower(root) : `${lower(root)}\\`);
const isDriveRoot = (path) => /^[a-z]:\\$/i.test(path);
const isGroup = (item) => item.kind === 'small' || item.kind === 'other';
const isHatched = (item) => Boolean(item.locked) && item.locked !== CONTENT_LOCK;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const plural = (amount, one, many) => `${count(amount)} ${amount === 1 ? one : many}`;

function readStoredMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'sunburst' ? 'sunburst' : 'boxes';
  } catch {
    return 'boxes';
  }
}

function freshRendered() {
  return { drives: '', status: '', crumbs: '', detail: '' };
}

function parentOf(path) {
  const cut = path.lastIndexOf('\\');
  if (cut <= 2) return path.slice(0, 3);
  return path.slice(0, cut);
}

function ago(timestamp) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'lige nu';
  if (minutes < 60) return `for ${minutes} min. siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `for ${hours} ${hours === 1 ? 'time' : 'timer'} siden`;
  const days = Math.round(hours / 24);
  return `for ${days} ${days === 1 ? 'dag' : 'dage'} siden`;
}

function duration(ms) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} sek.` : `${Math.floor(seconds / 60)} min. ${seconds % 60} sek.`;
}

function itemTitle(item) {
  if (item.kind === 'small') return `Små filer (${count(item.files)} stk.)`;
  if (item.kind === 'other') return `${count(item.files)} mindre ting`;
  return item.name;
}

const folderName = (path) => path.split('\\').filter(Boolean).pop() ?? path;
const currentTitle = (path) => (isDriveRoot(path) ? path : folderName(path));
const canGoUp = () => Boolean(disk.path && disk.root) && lower(disk.path) !== lower(disk.root);
const joinPath = (folder, name) => (folder.endsWith('\\') ? folder + name : `${folder}\\${name}`);
const rowKey = (path) => `row:${lower(path)}`;
// "Små filer" og "Andet" har mappens egen sti, så deres nøgle får typen med.
const rowFocus = (item) => rowKey(item.path) + (isGroup(item) ? `:${item.kind}` : '');

// ---------- Fokus ----------

// Ombygning af en del, der har fokus, sender fokus til <body>, så Tab starter forfra fra topbjælken.
// Hver knap, der kan bygges om, har data-focus; har fokus været i fanen, sættes det tilbage på samme knap,
// ellers på focusHint, den første række eller detaljens titel.
function keepFocus(render) {
  const active = document.activeElement;
  const key = panel.contains(active) ? active.dataset.focus ?? '' : null;
  render();
  if (key === null || document.activeElement !== document.body) return;
  const targets = [...panel.querySelectorAll('[data-focus]')].filter((node) => !node.closest('[hidden]'));
  const target = targets.find((node) => node.dataset.focus === key)
    ?? targets.find((node) => node.dataset.focus === disk.focusHint)
    ?? targets.find((node) => node.classList.contains('disk-row'))
    ?? targets.find((node) => node.matches('.disk-detail-title, .disk-empty button'));
  target?.focus();
}

// Rækken i det nye udsnit, der fører tilbage mod den sti, man kom fra (Backspace og brødkrummer).
function rowToward(from, to) {
  if (!from || lower(from) === lower(to) || !isInside(from, to)) return null;
  const [name] = from.slice(to.length).split('\\').filter(Boolean);
  return rowKey(joinPath(to, name));
}

// ---------- Hentning ----------

function setPath(path) {
  cancelConfirm();
  disk.focusHint = rowToward(disk.path, path);
  disk.fetchTicket += 1;
  disk.path = path;
  disk.selected = null;
  disk.showAll = false;
}

async function fetchView() {
  if (!disk.path) return;
  clearTimeout(disk.fetchTimer);
  disk.fetchTimer = null;
  disk.lastFetch = Date.now();
  const ticket = ++disk.fetchTicket;
  try {
    const data = await post('/api/disk/view', { path: disk.path, depth: DEPTH[disk.mode] });
    if (ticket !== disk.fetchTicket) return;
    disk.view = data.view;
    disk.root = data.root;
    disk.error = null;
    if (disk.selected) disk.selected = disk.view.children?.find((child) => child.path === disk.selected.path && child.kind === disk.selected.kind) ?? null;
  } catch (error) {
    if (ticket !== disk.fetchTicket) return;
    disk.view = null;
    disk.root = scannedRoot(disk.path)?.root ?? null;
    disk.error = error.message;
  }
  renderAll();
}

// Under scanning hentes udsnittet igen højst hvert VIEW_REFRESH_MS.
function scheduleFetch() {
  if (disk.fetchTimer) return;
  const wait = Math.max(0, VIEW_REFRESH_MS - (Date.now() - disk.lastFetch));
  disk.fetchTimer = setTimeout(() => {
    disk.fetchTimer = null;
    fetchView();
  }, wait);
}

function navigate(path) {
  setPath(path);
  fetchView();
}

function goUp() {
  if (canGoUp()) navigate(parentOf(disk.path));
}

function scannedRoot(path) {
  return disk.index.find((entry) => isInside(path, entry.root)) ?? (disk.active && isInside(path, disk.active.root) ? disk.active : null);
}

function openRoot(root) {
  setPath(root);
  if (scannedRoot(root)) return fetchView();
  disk.view = null;
  disk.root = null;
  disk.error = null;
  renderAll();
}

async function startScan(path, button) {
  if (await run('/api/disk/scan', { path }, button)) {
    setPath(path);
    scheduleFetch();
  }
}

// ---------- Kasser (squarified treemap) ----------

function worstRatio(row, side) {
  const total = row.reduce((sum, entry) => sum + entry.area, 0);
  const largest = Math.max(...row.map((entry) => entry.area));
  const smallest = Math.min(...row.map((entry) => entry.area));
  return Math.max((side * side * largest) / (total * total), (total * total) / (side * side * smallest));
}

function placeRow(row, box, out) {
  const total = row.reduce((sum, entry) => sum + entry.area, 0);
  if (box.w >= box.h) {
    const width = total / box.h;
    let top = box.y;
    for (const entry of row) {
      const height = entry.area / width;
      out.push({ item: entry.item, x: box.x, y: top, w: width, h: height });
      top += height;
    }
    return { x: box.x + width, y: box.y, w: box.w - width, h: box.h };
  }
  const height = total / box.w;
  let left = box.x;
  for (const entry of row) {
    const width = entry.area / height;
    out.push({ item: entry.item, x: left, y: box.y, w: width, h: height });
    left += width;
  }
  return { x: box.x, y: box.y + height, w: box.w, h: box.h - height };
}

function squarify(items, box) {
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (!total || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const entries = items.map((item) => ({ item, area: item.size * scale }));
  const out = [];
  let remaining = box;
  let row = [];
  for (const entry of entries) {
    const side = Math.min(remaining.w, remaining.h);
    if (row.length && worstRatio([...row, entry], side) > worstRatio(row, side)) {
      remaining = placeRow(row, remaining, out);
      row = [];
    }
    row.push(entry);
  }
  if (row.length) placeRow(row, remaining, out);
  return out;
}

// tone er indekset på mappen øverst i udsnittet; alt inde i den arver tonen.
// Returnerer, hvor mange niveauer der er tegnet inde i node (below på formen).
function layoutBoxes(node, box, level, shapes, tone = null) {
  let height = 0;
  squarify(node.children ?? [], box).forEach((rect, index) => {
    const shape = { ...rect, node: rect.item, level, tone: tone ?? index % TILE_TOKENS.length, below: 0, type: 'box' };
    shapes.push(shape);
    shape.header = Boolean(rect.item.children?.length) && rect.w >= NEST_MIN_WIDTH && rect.h >= NEST_MIN_HEIGHT;
    if (shape.header) {
      shape.below = layoutBoxes(rect.item, {
        x: rect.x + NEST_PADDING, y: rect.y + HEADER_HEIGHT,
        w: rect.w - NEST_PADDING * 2, h: rect.h - HEADER_HEIGHT - NEST_PADDING,
      }, level + 1, shapes, shape.tone);
    }
    height = Math.max(height, shape.below + 1);
  });
  return height;
}

// ---------- Solstråle ----------

function layoutSunburst(view, center, radius) {
  const core = radius * CORE_SHARE;
  const ring = (radius - core) / DEPTH.sunburst;
  const shapes = [{ type: 'core', node: view, r0: 0, r1: core, a0: START_ANGLE, a1: START_ANGLE + FULL_TURN, level: 0 }];
  // Returnerer, hvor mange ringe der er tegnet uden for node (below på formen), som layoutBoxes.
  function recurse(node, from, to, level, tone) {
    let height = 0;
    let angle = from;
    for (const [index, child] of (node.children ?? []).entries()) {
      const span = node.size ? (child.size / node.size) * (to - from) : 0;
      const r1 = core + (level + 1) * ring;
      if (span * r1 >= MIN_ARC_PX) {
        const shape = { type: 'arc', node: child, level, tone: tone ?? index % TILE_TOKENS.length, below: 0, r0: core + level * ring, r1, a0: angle, a1: angle + span };
        shapes.push(shape);
        if (child.children && level + 1 < DEPTH.sunburst) shape.below = recurse(child, angle, angle + span, level + 1, shape.tone);
        height = Math.max(height, shape.below + 1);
      }
      angle += span;
    }
    return height;
  }
  recurse(view, START_ANGLE, START_ANGLE + FULL_TURN, 0, null);
  return shapes.map((shape) => ({ ...shape, cx: center.x, cy: center.y }));
}

// Formerne regnes kun ud, når udsnittet, visningen eller størrelsen skifter. Hover og valg maler bare igen.
function layout() {
  disk.hovered = null;
  tip.hidden = true;
  if (!disk.view || !disk.size) {
    disk.shapes = [];
    return;
  }
  const { width, height } = disk.size;
  if (disk.mode === 'boxes') {
    disk.shapes = [];
    layoutBoxes(disk.view, { x: MAP_PADDING, y: MAP_PADDING, w: width - MAP_PADDING * 2, h: height - MAP_PADDING * 2 }, 0, disk.shapes);
  } else {
    const radius = Math.min(width, height) / 2 - SUNBURST_MARGIN;
    disk.shapes = radius > 0 ? layoutSunburst(disk.view, { x: width / 2, y: height / 2 }, radius) : [];
  }
}

// ---------- Tegning ----------

// En mappe med below tegnede niveauer inde i sig er en mørkere udgave af tonen. Mørkere kan kun hæve kontrasten til --text.
function shade(hex, below) {
  const factor = 1 - LEVEL_SHADE * below;
  const [red, green, blue] = [1, 3, 5].map((start) => Math.round(parseInt(hex.slice(start, start + 2), 16) * factor));
  return `rgb(${red}, ${green}, ${blue})`;
}

// Kortets farver læses én gang fra :root (de står i disk.css og ændrer sig ikke). tiles[tone][below].
function mapPalette() {
  palette ??= {
    tiles: TILE_TOKENS.map((name) => Array.from({ length: DEPTH.sunburst }, (_, below) => shade(cssColor(name), below))),
    dim: cssColor('--tile-dim'),
    junk: cssColor('--junk-fill'),
    junkSoft: cssColor('--junk-soft'),
    locked: cssColor('--locked-fill'),
    panel: cssColor('--panel'),
    text: cssColor('--text'),
  };
  return palette;
}

// Skraveringen er et lille gentaget mønster, tegnet i skærmens egen opløsning, så stregerne er skarpe.
function hatchPattern(context) {
  const ratio = window.devicePixelRatio || 1;
  if (hatch?.ratio === ratio) return hatch.pattern;
  const side = Math.round(HATCH_GAP * ratio);
  const tile = el('canvas', { width: side, height: side });
  const pen = tile.getContext('2d');
  pen.strokeStyle = mapPalette().text;
  pen.globalAlpha = HATCH_ALPHA;
  pen.lineWidth = HATCH_WIDTH * ratio;
  pen.beginPath();
  for (const offset of [-side, 0, side]) {
    pen.moveTo(offset, side);
    pen.lineTo(offset + side, 0);
  }
  pen.stroke();
  const pattern = context.createPattern(tile, 'repeat');
  pattern.setTransform(new DOMMatrix().scale(1 / ratio));
  hatch = { ratio, pattern };
  return pattern;
}

function fillFor({ node, tone, below }, colors) {
  if (node.junk) return colors.junk;
  if (node.inJunk) return colors.junkSoft;
  if (isHatched(node)) return colors.locked;
  if (isGroup(node)) return colors.dim;
  return colors.tiles[tone][below];
}

function fillShape(context, shape, colors) {
  const { node } = shape;
  context.fillStyle = fillFor(shape, colors);
  context.fill();
  if (!node.junk && !node.inJunk && isHatched(node)) {
    context.fillStyle = hatchPattern(context);
    context.fill();
  }
}

// Hele navnet, eller mindst LABEL_MIN_CHARS tegn og "…". Ellers ingen etiket.
function fitText(context, text, maxWidth) {
  if (maxWidth <= 0) return '';
  if (context.measureText(text).width <= maxWidth) return text;
  const cutAt = (length) => `${text.slice(0, length).trimEnd()}…`;
  let cut = text.length;
  while (cut > LABEL_MIN_CHARS && context.measureText(cutAt(cut)).width > maxWidth) cut -= 1;
  return context.measureText(cutAt(cut)).width <= maxWidth ? cutAt(cut) : '';
}

// roundRect kaster ved negativ radius, så små klodser får radius 0 og helt små springes over.
function boxPath(context, shape, inset) {
  const width = shape.w - inset * 2;
  const height = shape.h - inset * 2;
  if (width <= 0 || height <= 0) return false;
  const radius = clamp(BOX_RADIUS[Math.min(shape.level, BOX_RADIUS.length - 1)], 0, Math.min(width, height) / 2);
  context.beginPath();
  context.roundRect(shape.x + inset, shape.y + inset, width, height, radius);
  return true;
}

// Etiketterne regnes ud første gang og gemmes på formen, så hover ikke måler tekst igen.
function headerLabel(context, shape) {
  const nameFont = `600 ${shape.level === 0 ? HEADER_FONT_PX.top : HEADER_FONT_PX.nested}px ${FONT.data}`;
  const sizeFont = `400 ${SIZE_FONT_PX}px ${FONT.data}`;
  if (!shape.label) {
    context.font = nameFont;
    const name = fitText(context, itemTitle(shape.node), shape.w - LABEL_PADDING * 2);
    const nameWidth = context.measureText(name).width;
    context.font = sizeFont;
    const size = megabytes(shape.node.size);
    const fitsSize = name && LABEL_PADDING * 2 + nameWidth + LABEL_GAP + context.measureText(size).width <= shape.w;
    shape.label = { name, size: fitsSize ? size : '', sizeX: shape.x + LABEL_PADDING + nameWidth + LABEL_GAP };
  }
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.font = nameFont;
  context.fillText(shape.label.name, shape.x + LABEL_PADDING, shape.y + LABEL_TOP);
  context.font = sizeFont;
  context.fillText(shape.label.size, shape.label.sizeX, shape.y + LABEL_TOP);
}

// Store blade uden indhold får navn og størrelse midt i, så de store klodser siger noget uden hover.
function bigLabel(context, shape) {
  const fontSize = clamp(Math.min(shape.w * BIG_FONT.widthShare, shape.h * BIG_FONT.heightShare), BIG_FONT.min, BIG_FONT.max);
  const sizeFontSize = Math.max(BIG_FONT.minSize, Math.round(fontSize * BIG_FONT.sizeShare));
  const nameFont = `400 ${fontSize}px ${FONT.display}`;
  const sizeFont = `600 ${sizeFontSize}px ${FONT.data}`;
  if (!shape.label) {
    context.font = nameFont;
    shape.label = { name: fitText(context, itemTitle(shape.node), shape.w - LABEL_PADDING * 3), size: megabytes(shape.node.size) };
  }
  const centerX = shape.x + shape.w / 2;
  const centerY = shape.y + shape.h / 2;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = nameFont;
  context.fillText(shape.label.name, centerX, centerY - fontSize * BIG_FONT.nameRise);
  context.font = sizeFont;
  context.fillText(shape.label.size, centerX, centerY + fontSize * BIG_FONT.sizeDrop);
}

// Grupper ("N mindre ting") får aldrig den store etiket; de må ikke råbe højere end mapperne.
const wantsBigLabel = (shape) => !shape.header && !isGroup(shape.node) && shape.w >= BIG_LABEL_WIDTH && shape.h >= BIG_LABEL_HEIGHT;

function paintBoxes(context, colors) {
  for (const shape of disk.shapes) {
    if (!boxPath(context, shape, BOX_INSET)) continue;
    fillShape(context, shape, colors);
    if (shape.w < LABEL_MIN_WIDTH || shape.h < LABEL_MIN_HEIGHT) continue;
    context.fillStyle = colors.text;
    if (wantsBigLabel(shape)) bigLabel(context, shape);
    else headerLabel(context, shape);
  }
}

function sector(context, shape) {
  context.beginPath();
  if (shape.type === 'core') {
    context.arc(shape.cx, shape.cy, shape.r1, 0, FULL_TURN);
  } else {
    context.arc(shape.cx, shape.cy, shape.r1, shape.a0, shape.a1);
    context.arc(shape.cx, shape.cy, shape.r0, shape.a1, shape.a0, true);
  }
  context.closePath();
}

// Etiketten står vandret langs buen. Bredden er det, en tekstkasse midt i ringen kan have uden at røre buens kanter:
// de ydre hjørner må ikke nå ud over r1, og de indre hjørner må ikke nå ud over buens vinkel.
function arcLabelWidth(shape) {
  const middle = (shape.r0 + shape.r1) / 2;
  const inner = middle - ARC_LABEL.height / 2;
  const outer = middle + ARC_LABEL.height / 2;
  const limit = shape.r1 - ARC_LABEL.padding;
  if (inner < shape.r0 + ARC_LABEL.padding || outer >= limit) return 0;
  const radial = 2 * Math.sqrt(limit ** 2 - outer ** 2);
  const halfSpan = (shape.a1 - shape.a0) / 2;
  if (halfSpan >= Math.PI / 2) return radial;
  return Math.min(radial, 2 * inner * Math.tan(halfSpan) - ARC_LABEL.padding * 2);
}

function arcLabel(context, shape) {
  shape.label ??= isGroup(shape.node) ? '' : fitText(context, itemTitle(shape.node), arcLabelWidth(shape));
  if (!shape.label) return;
  const middle = (shape.r0 + shape.r1) / 2;
  const angle = (shape.a0 + shape.a1) / 2;
  context.save();
  context.translate(shape.cx + Math.cos(angle) * middle, shape.cy + Math.sin(angle) * middle);
  // Vinkelret på radius, og vendt på den nederste halvdel, så teksten aldrig står på hovedet.
  context.rotate(Math.sin(angle) > 0 ? angle - Math.PI / 2 : angle + Math.PI / 2);
  context.fillText(shape.label, 0, 0);
  context.restore();
}

function coreLabel(context, core, colors) {
  context.fillStyle = colors.text;
  context.font = `400 ${CORE_FONT.namePx}px ${FONT.display}`;
  core.label ??= fitText(context, currentTitle(disk.view.path), core.r1 * CORE_FONT.widthShare);
  context.fillText(core.label, core.cx, core.cy - CORE_FONT.nameRise);
  context.font = `600 ${CORE_FONT.sizePx}px ${FONT.data}`;
  context.fillText(megabytes(disk.view.size), core.cx, core.cy + CORE_FONT.sizeDrop);
}

function paintSunburst(context, colors) {
  context.strokeStyle = colors.panel;
  context.lineWidth = SUNBURST_GAP;
  for (const shape of disk.shapes) {
    if (shape.type === 'core') continue;
    sector(context, shape);
    fillShape(context, shape, colors);
    context.stroke();
  }
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = colors.text;
  context.font = `600 ${ARC_LABEL.fontPx}px ${FONT.data}`;
  for (const shape of disk.shapes) {
    if (shape.type === 'arc' && shape.level < ARC_LABEL.levels) arcLabel(context, shape);
  }
  coreLabel(context, disk.shapes[0], colors);
}

function outline(context, shape, color, width) {
  context.strokeStyle = color;
  context.lineWidth = width;
  if (shape.type === 'box') {
    if (boxPath(context, shape, OUTLINE_INSET)) context.stroke();
    return;
  }
  sector(context, shape);
  context.stroke();
}

function paint() {
  if (!disk.visible || !disk.view || !disk.size) return;
  const prepared = prepareCanvas(canvas, disk.size);
  if (!prepared) return;
  const { context } = prepared;
  if (!disk.shapes.length) return;
  const colors = mapPalette();
  if (disk.mode === 'boxes') paintBoxes(context, colors);
  else paintSunburst(context, colors);
  const selectedShape = disk.selected && disk.shapes.find((shape) => shape.node === disk.selected);
  if (selectedShape) outline(context, selectedShape, colors.text, SELECTED_WIDTH);
  if (disk.hovered && disk.hovered !== selectedShape) outline(context, disk.hovered, colors.text, HOVER_WIDTH);
}

function draw() {
  layout();
  paint();
}

// ---------- Mus ----------

function shapeAt(x, y) {
  if (disk.mode === 'boxes') {
    for (let index = disk.shapes.length - 1; index >= 0; index -= 1) {
      const shape = disk.shapes[index];
      if (x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h) return shape;
    }
    return null;
  }
  const [core] = disk.shapes;
  if (!core) return null;
  const radius = Math.hypot(x - core.cx, y - core.cy);
  let angle = Math.atan2(y - core.cy, x - core.cx);
  if (angle < START_ANGLE) angle += FULL_TURN;
  return disk.shapes.find((shape) => radius >= shape.r0 && radius < shape.r1 && (shape.type === 'core' || (angle >= shape.a0 && angle < shape.a1))) ?? null;
}

function fillTip(shape) {
  const node = shape.node;
  setChildren(tip,
    el('strong', {}, `${itemTitle(node)}, ${megabytes(node.size)}`),
    node.kind === 'dir' ? el('span', {}, `${count(node.files)} filer`) : null,
    el('span', {}, isGroup(node) ? `i ${node.path}` : node.path),
    node.junk ? el('span', {}, node.junk) : null,
    shape.type === 'core' && canGoUp() ? el('span', {}, 'Klik for at gå et niveau op') : null);
  tip.hidden = false;
  // Tippens mål læses én gang pr. ny form, ikke ved hver musebevægelse.
  disk.tipSize = { width: tip.offsetWidth, height: tip.offsetHeight };
}

function placeTip(x, y) {
  const { width, height } = disk.tipSize;
  const left = clamp(x + TIP_OFFSET, TIP_MARGIN, disk.size.width - width - TIP_MARGIN);
  const top = y + TIP_OFFSET + height > disk.size.height ? y - height - TIP_OFFSET : y + TIP_OFFSET;
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(TIP_MARGIN, top))}px)`;
}

function onMove(event) {
  const shape = shapeAt(event.offsetX, event.offsetY);
  if (shape !== disk.hovered) {
    disk.hovered = shape;
    paint();
    if (shape) fillTip(shape);
    else tip.hidden = true;
  }
  if (shape) placeTip(event.offsetX, event.offsetY);
}

function onLeave() {
  tip.hidden = true;
  if (!disk.hovered) return;
  disk.hovered = null;
  paint();
}

function onClick(event) {
  const shape = shapeAt(event.offsetX, event.offsetY);
  if (!shape) return;
  if (shape.type === 'core') return goUp();
  if (shape.node.kind === 'dir') return navigate(shape.node.path);
  selectItem(shape.node);
}

function selectItem(item) {
  cancelConfirm();
  disk.selected = item;
  paint();
  keepFocus(renderDetail);
}

// ---------- Drev ----------

function svgNode(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

// Ringen er procent brugt; en mappe har ingen kapacitet og viser mappeikonet.
function driveRing(share) {
  if (share === null) return el('span', { className: 'drive-ring' }, icon('folder'));
  const center = RING_SIZE / 2;
  const circumference = 2 * Math.PI * RING_RADIUS;
  const circle = (className) => svgNode('circle', { cx: center, cy: center, r: RING_RADIUS, class: className });
  const used = circle('ring-used');
  used.setAttribute('stroke-dasharray', `${share * circumference} ${circumference}`);
  const svg = svgNode('svg', { viewBox: `0 0 ${RING_SIZE} ${RING_SIZE}`, class: 'ring', 'aria-hidden': 'true' });
  svg.append(circle('ring-track'), used);
  return el('span', { className: share > FULL_SHARE ? 'drive-ring is-full' : 'drive-ring' }, svg, el('b', {}, `${Math.round(share * 100)}%`));
}

function driveRoots() {
  return [
    ...disk.drives.map((drive) => ({ root: drive.root, label: drive.label, size: drive.size, free: drive.free })),
    ...disk.index.filter((entry) => !disk.drives.some((drive) => lower(drive.root) === lower(entry.root))).map((entry) => ({ root: entry.root })),
  ];
}

function driveButton(item) {
  const saved = disk.index.find((entry) => lower(entry.root) === lower(item.root));
  const used = item.size ? item.size - item.free : null;
  const name = isDriveRoot(item.root) ? `${item.root.slice(0, 2)} ${item.label ?? ''}`.trim() : folderName(item.root);
  return el('button', {
    type: 'button', className: 'drive', title: item.root, 'aria-pressed': 'false',
    'data-root': item.root, 'data-focus': `drive:${lower(item.root)}`,
    onclick: () => openRoot(item.root),
  },
  driveRing(item.size ? used / item.size : null),
  el('span', { className: 'drive-text' },
    el('span', { className: 'drive-name' }, name),
    item.size ? el('span', { className: 'drive-sub' }, `${megabytes(used)} af ${megabytes(item.size)}`) : null,
    el('span', { className: 'drive-sub' }, saved ? `scannet ${ago(saved.scannedAt)}` : 'ikke scannet')));
}

// Drevene bygges kun om, når drev eller scanninger skifter. Et drevskift patcher bare aria-pressed, så fokus bliver.
function renderDrives() {
  const list = $('#disk-drives');
  const roots = driveRoots();
  const key = JSON.stringify([roots, disk.index.map((entry) => entry.scannedAt)]);
  if (key !== disk.rendered.drives) {
    disk.rendered.drives = key;
    setChildren(list, roots.map(driveButton));
  }
  for (const button of list.children) {
    const pressed = String(Boolean(disk.root) && lower(disk.root) === lower(button.dataset.root));
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  }
}

// ---------- Status ----------

function scanText(active) {
  return `Scanner ${active.path}: ${count(active.files)} filer, ${megabytes(active.bytes)}, ${duration(Date.now() - active.startedAt)}`;
}

// Under scanning kommer der tal hvert sekund; kun chippens tekst skrives om.
function renderScanning(status, active) {
  const key = `scan:${active.path}`;
  if (disk.rendered.status === key) {
    status.querySelector('.disk-scan-text').textContent = scanText(active);
    return;
  }
  disk.rendered.status = key;
  setChildren(status,
    el('span', { className: 'chip chip-ok disk-scanning' }, icon('hourglass-split'), el('span', { className: 'disk-scan-text' }, scanText(active))),
    el('button', { type: 'button', className: 'button button-small', 'data-focus': 'stop', onclick: (event) => run('/api/disk/stop', {}, event.currentTarget) }, icon('stop-fill'), 'Stop'));
}

function missingParts(entry) {
  return [
    entry.denied ? plural(entry.denied, 'mappe', 'mapper') + ' uden adgang' : null,
    entry.unreadable ? plural(entry.unreadable, 'fil', 'filer') + ' uden størrelse' : null,
  ].filter(Boolean);
}

function whyText(isDrive) {
  return isDrive
    ? 'Fundet er mindre end brugt, fordi Windows også tæller NTFS\' egne data (filtabellen og journalen), afrunding til hele klynger og mapper, som selv administrator ikke må åbne.'
    : 'Scanningen måtte ikke læse alt, så det mangler i tallet.';
}

// "Hvorfor mangler der noget?": chippen bliver på sin plads i rækken, og forklaringen folder ud på sin egen linje under den.
function whyToggle(entry, isDrive) {
  const missing = missingParts(entry);
  const body = el('div', { className: 'disk-why-body', id: 'disk-why-body', hidden: true },
    missing.length ? el('strong', {}, 'Hvorfor mangler der noget?') : null,
    el('p', {}, whyText(isDrive)),
    entry.deniedPaths?.length ? el('ul', {}, entry.deniedPaths.map((path) => el('li', {}, path))) : null);
  const button = el('button', {
    type: 'button', className: 'chip disk-why', 'aria-expanded': 'false', 'aria-controls': 'disk-why-body', 'data-focus': 'why',
    onclick: () => {
      body.hidden = !body.hidden;
      button.setAttribute('aria-expanded', String(!body.hidden));
    },
  }, icon(missing.length ? 'exclamation-triangle' : 'search'), missing.length ? missing.join(', ') : 'Hvorfor er tallene forskellige?', icon('chevron-right'));
  return [button, body];
}

function renderScanned(status, entry) {
  const drive = disk.drives.find((candidate) => lower(candidate.root) === lower(entry.root));
  const key = JSON.stringify(['idle', entry, drive?.free]);
  if (disk.rendered.status === key) return;
  disk.rendered.status = key;
  const when = new Date(entry.scannedAt).toLocaleString('da-DK', { dateStyle: 'long', timeStyle: 'short' });
  // På et drev: sammenlign med det, Windows siger er brugt, og sig ærligt hvor resten er.
  const found = drive ? `${megabytes(entry.size)} fundet af ${megabytes(drive.size - drive.free)} brugt` : `${megabytes(entry.size)} fundet`;
  const [why, whyBody] = drive || missingParts(entry).length ? whyToggle(entry, Boolean(drive)) : [];
  setChildren(status,
    chip(`scannet ${ago(entry.scannedAt)}`, { iconName: 'calendar-check', title: `Scannet ${when}` }),
    chip(`${count(entry.files)} filer`, { iconName: 'files' }),
    chip(found, { iconName: 'device-hdd' }),
    chip(`tog ${duration(entry.durationMs)}`, { iconName: 'clock' }),
    why,
    el('button', { type: 'button', className: 'button button-small disk-rescan-all', 'data-focus': 'rescan-all', onclick: (event) => startScan(entry.root, event.currentTarget) },
      icon('arrow-clockwise'), isDriveRoot(entry.root) ? 'Scan hele drevet igen' : 'Scan hele mappen igen'),
    whyBody);
}

function renderStatus() {
  const status = $('#disk-status');
  if (disk.active) return renderScanning(status, disk.active);
  const entry = disk.root && disk.index.find((candidate) => lower(candidate.root) === lower(disk.root));
  if (entry) return renderScanned(status, entry);
  disk.rendered.status = '';
  status.replaceChildren();
}

// ---------- Brødkrummer ----------

function renderCrumbs() {
  const crumbs = $('#disk-crumbs');
  const key = disk.view && disk.root ? `${disk.root}|${disk.path}` : '';
  if (key === disk.rendered.crumbs) return;
  disk.rendered.crumbs = key;
  if (!key) return crumbs.replaceChildren();
  const parts = disk.path.slice(disk.root.length).split('\\').filter(Boolean);
  const links = [{ label: disk.root, path: disk.root }];
  parts.reduce((current, part) => {
    const next = joinPath(current, part);
    links.push({ label: part, path: next });
    return next;
  }, disk.root);
  setChildren(crumbs, links.flatMap((link, index) => [
    index ? icon('chevron-right') : null,
    index === links.length - 1
      ? el('span', { className: 'crumb-current', 'aria-current': 'location' }, link.label)
      : el('button', { type: 'button', className: 'crumb', 'data-focus': `crumb:${lower(link.path)}`, onclick: () => navigate(link.path) }, link.label),
  ]));
}

// ---------- Tom tilstand og fejl ----------

function emptyState(iconName, title, text, ...actions) {
  return [el('span', { className: 'disk-empty-icon' }, icon(iconName)), el('h2', {}, title), el('p', {}, text), el('div', { className: 'disk-empty-actions' }, actions)];
}

const scanButton = (path) => el('button', { type: 'button', className: 'button button-primary', 'data-focus': 'scan', onclick: (event) => startScan(path, event.currentTarget) }, icon('search'), `Scan ${path}`);

function emptyContent() {
  if (!disk.path) {
    const first = disk.drives[0]?.root;
    return emptyState('device-hdd', 'Hvad fylder på din PC?', 'Vælg et drev ovenfor, eller skriv en mappe. Første scanning af et drev tager et par minutter, og kortet tegnes undervejs.', first ? scanButton(first) : null);
  }
  if (disk.active && isInside(disk.path, disk.active.root)) {
    return emptyState('hourglass-split', 'Scanner …', 'Kortet dukker op om et øjeblik og vokser, mens scanningen kører.');
  }
  const { root } = scannedRoot(disk.path) ?? {};
  if (!root) {
    return emptyState('search', `${disk.path} er ikke scannet`, 'Scan den, så ser du, hvad der fylder. Kortet tegnes undervejs.', scanButton(disk.path));
  }
  return emptyState('exclamation-triangle', 'Mappen er ikke med', disk.error ?? 'Udsnittet kunne ikke hentes.', scanButton(disk.path),
    el('button', { type: 'button', className: 'button', 'data-focus': 'back', onclick: () => openRoot(root) }, `Tilbage til ${root}`));
}

function renderEmpty() {
  const showMap = Boolean(disk.view);
  canvas.hidden = !showMap;
  $('#disk-empty').hidden = showMap;
  $('#disk-detail').hidden = !showMap;
  $('#disk-legend').hidden = !showMap;
  $('#disk-nav').hidden = !showMap;
  $('#disk-main').classList.toggle('is-empty', !showMap);
  if (!showMap) setChildren($('#disk-empty'), emptyContent());
}

// ---------- Detaljepanelet ----------

function lockNote(item) {
  if (isGroup(item)) return 'Samlet gruppe af små ting. Gå ind i mappen for at se dem enkeltvis.';
  if (item.locked) return disk.locks[item.locked] ?? 'Låst.';
  return disk.active ? 'Papirkurven venter, til scanningen er færdig.' : null;
}

function recycleButton(item, isCurrent) {
  const button = confirmButton('Papirkurv', `Bekræft: ${megabytes(item.size)}`, async (target) => {
    if (await run('/api/disk/recycle', { path: item.path }, target)) {
      disk.selected = null;
      if (isCurrent) setPath(parentOf(item.path));
      fetchView();
    }
  }, 'button button-small button-danger', 'trash3');
  button.title = 'Flyt til papirkurven. Kan gendannes fra Windows\' papirkurv.';
  button.dataset.focus = 'recycle';
  return button;
}

function actionButtons(item, isCurrent, note) {
  return el('div', { className: 'disk-actions' },
    el('button', { type: 'button', className: 'button button-small', 'data-focus': 'reveal', onclick: (event) => run('/api/disk/reveal', { path: item.path }, event.currentTarget) }, icon('folder2-open'), 'Åbn i Stifinder'),
    el('button', { type: 'button', className: 'button button-small', 'data-focus': 'copy', onclick: () => copyPath(item.path) }, icon('clipboard'), 'Kopiér sti'),
    item.kind === 'dir' && !disk.active
      ? el('button', { type: 'button', className: 'button button-small', 'data-focus': 'rescan', title: 'Scan denne mappe igen', onclick: (event) => rescan(item.path, event.currentTarget) }, icon('arrow-clockwise'), 'Scan igen')
      : null,
    note ? null : recycleButton(item, isCurrent));
}

function largestRow(child, biggest) {
  const tone = child.junk || child.inJunk ? ' is-junk' : '';
  const button = el('button', {
    type: 'button', className: `disk-row${tone}`, 'aria-current': child === disk.selected ? 'true' : null, 'data-focus': rowFocus(child),
    onclick: () => (child.kind === 'dir' ? navigate(child.path) : selectItem(child)),
  }, el('span', { className: 'disk-row-name' }, itemTitle(child)), el('span', { className: 'disk-row-size' }, megabytes(child.size)));
  button.style.setProperty('--share', String(child.size / biggest));
  return el('li', {}, button);
}

// Resten af udsnittets børn er allerede hentet, så "Vis alle" koster ingen ekstra kald. Fokus lander på den første nye række.
function showAllRows(children) {
  disk.showAll = true;
  disk.focusHint = rowFocus(children[LIST_LIMIT]);
  keepFocus(renderDetail);
}

function largestList() {
  const children = disk.view.children ?? [];
  const shown = disk.showAll ? children : children.slice(0, LIST_LIMIT);
  const biggest = children[0]?.size || 1;
  return [
    el('ol', { className: 'disk-list' }, shown.map((child) => largestRow(child, biggest))),
    shown.length < children.length
      ? el('button', { type: 'button', className: 'button button-small disk-more', 'data-focus': 'more', onclick: () => showAllRows(children) }, `Vis alle ${count(children.length)}`, icon('chevron-right'))
      : null,
  ];
}

// Bygges kun om, når indholdet skifter, så fokus og en bevæbnet Papirkurv overlever en uændret opdatering.
function detailKey(item) {
  const children = (disk.view.children ?? []).map((child) => [child.path, child.kind, child.size]);
  return JSON.stringify([item.path, item.kind, item.size, item.files, disk.view.path, disk.showAll, Boolean(disk.active), children]);
}

function renderDetail() {
  const detail = $('#disk-detail');
  const item = disk.selected ?? disk.view;
  if (!item) {
    disk.rendered.detail = '';
    return detail.replaceChildren();
  }
  const key = detailKey(item);
  if (key === disk.rendered.detail) return;
  disk.rendered.detail = key;
  const real = item.kind === 'dir' || item.kind === 'file';
  const isCurrent = item === disk.view;
  const note = lockNote(item);
  const [size, unit] = memoryParts(item.size / BYTES_PER_MB);
  const hasList = Boolean(disk.view.children?.length);
  setChildren(detail,
    el('h2', { className: 'disk-detail-title', title: item.path, tabindex: '-1', 'data-focus': 'title' }, isCurrent ? currentTitle(item.path) : itemTitle(item)),
    el('p', { className: 'disk-size' }, size, el('small', {}, unit)),
    el('p', { className: 'disk-sub' }, [item.kind === 'dir' || item.kind === 'small' ? `${count(item.files)} filer` : null, real && !isDriveRoot(item.path) ? item.path : null].filter(Boolean).join(' · ')),
    item.junk || item.inJunk ? el('p', { className: 'callout callout-junk' }, icon('trash3'), item.junk ?? 'Ligger i en mappe med kendt skrald.') : null,
    real ? actionButtons(item, isCurrent, note) : null,
    note ? el('p', { className: 'lock-note' }, icon('lock'), note) : null,
    hasList ? el('h3', { className: 'disk-list-title' }, isCurrent ? 'Største indhold' : `Største i ${currentTitle(disk.view.path)}`) : null,
    hasList ? largestList() : null);
}

async function copyPath(path) {
  try {
    await navigator.clipboard.writeText(path);
    toast('Stien er kopieret.');
  } catch {
    toast('Browseren tillod ikke at kopiere.', true);
  }
}

async function rescan(path, button) {
  if (await run('/api/disk/rescan', { path }, button)) fetchView();
}

function renderAll() {
  if (!disk.visible) return;
  keepFocus(() => {
    renderDrives();
    renderStatus();
    renderCrumbs();
    renderEmpty();
    draw();
    renderDetail();
  });
}

// ---------- Modulkontrakten (se docs/design.md) ----------

function onKey(event) {
  if (event.key !== 'Backspace' || event.target.closest('input, textarea')) return;
  event.preventDefault();
  goUp();
}

// ResizeObserver giver størrelsen, så tegningen aldrig læser layoutet.
function onResize([entry]) {
  const { width, height } = entry.contentRect;
  if (disk.size?.width === width && disk.size?.height === height) return;
  disk.size = width && height ? { width, height } : null;
  draw();
}

function pickMode(button) {
  disk.mode = button.dataset.diskMode;
  try {
    localStorage.setItem(MODE_KEY, disk.mode);
  } catch {
    // Privat vindue eller blokeret lager: valget huskes bare ikke.
  }
  for (const other of button.parentElement.children) other.setAttribute('aria-pressed', String(other === button));
  fetchView();
}

// Diskens gemte scanninger og drevene kommer fra den fælles tilstand.
function syncFromState() {
  disk.index = state.disk?.index ?? [];
  disk.active = state.disk?.active ?? null;
  disk.locks = state.disk?.locks ?? {};
  disk.drives = state.inventory?.drives ?? [];
}

export function mount(panelNode, context) {
  state = context.state;
  panel = panelNode;
  panel.innerHTML = TEMPLATE;
  canvas = panel.querySelector('#disk-canvas');
  tip = panel.querySelector('#disk-tip');
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  panel.querySelector('#disk-path-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const path = panel.querySelector('#disk-path').value.trim();
    if (path) startScan(path, event.submitter);
  });
  for (const button of panel.querySelectorAll('[data-disk-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.diskMode === disk.mode));
    button.addEventListener('click', () => pickMode(button));
  }
}

export function show() {
  syncFromState();
  disk.visible = true;
  disk.rendered = freshRendered();
  document.addEventListener('keydown', onKey);
  disk.observer = new ResizeObserver(onResize);
  disk.observer.observe(canvas.parentElement);
  if (!disk.path && disk.index[0]) return openRoot(disk.index[0].root);
  if (disk.path && scannedRoot(disk.path)) return fetchView();
  renderAll();
}

export function hide() {
  disk.visible = false;
  document.removeEventListener('keydown', onKey);
  disk.observer?.disconnect();
  disk.observer = null;
  disk.size = null;
  clearTimeout(disk.fetchTimer);
  disk.fetchTimer = null;
  disk.hovered = null;
  tip.hidden = true;
  cancelConfirm();
}

export function onSnapshot() {
  syncFromState();
  disk.rendered = freshRendered();
  if (disk.path && scannedRoot(disk.path)) return fetchView();
  renderAll();
}

export function onDisk() {
  const wasActive = disk.active;
  syncFromState();
  keepFocus(() => {
    renderDrives();
    renderStatus();
  });
  const touchesView = (active) => active && disk.path && (isInside(disk.path, active.path) || isInside(active.path, disk.path));
  if (touchesView(disk.active)) scheduleFetch();
  else if (touchesView(wasActive)) fetchView();
}

export function onInventory() {
  disk.drives = state.inventory?.drives ?? [];
  keepFocus(() => {
    renderDrives();
    renderStatus();
  });
}
