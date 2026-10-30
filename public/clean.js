// Ryd op-fanen: kendte caches med størrelse, og de valgte flyttes til papirkurven (lib/clean.mjs).
import { el, setChildren, icon, post, toast, confirmButton, cancelConfirm, memory } from './ui.js';

const BYTES_PER_MB = 1048576;

// null = ikke målt endnu. Fanen måler første gang, den vises, og ellers kun på "Mål igen".
let rows = null;
let chosen = new Set();
let working = false;
let list = null;
let head = null;
let foot = null;

const size = (bytes) => memory(Math.round(bytes / BYTES_PER_MB));
const chosenBytes = () => (rows ?? []).filter((row) => chosen.has(row.name)).reduce((sum, row) => sum + row.size, 0);

async function call(path, payload) {
  working = true;
  render();
  try {
    const data = await post(path, payload);
    rows = data.rows;
    if (data.message) toast(data.message);
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    working = false;
    chosen = new Set([...chosen].filter((name) => rows?.some((row) => row.name === name)));
    render();
  }
}

const measure = () => call('/api/clean/list', {});

async function recycle() {
  const names = [...chosen];
  chosen = new Set();
  // En afvisning kan komme efter, at noget allerede er flyttet; mål igen, så tallene passer.
  if (!(await call('/api/clean/run', { names }))) await measure();
}

function setChosen(name, on) {
  if (on) chosen.add(name);
  else chosen.delete(name);
  renderSelection();
}

function rowNode(row) {
  return el('li', {},
    el('label', { className: 'clean-row', title: row.paths.join('\n') },
      el('input', { type: 'checkbox', 'data-name': row.name, checked: chosen.has(row.name), disabled: working, onchange: (event) => setChosen(row.name, event.currentTarget.checked) }),
      el('span', { className: 'clean-name' }, row.name, el('span', { className: 'clean-text' }, row.text)),
      el('span', { className: 'clean-size' }, size(row.size))));
}

// Kun hovedets afkrydsning og foden: listen bygges ikke om ved hvert klik, så fokus bliver, hvor det er.
function renderSelection() {
  cancelConfirm();
  const all = head.querySelector('input');
  const count = rows?.length ?? 0;
  all.checked = count > 0 && chosen.size === count;
  all.indeterminate = chosen.size > 0 && chosen.size < count;
  all.disabled = working || count === 0;
  for (const box of list.querySelectorAll('input')) box.checked = chosen.has(box.dataset.name);

  const bytes = chosenBytes();
  const button = confirmButton('Papirkurv', `Bekræft: ${size(bytes)}`, recycle, 'button button-danger', 'trash3');
  button.disabled = working || chosen.size === 0;
  setChildren(foot,
    el('span', { className: 'clean-chosen' }, chosen.size ? `Valgt: ${size(bytes)}` : 'Vælg det, der skal i papirkurven.'),
    button);
}

function render() {
  const total = (rows ?? []).reduce((sum, row) => sum + row.size, 0);
  head.querySelector('.clean-total').textContent = working ? 'Måler…' : rows ? `${rows.length} placeringer · ${size(total)}` : '';
  head.querySelector('.icon-button').disabled = working;
  head.querySelector('.icon-button').classList.toggle('is-spinning', working);

  if (rows && !rows.length) {
    setChildren(list, el('li', { className: 'callout' }, icon('check-lg'), 'Ingen kendte caches fundet.'));
  } else {
    setChildren(list, (rows ?? []).map(rowNode));
  }
  renderSelection();
}

// ---------- Modulkontrakten (se docs/design.md) ----------

export function mount(panel) {
  panel.innerHTML = `
    <div class="clean">
      <div class="clean-head">
        <label class="clean-all"><input type="checkbox"> Vælg alle</label>
        <span class="clean-total"></span>
        <button type="button" class="icon-button icon-button-small" aria-label="Mål igen" title="Mål igen"><span class="bi bi-arrow-clockwise" aria-hidden="true"></span></button>
      </div>
      <ul class="clean-list" aria-label="Kendte caches"></ul>
      <div class="clean-foot"></div>
    </div>`;
  head = panel.querySelector('.clean-head');
  list = panel.querySelector('.clean-list');
  foot = panel.querySelector('.clean-foot');
  head.querySelector('input').addEventListener('change', (event) => {
    chosen = event.currentTarget.checked ? new Set(rows.map((row) => row.name)) : new Set();
    renderSelection();
  });
  head.querySelector('.icon-button').addEventListener('click', measure);
}

export function show() {
  render();
  if (rows === null && !working) measure();
}

export const hide = cancelConfirm;
