// Boblefeltet på Live-fanen (docs/design.md, Live og Ydelse): én boble pr. program, arealet er forbruget i linsen,
// farven er kategorien. Kun transform og opacity animeres: knuderne har fast størrelse og skaleres, og layoutet
// relaxeres fra de forrige positioner. Der kører ingen løkke mellem ticks, og et valg flytter ikke boblerne.
// Hver overgang, der starter, koster stil, så et tick flytter kun det, der skal: et linseskift pakker klyngerne
// med lidt ekstra luft, et tick skubber kun bobler, der ellers ville overlappe, og udvalget og skalaen står stille.
import { el } from './ui.js';

const FIELD = {
  // Andel af feltets areal, de aktive bobler fylder, når forbruget er over linsens loft (fieldMin).
  fill: 0.45,
  // Skalaen (summen, der fylder feltet) står stille, til summen er over den eller under den / scaleSlack.
  // Ellers skaleres alle bobler om ved hvert udsving: hver flyttet eller skaleret boble starter en overgang,
  // og hver start koster ca. 30 µs stil. En ny skala får scaleRoom luft, fordi CPU-summen svinger ±40 % pr. tick.
  scaleSlack: 2.5,
  scaleRoom: 1.4,
  // Skiven er altid 2 × baseRadius px og skaleres til sin radius (live.css bruger samme tal).
  baseRadius: 100,
  // Hvilende og lukkede bobler er en ring med fast størrelse; "+N" ligeså (live.css).
  ringRadius: 9,
  moreRadius: 17,
  minActiveRadius: 12,
  // En ny boble starter på den første ledige plads i en spiral ud fra klyngens tyngdepunkt:
  // vinkel (radianer) og afstand pr. forsøg, og højst så mange forsøg.
  spiralAngle: 2.4,
  spiralStep: 6,
  spiralTries: 400,
  // Halvdelen af klikområdet (24 px): små bobler holder så stor afstand til naboerne.
  hitRadius: 12,
  // Største radius i forhold til feltets mindste side.
  maxShare: 0.3,
  perSection: 14,
  gap: 3,
  clusterGap: 18,
  pad: 12,
  legendGap: 8,
  pull: 0.035,
  // Ekstra afstand, når klyngerne pakkes (px), så en boble kan vokse lidt uden at skubbe til naboen.
  slack: 12,
  iterations: 360,
  tickIterations: 70,
  // Relax stopper, når intet flytter sig mere end dette pr. skridt (px).
  settled: 0.02,
  // Bredere end høj gange dette: klyngerne står på række, ellers 2 × 2.
  wideRatio: 1.3,
  // Mindre flytninger end dette (px) tegnes ikke ved et tick. En radius ændres først, når den ændrer sig
  // mere end scaleMin (andel) og growMin (px).
  moveMin: 2,
  // Kortere flytninger end dette (px) springer uden overgang: hver overgang koster ca. 30-50 µs stil.
  glideMin: 6,
  scaleMin: 0.2,
  growMin: 4,
  // En boble, der står i feltet, bliver stående, til en anden har stayFactor gange så højt jævnt forbrug.
  stayFactor: 2,
  // En hvilende boble vågner først over idle × wakeFactor, så forbrug omkring grænsen ikke blinker mellem ring og skive.
  wakeFactor: 3,
  // Ved et tick viger den boble, der er vokset; de andre vejer steadyMass gange mere og bliver (næsten) stående.
  // Ellers skubber én boble, der vokser, hele klyngen, og hver flyttet boble starter en overgang.
  steadyMass: 8,
  // Afsluttet boble: så mange ticks venter den skjult på, at målingen siger, den er lukket.
  popHoldTicks: 2,
  // Ringen om den valgte boble: ydre og indre kant i px uden for skiven.
  haloOuter: 5,
  haloInner: 2,
};
// [mindste radius, størrelse]: navnet vises fra 30 px og tallet fra 40 px. Skriftstørrelserne står i live.css.
const LABEL_SIZES = [[90, 'xl'], [58, 'l'], [40, 'm'], [30, 's']];
const SECTIONS = ['suspect', 'yours', 'windows', 'trusted'];

const field = {
  container: null,
  legend: null,
  halo: null,
  haloShown: ['', ''],
  nodes: new Map(),
  width: 0,
  height: 0,
  top: 0,
  scale: 0,
  selected: null,
  observer: null,
  handlers: null,
  // Seneste kald til renderField, så en størrelsesændring kan lægge om uden live.js.
  last: null,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const translate = (x, y) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

// Skifter tekstknudens data i stedet for at erstatte den, så layoutet ikke skal bygge en ny.
function writeText(element, text) {
  if (element.firstChild) element.firstChild.data = text;
  else element.textContent = text;
}

// ---------- Opsætning ----------

export function mountField(container, handlers) {
  field.container = container;
  field.handlers = handlers;
  field.legend = el('div', { className: 'field-legend' }, SECTIONS.map((section) => el('button', {
    type: 'button', tabindex: '-1', 'data-cat': section, 'data-legend': section, title: `Vis ${handlers.sectionNames[section]} i listen`,
  }, handlers.sectionNames[section], el('b'))));
  field.legend.style.inset = `${FIELD.pad}px ${FIELD.pad}px auto`;
  field.halo = [el('span', { className: 'field-halo' }), el('span', { className: 'field-halo is-inner' })];
  container.append(field.legend);
  container.addEventListener('click', onClick);
  field.observer = new ResizeObserver(onResize);
}

function onClick(event) {
  const legend = event.target.closest('[data-legend]');
  if (legend) return field.handlers.onOpenSection(legend.dataset.legend);
  const bubble = event.target.closest('.bubble');
  if (!bubble) return;
  if (bubble.dataset.more) field.handlers.onOpenSection(bubble.dataset.more);
  else field.handlers.onSelect(bubble.dataset.key);
}

// Størrelserne kommer fra observeren, så tegningen aldrig læser layoutet.
function onResize(entries) {
  const before = { width: field.width, height: field.height, top: field.top };
  for (const entry of entries) {
    const [box] = entry.contentBoxSize;
    if (entry.target === field.legend) field.top = FIELD.pad + box.blockSize + FIELD.legendGap;
    else Object.assign(field, { width: box.inlineSize, height: box.blockSize });
  }
  if (before.width === field.width && before.height === field.height && before.top === field.top) return;
  if (before.width && before.height) {
    for (const node of field.nodes.values()) {
      node.x *= field.width / before.width;
      node.y *= field.height / before.height;
    }
  }
  if (field.last) layout(field.last.entries, { ...field.last.options, steps: FIELD.iterations });
}

export function startField() {
  field.observer.observe(field.container);
  field.observer.observe(field.legend);
}

export function stopField() {
  field.observer.disconnect();
}

export function renderLegend(counts) {
  for (const button of field.legend.children) {
    const text = String(counts[button.dataset.legend]);
    if (button.lastChild.textContent !== text) button.lastChild.textContent = text;
  }
}

// ---------- Udvalg og størrelse ----------

// Højst perSection bobler pr. kategori (den valgte er altid med); resten samles i "+N". Hvilende bobler er ringe.
// Udvalget følger det jævne forbrug (steady, fx snittet), og de bobler, der allerede står i feltet, har forrang,
// så støj på et par hundrededele ikke skifter bobler ud ved hvert tick. Størrelsen er stadig forbruget nu.
function pickItems(entries, idle) {
  const bySection = Object.fromEntries(SECTIONS.map((section) => [section, []]));
  for (const entry of entries) {
    const wasResting = field.nodes.get(entry.key)?.item?.resting;
    entry.resting = entry.stopped || entry.value <= (wasResting ? idle * FIELD.wakeFactor : idle);
    entry.shown = field.nodes.has(entry.key);
    // Snittet har to decimaler, så halen står lige; idle oveni holder en vist boble, til en anden er tydeligt over.
    const steady = entry.steady ?? entry.value;
    entry.rank = entry.shown ? steady * FIELD.stayFactor + idle : steady;
    bySection[entry.section].push(entry);
  }
  const isSelected = (entry) => Number(entry.key === field.selected);
  const byUse = (a, b) => (isSelected(b) - isSelected(a)) || (b.rank - a.rank) || (b.shown - a.shown) || (a.resting - b.resting) || (a.key < b.key ? -1 : 1);
  const items = [];
  for (const section of SECTIONS) {
    const sorted = bySection[section].sort(byUse);
    items.push(...sorted.slice(0, FIELD.perSection));
    if (sorted.length > FIELD.perSection) items.push({ key: `more:${section}`, section, more: sorted.length - FIELD.perSection, value: 0 });
  }
  return items;
}

function scaleFor(active, fieldMin, fresh) {
  const kept = field.scale;
  if (!fresh && active <= kept && active > kept / FIELD.scaleSlack) return kept;
  field.scale = Math.max(fieldMin, active * FIELD.scaleRoom);
  return field.scale;
}

function radiusFor(items, fieldMin, fresh) {
  const height = field.height - field.top;
  const active = items.reduce((sum, item) => sum + (item.resting || item.more ? 0 : item.value), 0);
  const unit = (FIELD.fill * field.width * height) / scaleFor(active, fieldMin, fresh);
  const cap = Math.min(field.width, height) * FIELD.maxShare;
  return (item) => {
    if (item.more) return FIELD.moreRadius;
    if (item.resting) return FIELD.ringRadius;
    return clamp(Math.sqrt((item.value * unit) / Math.PI), FIELD.minActiveRadius, cap);
  };
}

// Klyngernes tyngdepunkter: på række efter vægt i et bredt felt, ellers 2 × 2.
function anchorsFor(items, radius) {
  const height = field.height - field.top;
  if (field.width < height * FIELD.wideRatio) {
    return Object.fromEntries(SECTIONS.map((section, index) => [section, {
      x: field.width * (index % 2 ? 0.72 : 0.28),
      y: field.top + height * (index < 2 ? 0.3 : 0.72),
    }]));
  }
  const weights = SECTIONS.map((section) => Math.sqrt(items.filter((item) => item.section === section).reduce((sum, item) => sum + radius(item) ** 2, 0)) || 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let before = 0;
  return Object.fromEntries(SECTIONS.map((section, index) => {
    const x = FIELD.pad + (field.width - FIELD.pad * 2) * ((before + weights[index] / 2) / totalWeight);
    before += weights[index];
    return [section, { x, y: field.top + height * (index % 2 ? 0.55 : 0.45) }];
  }));
}

// reach er radius eller halvdelen af klikområdet; weight er r² gange massen. Begge sættes i layout().
const spacing = (a, b, slack) => a.reach + b.reach + slack + (a.section === b.section ? FIELD.gap : FIELD.clusterGap);

// Skubber overlappende par fra hinanden, til intet flytter sig. pull trækker mod klyngens tyngdepunkt; uden pull
// flyttes kun bobler, der overlapper. Parløkken kører titusinder af gange pr. tick, så den regner i typede arrays:
// på objekterne allokerede hver skrivning et nyt tal (0,5 MB pr. tick).
function relax(nodes, iterations, pull = 0, slack = 0) {
  const count = nodes.length;
  const column = (read) => Float64Array.from(nodes, read);
  const [x, y, r, reach, weight, ax, ay] = [(n) => n.x, (n) => n.y, (n) => n.r, (n) => n.reach, (n) => n.weight, (n) => n.ax, (n) => n.ay].map(column);
  const cluster = Int8Array.from(nodes, (node) => SECTIONS.indexOf(node.section));
  const startX = new Float64Array(count);
  const startY = new Float64Array(count);
  for (let step = 0; step < iterations; step += 1) {
    for (let i = 0; i < count; i += 1) {
      startX[i] = x[i];
      startY[i] = y[i];
      x[i] += (ax[i] - x[i]) * pull;
      y[i] += (ay[i] - y[i]) * pull;
    }
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const min = reach[i] + reach[j] + slack + (cluster[i] === cluster[j] ? FIELD.gap : FIELD.clusterGap);
        const dx = x[j] - x[i];
        if (dx >= min || dx <= -min) continue;
        const dy = y[j] - y[i];
        if (dy >= min || dy <= -min) continue;
        const squared = dx * dx + dy * dy;
        if (squared >= min * min) continue;
        const distance = Math.sqrt(squared) || 0.01;
        const push = (min - distance) / distance;
        const share = weight[j] / (weight[i] + weight[j]);
        x[i] -= dx * push * share;
        y[i] -= dy * push * share;
        x[j] += dx * push * (1 - share);
        y[j] += dy * push * (1 - share);
      }
    }
    let moved = 0;
    for (let i = 0; i < count; i += 1) {
      x[i] = clamp(x[i], r[i] + FIELD.pad, field.width - r[i] - FIELD.pad);
      y[i] = clamp(y[i], r[i] + field.top, field.height - r[i] - FIELD.pad);
      moved = Math.max(moved, Math.abs(x[i] - startX[i]), Math.abs(y[i] - startY[i]));
    }
    if (moved < FIELD.settled) break;
  }
  nodes.forEach((node, index) => {
    node.x = x[index];
    node.y = y[index];
  });
}

// ---------- Knuder ----------

// Den første plads i spiralen, hvor en boble med radius r ikke rører de andre (ellers tyngdepunktet).
function freeSpot(anchor, item, r) {
  const others = [...field.nodes.values()].filter((node) => node.reach);
  const candidate = { r, reach: Math.max(r, FIELD.hitRadius), section: item.section };
  for (let index = 0; index < FIELD.spiralTries; index += 1) {
    const angle = index * FIELD.spiralAngle;
    const distance = Math.sqrt(index) * FIELD.spiralStep;
    candidate.x = anchor.x + Math.cos(angle) * distance;
    candidate.y = anchor.y + Math.sin(angle) * distance;
    const inside = candidate.x > r + FIELD.pad && candidate.x < field.width - r - FIELD.pad && candidate.y > r + field.top && candidate.y < field.height - r - FIELD.pad;
    if (inside && others.every((node) => (node.x - candidate.x) ** 2 + (node.y - candidate.y) ** 2 >= spacing(node, candidate, 0) ** 2)) return candidate;
  }
  return anchor;
}

function createNode(item, anchor, r) {
  const element = item.more
    ? el('span', { role: 'button', className: 'bubble bubble-more', 'data-more': item.section },
      el('span', { className: 'bubble-ring' }), el('span', { className: 'bubble-label' }, el('b', { className: 'bubble-name' })))
    : el('span', { role: 'button', className: 'bubble', 'data-key': item.key },
      el('span', { className: 'bubble-disc' }), el('span', { className: 'bubble-ring' }),
      el('span', { className: 'bubble-label' }, el('b', { className: 'bubble-name' }), el('span', { className: 'bubble-value' })));
  const [name, value] = element.querySelector('.bubble-label').children;
  const spot = field.nodes.size ? freeSpot(anchor, item, r) : anchor;
  // Alle felter findes fra start, så knuderne har samme form (layout() sætter item, r, weight, reach, ax og ay).
  const node = {
    key: item.key, element, name, value, label: name.parentNode, disc: element.querySelector('.bubble-disc'), badge: null,
    item: null, section: item.section, x: spot.x, y: spot.y, ax: 0, ay: 0, r: 0, weight: 0, reach: 0,
    drawn: null, shown: {}, popTicks: 0, popDone: false,
  };
  element.addEventListener('animationend', () => { node.popDone = true; });
  field.container.insertBefore(element, field.legend);
  field.nodes.set(item.key, node);
  return node;
}

// Skriver kun det, der har ændret sig siden sidst.
function put(node, key, value, write) {
  if (node.shown[key] === value) return;
  node.shown[key] = value;
  write(value);
}

function labelSize(item, radius) {
  if (item.more) return 'more';
  if (item.resting) return 'none';
  return LABEL_SIZES.find(([min]) => radius >= min)?.[1] ?? 'none';
}

// Små udsving i størrelsen rører ikke layoutet; ellers skubber hver boble, der vokser lidt, hele klyngen.
const steadyRadius = (node, radius, exact) => (!exact && node.r && Math.abs(radius - node.r) < Math.max(node.r * FIELD.scaleMin, FIELD.growMin) ? node.r : radius);

// Flytning og størrelse tegnes kun, når de har ændret sig nok (eller exact ved linseskift og ny størrelse).
function writeGeometry(node, exact) {
  const drawn = node.drawn ?? (node.drawn = { x: Infinity, y: Infinity, r: 0 });
  const distance = Math.max(Math.abs(node.x - drawn.x), Math.abs(node.y - drawn.y));
  if (exact || distance >= FIELD.moveMin) {
    put(node, 'glide', exact || distance >= FIELD.glideMin, (glide) => { node.element.style.transition = glide ? '' : 'none'; });
    drawn.x = node.x;
    drawn.y = node.y;
    node.element.style.transform = translate(drawn.x, drawn.y);
  }
  if (exact || node.r !== drawn.r) {
    drawn.r = node.r;
    if (node.disc) node.disc.style.transform = `scale(${(drawn.r / FIELD.baseRadius).toFixed(3)})`;
  }
}

function writeNode(node, item, describe, exact) {
  const { element } = node;
  writeGeometry(node, exact);
  put(node, 'gone', false, () => element.classList.remove('is-gone'));
  // Kategorien kan skifte (fx når signaturen er tjekket, eller du stoler på den).
  put(node, 'cat', item.section, (section) => { element.dataset.cat = section; });
  put(node, 'size', labelSize(item, node.drawn.r), (value) => { node.label.dataset.size = value; });
  if (item.more) {
    put(node, 'name', `+${item.more}`, (value) => writeText(node.name, value));
    put(node, 'title', `${item.more} flere i ${field.handlers.sectionNames[item.section]}`, (value) => { element.title = value; element.setAttribute('aria-label', value); });
    return;
  }
  const text = describe(item);
  put(node, 'state', item.stopped ? 'stopped' : item.resting ? 'resting' : 'active', (value) => {
    element.classList.toggle('is-resting', value === 'resting');
    element.classList.toggle('is-stopped', value === 'stopped');
  });
  put(node, 'name', text.name, (value) => writeText(node.name, value));
  put(node, 'value', text.value, (value) => writeText(node.value, value));
  put(node, 'title', text.title, (value) => { element.title = value; element.setAttribute('aria-label', value); });
  markCurrent(node);
  writeBadge(node, item.bloat);
  settlePop(node, item);
}

// Kendt bloat: et lille mærke på boblens kant, flyttet med transform.
function writeBadge(node, isBloat) {
  if (!isBloat) {
    node.badge?.remove();
    node.badge = null;
    return;
  }
  if (!node.badge) {
    node.badge = el('span', { className: 'bubble-badge', 'aria-hidden': 'true' }, el('span', { className: 'bi bi-trash3' }));
    node.element.append(node.badge);
    node.shown.badge = null;
  }
  const offset = Math.round(node.drawn.r * Math.SQRT1_2);
  put(node, 'badge', offset, (value) => { node.badge.style.transform = translate(value, -value); });
}

// En afsluttet boble bliver skjult, til målingen siger, den er lukket, eller popHoldTicks er gået.
function settlePop(node, item) {
  if (!node.popTicks) return;
  node.popTicks -= 1;
  if (node.popDone && (!item.group.running || node.popTicks === 0)) {
    node.popTicks = 0;
    node.element.classList.remove('is-popping');
  }
}

function markCurrent(node) {
  put(node, 'current', node.key === field.selected, (isCurrent) => {
    if (isCurrent) node.element.setAttribute('aria-current', 'true');
    else node.element.removeAttribute('aria-current');
  });
}

// Den valgte boble får en hvid ring: to skiver bag skiven, inde i boblen, så de følger den uden egen flytning.
function writeHalo() {
  const node = field.nodes.get(field.selected);
  if (!node?.drawn || node.shown.gone) {
    for (const halo of field.halo) halo.remove();
    return;
  }
  if (field.halo[0].parentNode !== node.element) node.element.prepend(...field.halo);
  field.halo.forEach((halo, index) => {
    const scale = ((node.drawn.r + (index ? FIELD.haloInner : FIELD.haloOuter)) / FIELD.baseRadius).toFixed(3);
    if (field.haloShown[index] === scale) return;
    field.haloShown[index] = scale;
    halo.style.transform = `scale(${scale})`;
  });
}

// ---------- Tegning ----------

// entries: [{ key, section, value, steady, group, stopped, bloat }]; steady (valgfri) vælger, hvem der får en boble. options: { fieldMin, idle, describe(item) → { name, value, title },
// steps (antal relax-skridt; FULL_RELAX tegner præcist), keepMissing (spol tilbage: bobler uden data skjules i stedet for at forsvinde) }.
export function renderField(entries, options) {
  field.last = { entries, options };
  if (!field.width || !field.height) return;
  layout(entries, options);
}

function layout(entries, { fieldMin, idle, describe, steps = FIELD.tickIterations, keepMissing = false }) {
  const items = pickItems(entries, idle);
  const exact = steps >= FIELD.iterations || !field.nodes.size;
  const radius = radiusFor(items, fieldMin, exact);
  const anchors = anchorsFor(items, radius);
  const live = new Set();
  const nodes = items.map((item) => {
    live.add(item.key);
    const anchor = anchors[item.section];
    const node = field.nodes.get(item.key) ?? createNode(item, anchor, radius(item));
    const r = steadyRadius(node, radius(item), exact);
    const mass = exact || !node.r || r > node.r ? 1 : FIELD.steadyMass;
    return Object.assign(node, { item, section: item.section, r, weight: r * r * mass, reach: Math.max(r, FIELD.hitRadius), ax: anchor.x, ay: anchor.y });
  });
  for (const [key, node] of field.nodes) {
    if (live.has(key)) continue;
    if (keepMissing && !node.item?.more) {
      put(node, 'gone', true, () => node.element.classList.add('is-gone'));
      continue;
    }
    node.element.remove();
    field.nodes.delete(key);
  }
  // Fast rækkefølge: relax skubber par i rækkefølge, så en ny rækkefølge ville flytte bobler uden grund.
  nodes.sort((a, b) => (a.key < b.key ? -1 : 1));
  if (exact) relax(nodes, FIELD.iterations, FIELD.pull, FIELD.slack);
  else relax(nodes, steps);
  for (const node of nodes) writeNode(node, node.item, describe, exact);
  writeHalo();
}

export const FULL_RELAX = FIELD.iterations;

// Valg flytter ikke noget: kun markeringen og ringen skifter.
export function selectBubble(key) {
  if (field.selected === key) return;
  const previous = field.nodes.get(field.selected);
  field.selected = key;
  for (const node of [previous, field.nodes.get(key)]) if (node) markCurrent(node);
  writeHalo();
}

// Afslut lykkedes: boblen springer (Legeplads' burst).
export function popBubble(key) {
  const node = field.nodes.get(key);
  if (!node) return;
  node.popTicks = FIELD.popHoldTicks;
  node.popDone = false;
  node.element.classList.add('is-popping');
}
