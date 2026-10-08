// Fælles UI-hjælpere for alle fanerne. Signaturerne står i docs/design.md under "Filer og ejerskab".
export const token = document.querySelector('meta[name="tg-token"]').content;
const CONFIRM_TIMEOUT_MS = 4000;
const TOAST_MS = 4500;
const MB_PER_GB = 1024;
const MB_PER_TB = 1024 * 1024;
const MEMORY_LENSES = new Set(['ram', 'vram']);
const LINE_FILL_ALPHA = 0.16;
// Prikken på kurvens nyeste punkt er så meget større end stregen.
const LINE_DOT_EXTRA = 1;
const TAB_KEY_STEP = { ArrowRight: 1, ArrowLeft: -1 };
const START_MODE_TEXT = { Auto: 'Automatisk', Manual: 'Manuel', Disabled: 'Deaktiveret', Boot: 'Driver', System: 'Driver', Unknown: 'Ukendt' };
// De opstartstyper, TrashGuard kan skifte mellem: [Windows' navn, handlingens mode].
const SERVICE_MODES = [['Auto', 'auto'], ['Manual', 'manual'], ['Disabled', 'disabled']];
const DRIVER_MODES = new Set(['Boot', 'System']);
export const MS_PER_DAY = 86400000;

let armed = null;
let toastTimer = null;

export const $ = (selector) => document.querySelector(selector);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (name === 'className') node.className = value;
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

// replaceChildren skriver null som teksten "null", så tomme pladser sorteres fra her.
export const setChildren = (node, ...children) => node.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));

export const icon = (name) => el('span', { className: `bi bi-${name}`, 'aria-hidden': 'true' });
// Faste formattere: toLocaleString bygger en ny ved hvert kald (ca. 0,1 ms), og Live skriver hundredvis af tal pr. tick.
const ONE_DECIMAL = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
export const oneDecimal = (value) => ONE_DECIMAL.format(value);
export const percentParts = (value) => [oneDecimal(value), '%'];
export const percent = (value) => `${oneDecimal(value)} %`;
export function memoryParts(mb) {
  if (mb >= MB_PER_TB) return [oneDecimal(mb / MB_PER_TB), 'TB'];
  if (mb >= MB_PER_GB) return [oneDecimal(mb / MB_PER_GB), 'GB'];
  return [WHOLE.format(mb), 'MB'];
}
export const memory = (mb) => memoryParts(mb).join(' ');
// Linsens tal som [tal, enhed]: CPU og GPU i %, RAM og VRAM i MB, GB eller TB.
export const lensParts = (lens, value) => (MEMORY_LENSES.has(lens) ? memoryParts(value) : percentParts(value));
export const lensValue = (lens, value) => lensParts(lens, value).join(' ');
export const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// Tjenestens opstartstype på dansk, fx "Automatisk (forsinket)".
export const startModeLabel = (service) => `${START_MODE_TEXT[service.startMode] ?? service.startMode}${service.delayed ? ' (forsinket)' : ''}`;

export function toast(message, isError = false) {
  const node = $('#toast');
  setChildren(node, el('span', { className: 'toast-icon' }, icon(isError ? 'x-lg' : 'check-lg')), el('span', {}, message));
  node.classList.toggle('is-error', isError);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, TOAST_MS);
}

export async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TrashGuard-Token': token },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Handlingen fejlede.');
  return data;
}

// Kører en handling, viser svaret som toast og returnerer om den lykkedes. Knappen er deaktiveret imens.
// En deaktiveret knap mister fokus til <body>; havde den fokus, får den det tilbage, hvis det ikke er flyttet imens.
export async function run(path, body, button) {
  const hadFocus = Boolean(button) && document.activeElement === button;
  if (button) button.disabled = true;
  try {
    const { message } = await post(path, body);
    toast(message);
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    if (button) button.disabled = false;
    if (hadFocus && button.isConnected && document.activeElement === document.body) button.focus();
  }
}

// ---------- Bekræftelse ----------

// Kun én knap kan være bevæbnet ad gangen. En ny bevæbning eller cancelConfirm() slår den gamle tilbage.
export function cancelConfirm() {
  if (!armed) return;
  clearTimeout(armed.timer);
  armed.reset();
  armed = null;
}

// Første klik bevæbner (fare-farve og en lunte, der løber ned), andet klik inden for 4 s udfører.
export function confirmButton(label, confirmLabel, onConfirm, className = 'button button-small', iconName = null) {
  const content = (text) => [iconName && icon(iconName), text];
  const button = el('button', { type: 'button', className }, content(label));
  const reset = () => {
    setChildren(button, content(label));
    button.classList.remove('button-confirm');
  };
  button.addEventListener('click', () => {
    if (armed?.button === button) {
      cancelConfirm();
      onConfirm(button);
      return;
    }
    cancelConfirm();
    setChildren(button, content(confirmLabel));
    button.style.setProperty('--fuse-ms', `${CONFIRM_TIMEOUT_MS}ms`);
    button.classList.add('button-confirm');
    armed = { button, reset, timer: setTimeout(cancelConfirm, CONFIRM_TIMEOUT_MS) };
  });
  return button;
}

// ---------- Kontroller ----------

// Kontakt med role="switch". Den viser serverens tilstand og skifter først, når ny data er tegnet.
export function toggle(label, checked, onToggle) {
  return el('button', {
    type: 'button', role: 'switch', className: 'toggle', 'aria-checked': String(Boolean(checked)), 'aria-label': label, title: label,
    onclick: (event) => onToggle(event.currentTarget),
  });
}

// Med label er chippen et kort mærke: den fulde tekst står i title og aria-label (role="img").
export function chip(text, { iconName = null, tone = null, title = null, label = null } = {}) {
  const labelProps = label ? { role: 'img', 'aria-label': label, title: label } : { title };
  return el('span', { className: tone ? `chip chip-${tone}` : 'chip', ...labelProps }, iconName && icon(iconName), text);
}

// Segmentkontrol: én knap pr. valg { text, pressed, title, onPick, confirmLabel }.
// Et valg uden onPick er deaktiveret, og dets title siger hvorfor. Med confirmLabel kræver valget bekræftelse.
export function segment(label, choices) {
  return el('div', { className: 'segment', role: 'group', 'aria-label': label }, choices.map(segmentButton));
}

function segmentButton({ text, pressed = false, title = null, onPick = null, confirmLabel = null }) {
  const button = onPick && confirmLabel
    ? confirmButton(text, confirmLabel, onPick, '')
    : el('button', { type: 'button', disabled: !onPick, onclick: onPick && ((event) => onPick(event.currentTarget)) }, text);
  button.setAttribute('aria-pressed', String(pressed));
  if (title) button.title = title;
  return button;
}

// Faner i en role="tablist": klik og piletaster vælger, og kun den valgte fane er i tab-rækkefølgen.
export function bindTablist(list, onPick) {
  const tabs = () => [...list.querySelectorAll('[role="tab"]')];
  const pick = (tab) => {
    for (const other of tabs()) {
      other.setAttribute('aria-selected', String(other === tab));
      other.tabIndex = other === tab ? 0 : -1;
    }
    onPick(tab);
  };
  for (const tab of tabs()) tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
  list.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) pick(tab);
  });
  list.addEventListener('keydown', (event) => {
    const step = TAB_KEY_STEP[event.key];
    const all = tabs();
    const current = all.indexOf(event.target.closest('[role="tab"]'));
    if (!step || current < 0) return;
    event.preventDefault();
    const next = all[(current + step + all.length) % all.length];
    next.focus();
    pick(next);
  });
}

const lockNote = (text) => el('p', { className: 'lock-note' }, icon('lock'), text);

// Tjenestens opstartstype som segmentkontrol, med de samme regler som serveren (lib/actions.mjs):
// låste tjenester kan kun aktiveres fra Deaktiveret, Manuel bekræftes fra Automatisk, Deaktiveret bekræftes altid,
// og en Manuel tjeneste, der kører, får en Stop-knap.
export function serviceControl(service, isProtected) {
  const known = SERVICE_MODES.some(([startMode]) => startMode === service.startMode);
  if (!known) return [lockNote(DRIVER_MODES.has(service.startMode) ? 'Driver: Windows styrer den.' : 'Opstartstypen kan ikke ændres herfra.')];
  const isDisabled = service.startMode === 'Disabled';
  if (isProtected && !isDisabled) return [lockNote('Låst: Windows har brug for den.')];
  const running = service.state === 'Running';
  const act = (mode) => (button) => run('/api/action', { type: 'service', name: service.name, mode }, button);
  const choice = ([startMode, mode]) => {
    const text = START_MODE_TEXT[startMode];
    const pressed = startMode === service.startMode;
    if (mode === 'auto') {
      if (pressed && running) return { text, pressed, title: 'Automatisk, og den kører' };
      return { text, pressed, title: pressed ? 'Start den' : 'Sæt til Automatisk og start den', onPick: act(mode) };
    }
    if (pressed) return { text, pressed, title: `Den er allerede ${text}` };
    if (mode === 'manual') {
      return isDisabled
        ? { text, title: 'Aktivér som Manuel', onPick: act(mode) }
        : { text, title: 'Stop den og sæt til Manuel', onPick: act(mode), confirmLabel: 'Bekræft: Manuel' };
    }
    return { text, title: 'Stop og deaktivér. Intet kan starte den bagefter', onPick: act(mode), confirmLabel: 'Bekræft: deaktivér' };
  };
  return [
    segment(`Opstartstype for ${service.display}`, SERVICE_MODES.map(choice)),
    service.startMode === 'Manual' && running
      ? confirmButton('Stop', 'Bekræft: stop', act('manual'), 'button button-small button-danger', 'stop-fill')
      : null,
  ];
}

// ---------- Canvas ----------

// Canvas i fuld skarphed; returnerer konteksten og størrelsen i CSS-pixels, eller null hvis den er skjult.
// size ({ width, height }) kan komme fra en ResizeObserver, så tegningen ikke læser layoutet.
// Uændret størrelse: reset() rydder og nulstiller tilstanden uden at lave lærredets buffer om, som en ny width gør.
export function prepareCanvas(canvas, size = null) {
  const ratio = window.devicePixelRatio || 1;
  const width = size?.width ?? canvas.clientWidth;
  const height = size?.height ?? canvas.clientHeight;
  if (!width || !height) return null;
  const context = canvas.getContext('2d');
  // Som canvas.width selv: brøkdele skæres væk.
  const pixelWidth = Math.trunc(width * ratio);
  const pixelHeight = Math.trunc(height * ratio);
  if (canvas.width === pixelWidth && canvas.height === pixelHeight) context.reset();
  else {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.scale(ratio, ratio);
  return { context, width, height };
}

// Kurve over de seneste `slots` punkter, justeret fra højre, med let fyld og en prik på det nyeste punkt.
export function drawLine(canvas, values, minScale, color, slots, { lineWidth = 2, size = null } = {}) {
  const prepared = prepareCanvas(canvas, size);
  if (!prepared || values.length < 2) return;
  const { context, width, height } = prepared;
  const dotRadius = lineWidth + LINE_DOT_EXTRA;
  let scale = minScale;
  for (const value of values) if (value > scale) scale = value;
  const step = (width - dotRadius) / (slots - 1);
  const offset = width - dotRadius - (values.length - 1) * step;
  const plotHeight = height - dotRadius * 2;
  const yOf = (value) => height - dotRadius - (value / scale) * plotHeight;
  context.beginPath();
  for (let index = 0; index < values.length; index += 1) context.lineTo(offset + index * step, yOf(values[index]));
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = lineWidth;
  context.strokeStyle = color;
  context.stroke();
  const lastX = offset + (values.length - 1) * step;
  const lastY = yOf(values.at(-1));
  context.lineTo(lastX, height);
  context.lineTo(offset, height);
  context.closePath();
  context.globalAlpha = LINE_FILL_ALPHA;
  context.fillStyle = color;
  context.fill();
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(lastX, lastY, dotRadius, 0, Math.PI * 2);
  context.fill();
}
