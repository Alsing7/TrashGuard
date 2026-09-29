// Disk-fanen: kort over pladsforbrug som kasser (treemap) eller solstråle.
// Skjult fane = intet arbejde: ingen ResizeObserver, ingen hentning.
import { $, el, setChildren, memory, post, run, toast, confirmButton, cancelConfirm, prepareCanvas, cssColor } from './ui.js';

const MODE_KEY = 'trashguard-disk-mode';
const DEPTH = { boxes: 3, sunburst: 4 };
const VIEW_REFRESH_MS = 1500;
const BYTES_PER_MB = 1048576;
const LIST_LIMIT = 12;
// Kasser
const HEADER_HEIGHT = 18;
const NEST_MIN_WIDTH = 60;
const NEST_MIN_HEIGHT = 44;
const NEST_PADDING = 2;
const LABEL_MIN_WIDTH = 44;
const LABEL_MIN_HEIGHT = 16;
// Solstråle
const CORE_SHARE = 0.2;
const MIN_ARC = 0.004;
const LABEL_MIN_ARC_PX = 70;
const START_ANGLE = -Math.PI / 2;
const FULL_TURN = Math.PI * 2;

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
  shapes: [],
  hovered: null,
  selected: null,
  fetchTimer: null,
  lastFetch: 0,
  observer: null,
};

const canvas = $('#disk-canvas');
const tip = $('#disk-tip');
const megabytes = (bytes) => memory(bytes / BYTES_PER_MB);
const count = (value) => Number(value).toLocaleString('da-DK');
const lower = (text) => String(text).toLowerCase();
const isInside = (target, root) => lower(target) === lower(root) || lower(target).startsWith(lower(root).endsWith('\\') ? lower(root) : `${lower(root)}\\`);

function readStoredMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'sunburst' ? 'sunburst' : 'boxes';
  } catch {
    return 'boxes';
  }
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

// ---------- Hentning ----------

async function fetchView() {
  if (!disk.path) return;
  clearTimeout(disk.fetchTimer);
  disk.lastFetch = Date.now();
  try {
    const data = await post('/api/disk/view', { path: disk.path, depth: DEPTH[disk.mode] });
    disk.view = data.view;
    disk.root = data.root;
    disk.error = null;
    if (disk.selected) disk.selected = disk.view.children?.find((child) => child.path === disk.selected.path && child.kind === disk.selected.kind) ?? null;
  } catch (error) {
    disk.view = null;
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
  cancelConfirm();
  disk.path = path;
  disk.selected = null;
  disk.hovered = null;
  fetchView();
}

function goUp() {
  if (!disk.path || !disk.root || lower(disk.path) === lower(disk.root)) return;
  navigate(parentOf(disk.path));
}

function scannedRoot(path) {
  return disk.index.find((entry) => isInside(path, entry.root)) ?? (disk.active && isInside(path, disk.active.root) ? disk.active : null);
}

function openRoot(root) {
  disk.path = root;
  disk.selected = null;
  if (scannedRoot(root)) return fetchView();
  disk.view = null;
  disk.root = null;
  disk.error = null;
  renderAll();
}

async function startScan(path, button) {
  if (await run('/api/disk/scan', { path }, button)) {
    disk.path = path;
    disk.selected = null;
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

function layoutBoxes(node, box, level, shapes) {
  for (const rect of squarify(node.children ?? [], box)) {
    const shape = { ...rect, node: rect.item, level, type: 'box' };
    shapes.push(shape);
    const nests = rect.item.children?.length && rect.w >= NEST_MIN_WIDTH && rect.h >= NEST_MIN_HEIGHT;
    shape.header = nests;
    if (nests) {
      layoutBoxes(rect.item, {
        x: rect.x + NEST_PADDING, y: rect.y + HEADER_HEIGHT,
        w: rect.w - NEST_PADDING * 2, h: rect.h - HEADER_HEIGHT - NEST_PADDING,
      }, level + 1, shapes);
    }
  }
}

// ---------- Solstråle ----------

function layoutSunburst(view, center, radius) {
  const core = radius * CORE_SHARE;
  const ring = (radius - core) / DEPTH.sunburst;
  const shapes = [{ type: 'core', node: view, r0: 0, r1: core, a0: START_ANGLE, a1: START_ANGLE + FULL_TURN, level: 0 }];
  function recurse(node, from, to, level) {
    let angle = from;
    for (const child of node.children ?? []) {
      const span = node.size ? (child.size / node.size) * (to - from) : 0;
      if (span >= MIN_ARC) {
        shapes.push({ type: 'arc', node: child, level, r0: core + level * ring, r1: core + (level + 1) * ring, a0: angle, a1: angle + span });
        if (child.children && level + 1 < DEPTH.sunburst) recurse(child, angle, angle + span, level + 1);
      }
      angle += span;
    }
  }
  recurse(view, START_ANGLE, START_ANGLE + FULL_TURN, 0);
  return shapes.map((shape) => ({ ...shape, cx: center.x, cy: center.y }));
}

// ---------- Tegning ----------

function colors() {
  return {
    tiles: ['--tile-0', '--tile-1', '--tile-2', '--tile-3', '--tile-4'].map(cssColor),
    dim: cssColor('--tile-dim'),
    junk: cssColor('--junk-fill'),
    junkSoft: cssColor('--junk-soft'),
    locked: cssColor('--locked-fill'),
    line: cssColor('--base'),
    text: cssColor('--text'),
    muted: cssColor('--muted'),
    signal: cssColor('--signal'),
  };
}

function fillFor(node, level, palette) {
  if (node.junk) return palette.junk;
  if (node.inJunk) return palette.junkSoft;
  if (node.locked) return palette.locked;
  if (node.kind === 'small' || node.kind === 'other') return palette.dim;
  return palette.tiles[level % palette.tiles.length];
}

function fitText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && context.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut -= 1;
  return cut > 1 ? `${text.slice(0, cut)}…` : '';
}

function drawBoxes(context, palette) {
  context.font = '12px "Segoe UI Variable Text", "Segoe UI", sans-serif';
  context.textBaseline = 'top';
  for (const shape of disk.shapes) {
    const { x, y, w, h, node } = shape;
    context.fillStyle = fillFor(node, shape.level, palette);
    context.fillRect(x, y, w, h);
    context.strokeStyle = palette.line;
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (w < LABEL_MIN_WIDTH || h < LABEL_MIN_HEIGHT) continue;
    context.fillStyle = node.kind === 'small' || node.kind === 'other' ? palette.muted : palette.text;
    const label = `${itemTitle(node)}  ${megabytes(node.size)}`;
    context.fillText(fitText(context, label, w - 8), x + 4, y + 3);
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

function drawSunburst(context, palette) {
  for (const shape of disk.shapes) {
    sector(context, shape);
    context.fillStyle = shape.type === 'core' ? palette.tiles[0] : fillFor(shape.node, shape.level + 1, palette);
    context.fill();
    context.strokeStyle = palette.line;
    context.lineWidth = 1;
    context.stroke();
  }
  context.textBaseline = 'middle';
  context.font = '12px "Segoe UI Variable Text", "Segoe UI", sans-serif';
  for (const shape of disk.shapes) {
    if (shape.type !== 'arc' || shape.level !== 0) continue;
    const middle = (shape.r0 + shape.r1) / 2;
    if ((shape.a1 - shape.a0) * middle < LABEL_MIN_ARC_PX) continue;
    const angle = (shape.a0 + shape.a1) / 2;
    const flipped = Math.cos(angle) < 0;
    context.save();
    context.translate(shape.cx + Math.cos(angle) * middle, shape.cy + Math.sin(angle) * middle);
    context.rotate(flipped ? angle + Math.PI : angle);
    context.textAlign = 'center';
    context.fillStyle = palette.text;
    context.fillText(fitText(context, itemTitle(shape.node), shape.r1 - shape.r0 - 8), 0, 0);
    context.restore();
  }
  const core = disk.shapes[0];
  context.textAlign = 'center';
  context.fillStyle = palette.text;
  context.font = '600 15px Bahnschrift, "Segoe UI", sans-serif';
  context.fillText(fitText(context, disk.view.name.split('\\').filter(Boolean).pop() ?? disk.view.name, core.r1 * 1.7), core.cx, core.cy - 9);
  context.font = '12px "Segoe UI Variable Text", "Segoe UI", sans-serif';
  context.fillStyle = palette.muted;
  context.fillText(megabytes(disk.view.size), core.cx, core.cy + 10);
}

function outline(context, shape, color, width) {
  context.strokeStyle = color;
  context.lineWidth = width;
  if (shape.type === 'box') context.strokeRect(shape.x + 1, shape.y + 1, shape.w - 2, shape.h - 2);
  else {
    sector(context, shape);
    context.stroke();
  }
}

function draw() {
  const prepared = prepareCanvas(canvas);
  if (!prepared || !disk.view) {
    disk.shapes = [];
    return;
  }
  const { context, width, height } = prepared;
  const palette = colors();
  if (disk.mode === 'boxes') {
    disk.shapes = [];
    layoutBoxes(disk.view, { x: 0, y: 0, w: width, h: height }, 0, disk.shapes);
    drawBoxes(context, palette);
  } else {
    disk.shapes = layoutSunburst(disk.view, { x: width / 2, y: height / 2 }, Math.min(width, height) / 2 - 4);
    drawSunburst(context, palette);
  }
  const selectedShape = disk.selected && disk.shapes.find((shape) => shape.node === disk.selected);
  if (selectedShape) outline(context, selectedShape, palette.signal, 2);
  if (disk.hovered && disk.hovered !== selectedShape) outline(context, disk.hovered, palette.text, 1.5);
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

function pointer(event) {
  const bounds = canvas.getBoundingClientRect();
  return [event.clientX - bounds.left, event.clientY - bounds.top];
}

function onMove(event) {
  const [x, y] = pointer(event);
  const shape = shapeAt(x, y);
  if (shape !== disk.hovered) {
    disk.hovered = shape;
    draw();
  }
  if (!shape) {
    tip.hidden = true;
    return;
  }
  const node = shape.node;
  const where = node.kind === 'small' || node.kind === 'other' ? `i ${node.path}` : node.path;
  setChildren(tip,
    el('strong', {}, itemTitle(node)),
    el('span', {}, `${megabytes(node.size)}${node.kind === 'dir' ? `, ${count(node.files)} filer` : ''}`),
    el('span', { className: 'disk-tip-path' }, where),
    node.junk ? el('span', { className: 'disk-tip-junk' }, node.junk) : null,
    shape.type === 'core' ? el('span', { className: 'disk-tip-path' }, 'Klik for at gå et niveau op') : null,
  );
  tip.hidden = false;
  const wrap = canvas.parentElement.getBoundingClientRect();
  const left = Math.min(x + 14, wrap.width - tip.offsetWidth - 4);
  const top = y + 16 + tip.offsetHeight > wrap.height ? y - tip.offsetHeight - 10 : y + 16;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

function onLeave() {
  tip.hidden = true;
  if (disk.hovered) {
    disk.hovered = null;
    draw();
  }
}

function onClick(event) {
  const shape = shapeAt(...pointer(event));
  if (!shape) return;
  if (shape.type === 'core') return goUp();
  if (shape.node.kind === 'dir') return navigate(shape.node.path);
  disk.selected = shape.node;
  draw();
  renderDetail();
}

// ---------- Paneler ----------

function renderDrives() {
  const roots = [
    ...disk.drives.map((drive) => ({ root: drive.root, label: drive.label, size: drive.size, free: drive.free })),
    ...disk.index.filter((entry) => !disk.drives.some((drive) => lower(drive.root) === lower(entry.root))).map((entry) => ({ root: entry.root })),
  ];
  $('#disk-drives').replaceChildren(...roots.map((item) => {
    const saved = disk.index.find((entry) => lower(entry.root) === lower(item.root));
    const used = item.size ? item.size - item.free : null;
    const meter = el('span', { className: 'drive-meter' }, el('span'));
    if (item.size) meter.firstChild.style.width = `${(used / item.size) * 100}%`;
    const isDrive = /^[a-z]:\\$/i.test(item.root);
    return el('button', {
      type: 'button', className: 'drive', title: item.root,
      'aria-pressed': String(Boolean(disk.root && lower(disk.root) === lower(item.root))),
      onclick: () => openRoot(item.root),
    },
    el('span', { className: 'drive-name' }, isDrive ? `${item.root.slice(0, 2)} ${item.label ?? ''}`.trim() : item.root.split('\\').pop()),
    item.size ? meter : null,
    el('span', { className: 'drive-sub' }, [
      item.size ? `${megabytes(used)} af ${megabytes(item.size)}` : null,
      saved ? `scannet ${ago(saved.scannedAt)}` : 'ikke scannet',
    ].filter(Boolean).join(', ')));
  }));
}

function renderStatus() {
  const status = $('#disk-status');
  const active = disk.active;
  if (active) {
    status.replaceChildren(
      el('span', { className: 'disk-scanning' }, `Scanner ${active.path}: ${count(active.files)} filer, ${megabytes(active.bytes)}, ${duration(Date.now() - active.startedAt)}`),
      el('button', { type: 'button', className: 'button button-small', onclick: (event) => run('/api/disk/stop', {}, event.currentTarget) }, 'Stop'));
    return;
  }
  const entry = disk.root && disk.index.find((candidate) => lower(candidate.root) === lower(disk.root));
  if (!entry) {
    status.replaceChildren();
    return;
  }
  const when = new Date(entry.scannedAt).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });
  // På et drev: sammenlign med det, Windows siger er brugt, og sig ærligt hvor resten er.
  const drive = disk.drives.find((candidate) => lower(candidate.root) === lower(entry.root));
  const found = drive ? `${megabytes(entry.size)} fundet af ${megabytes(drive.size - drive.free)} brugt` : megabytes(entry.size);
  const missing = [
    entry.denied ? `${count(entry.denied)} ${entry.denied === 1 ? 'mappe' : 'mapper'} uden adgang` : null,
    entry.unreadable ? `${count(entry.unreadable)} ${entry.unreadable === 1 ? 'fil' : 'filer'} uden størrelse` : null,
  ].filter(Boolean);
  setChildren(status,
    el('span', {}, `${entry.root} scannet ${when} (${ago(entry.scannedAt)}): ${count(entry.files)} filer, ${found}, tog ${duration(entry.durationMs)}`),
    drive || missing.length ? el('details', { className: 'disk-missing' },
      el('summary', {}, missing.length ? `Hvorfor mangler der noget? (${missing.join(', ')})` : 'Hvorfor er tallene forskellige?'),
      el('p', {}, 'Resten er NTFS\' egne data (filtabellen og journalen), afrunding til hele klynger, og mapper som selv administrator ikke må åbne.'),
      entry.deniedPaths?.length ? el('ul', {}, entry.deniedPaths.map((path) => el('li', {}, path))) : null) : null,
    el('button', { type: 'button', className: 'button button-small', onclick: (event) => startScan(entry.root, event.currentTarget) }, 'Scan hele drevet igen'));
}

function renderCrumbs() {
  const crumbs = $('#disk-crumbs');
  if (!disk.view || !disk.root) {
    crumbs.replaceChildren();
    return;
  }
  const parts = disk.path.slice(disk.root.length).split('\\').filter(Boolean);
  const links = [{ label: disk.root, path: disk.root }];
  parts.reduce((current, part) => {
    const next = current.endsWith('\\') ? current + part : `${current}\\${part}`;
    links.push({ label: part, path: next });
    return next;
  }, disk.root);
  setChildren(crumbs, links.flatMap((link, index) => [
    index ? el('span', { className: 'crumb-sep', 'aria-hidden': 'true' }, '›') : null,
    index === links.length - 1
      ? el('span', { className: 'crumb-current', 'aria-current': 'location' }, link.label)
      : el('button', { type: 'button', className: 'crumb', onclick: () => navigate(link.path) }, link.label),
  ]));
}

function renderEmpty() {
  const wrap = $('#disk-empty');
  const showCanvas = Boolean(disk.view);
  canvas.hidden = !showCanvas;
  wrap.hidden = showCanvas;
  if (showCanvas) return;
  if (!disk.path) {
    wrap.replaceChildren(el('p', {}, 'Vælg et drev ovenfor, eller skriv en mappe. Første scanning af C: tager et par minutter, og kortet tegnes undervejs.'));
    return;
  }
  const scanning = disk.active && isInside(disk.path, disk.active.root);
  setChildren(wrap,
    el('p', {}, scanning ? 'Scanner… kortet dukker op om et øjeblik.' : disk.error ?? `${disk.path} er ikke scannet endnu.`),
    scanning ? null : el('button', { type: 'button', className: 'button button-signal', onclick: (event) => startScan(disk.path, event.currentTarget) }, `Scan ${disk.path}`));
}

function lockNote(item) {
  if (item.kind === 'small' || item.kind === 'other') return 'Samlet gruppe af små ting. Gå ind i mappen for at se dem enkeltvis.';
  return item.locked ? disk.locks[item.locked] ?? 'Låst.' : null;
}

function renderDetail() {
  const panel = $('#disk-detail');
  const item = disk.selected ?? disk.view;
  if (!item) {
    panel.replaceChildren(el('p', { className: 'empty' }, 'Hold musen over kortet for at se, hvad der fylder. Klik på en mappe for at gå ind i den.'));
    return;
  }
  const real = item.kind === 'dir' || item.kind === 'file';
  const isCurrent = item === disk.view;
  const note = lockNote(item);
  const canRecycle = real && !note && !disk.active;
  const recycle = confirmButton('Flyt til papirkurv', `Bekræft: ${megabytes(item.size)} i papirkurven`, async (button) => {
    if (await run('/api/disk/recycle', { path: item.path }, button)) {
      disk.selected = null;
      if (isCurrent) disk.path = parentOf(item.path);
      fetchView();
    }
  }, 'button button-small button-danger');

  const largest = (disk.view.children ?? []).slice(0, LIST_LIMIT);
  setChildren(panel,
    el('div', { className: 'detail-head' },
      el('div', {},
        el('h2', { className: 'detail-title' }, isCurrent ? item.path : itemTitle(item)),
        el('p', { className: 'detail-meta' }, `${megabytes(item.size)}${item.kind === 'dir' || item.kind === 'small' ? `, ${count(item.files)} filer` : ''}`))),
    !isCurrent && real ? el('p', { className: 'detail-meta' }, item.path) : null,
    item.junk || item.inJunk ? el('p', { className: 'detail-bloat' }, item.junk ?? 'Ligger i en mappe med kendt skrald.') : null,
    el('div', { className: 'actions' },
      real ? el('div', { className: 'action' },
        el('button', { type: 'button', className: 'button button-small', onclick: (event) => run('/api/disk/reveal', { path: item.path }, event.currentTarget) }, 'Åbn i Stifinder'),
        el('button', { type: 'button', className: 'button button-small', onclick: () => copyPath(item.path) }, 'Kopiér sti'),
        item.kind === 'dir' && !disk.active
          ? el('button', { type: 'button', className: 'button button-small', onclick: (event) => rescan(item.path, event.currentTarget) }, 'Scan denne mappe igen')
          : null) : null,
      canRecycle ? el('div', { className: 'action' }, el('p', { className: 'action-text' }, 'Flyt til papirkurv', el('small', {}, 'Kan gendannes fra Windows\' papirkurv.')), recycle) : null,
      note ? el('p', { className: 'lock-note' }, note) : null),
    largest.length ? el('h3', { className: 'disk-list-title' }, isCurrent ? 'Største indhold' : `Største indhold i ${disk.view.name}`) : null,
    largest.length ? el('ol', { className: 'disk-list' }, largest.map((child) => el('li', {},
      el('button', {
        type: 'button', className: 'disk-list-item',
        onclick: () => (child.kind === 'dir' ? navigate(child.path) : selectItem(child)),
      }, el('span', { className: child.junk ? 'is-junk' : '' }, itemTitle(child)), el('span', {}, megabytes(child.size)))))) : null);
}

function selectItem(item) {
  disk.selected = item;
  draw();
  renderDetail();
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
  renderDrives();
  renderStatus();
  renderCrumbs();
  renderEmpty();
  draw();
  renderDetail();
}

// ---------- Offentligt ----------

export function initDisk() {
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  $('#disk-path-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const path = $('#disk-path').value.trim();
    if (path) startScan(path, event.submitter);
  });
  for (const button of document.querySelectorAll('[data-disk-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.diskMode === disk.mode));
    button.addEventListener('click', () => {
      disk.mode = button.dataset.diskMode;
      try {
        localStorage.setItem(MODE_KEY, disk.mode);
      } catch {
        // Privat vindue eller blokeret lager: valget huskes bare ikke.
      }
      for (const other of document.querySelectorAll('[data-disk-mode]')) other.setAttribute('aria-pressed', String(other === button));
      disk.hovered = null;
      fetchView();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (!disk.visible || event.key !== 'Backspace' || event.target.closest('input, textarea')) return;
    event.preventDefault();
    goUp();
  });
}

export function showDisk() {
  disk.visible = true;
  disk.observer = new ResizeObserver(() => draw());
  disk.observer.observe(canvas.parentElement);
  if (!disk.path) {
    const first = disk.index[0];
    if (first) return openRoot(first.root);
  }
  if (disk.path && scannedRoot(disk.path)) return fetchView();
  renderAll();
}

export function hideDisk() {
  disk.visible = false;
  disk.observer?.disconnect();
  disk.observer = null;
  clearTimeout(disk.fetchTimer);
  disk.fetchTimer = null;
  tip.hidden = true;
  cancelConfirm();
}

export function onDiskState(state) {
  const wasActive = disk.active;
  disk.index = state.index;
  disk.active = state.active;
  disk.locks = state.locks;
  if (!disk.visible) return;
  renderDrives();
  renderStatus();
  const touchesView = (active) => active && disk.path && (isInside(disk.path, active.path) || isInside(active.path, disk.path));
  if (touchesView(disk.active)) scheduleFetch();
  else if (touchesView(wasActive)) fetchView();
}

export function onDiskInventory(drives) {
  disk.drives = drives ?? [];
  if (disk.visible) renderDrives();
}
