// Fælles UI-hjælpere for Live- og Disk-fanen.
export const token = document.querySelector('meta[name="tg-token"]').content;
const CONFIRM_TIMEOUT_MS = 4000;
const TOAST_MS = 4500;
const MB_PER_GB = 1024;
const MB_PER_TB = 1024 * 1024;

let confirmTimer = null;
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
export const oneDecimal = (value) => value.toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const percent = (value) => `${oneDecimal(value)} %`;
export function memoryParts(mb) {
  if (mb >= MB_PER_TB) return [oneDecimal(mb / MB_PER_TB), 'TB'];
  if (mb >= MB_PER_GB) return [oneDecimal(mb / MB_PER_GB), 'GB'];
  return [Math.round(mb).toLocaleString('da-DK'), 'MB'];
}
export const memory = (mb) => memoryParts(mb).join(' ');
export const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function toast(message, isError = false) {
  const node = $('#toast');
  node.textContent = message;
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

// Kører en handling, viser svaret som toast og returnerer om den lykkedes.
export async function run(path, body, button) {
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
  }
}

// Første klik beder om bekræftelse, andet klik udfører.
export function confirmButton(label, confirmLabel, onConfirm, className = 'button button-small') {
  const button = el('button', { type: 'button', className }, label);
  button.addEventListener('click', () => {
    if (button.dataset.armed) {
      clearTimeout(confirmTimer);
      onConfirm(button);
      return;
    }
    button.dataset.armed = '1';
    button.textContent = confirmLabel;
    button.classList.add('button-confirm');
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      delete button.dataset.armed;
      button.textContent = label;
      button.classList.remove('button-confirm');
    }, CONFIRM_TIMEOUT_MS);
  });
  return button;
}

export const cancelConfirm = () => clearTimeout(confirmTimer);

// Canvas i fuld skarphed; returnerer konteksten og størrelsen i CSS-pixels, eller null hvis den er skjult.
export function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

export function drawLine(canvas, values, minScale, color, slots) {
  const prepared = prepareCanvas(canvas);
  if (!prepared || values.length < 2) return;
  const { context, width, height } = prepared;
  const scale = Math.max(minScale, ...values);
  const step = width / (slots - 1);
  const offset = width - (values.length - 1) * step;
  context.beginPath();
  values.forEach((value, index) => {
    const x = offset + index * step;
    const y = height - 2 - (value / scale) * (height - 6);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
  context.lineTo(width, height);
  context.lineTo(offset, height);
  context.closePath();
  context.globalAlpha = 0.12;
  context.fillStyle = color;
  context.fill();
}
