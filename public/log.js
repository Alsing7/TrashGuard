// Log-fanen: alle handlinger grupperet pr. dag, nyeste først, med Fortryd.
import { el, setChildren, icon, run, MS_PER_DAY } from './ui.js';
import { t, tr, locale } from './i18n.js';

const TYPE_ICON = { startup: 'power', task: 'calendar-check', service: 'gear', kill: 'x-octagon', recycle: 'trash3' };
const DANGER_TYPES = new Set(['kill', 'recycle']);

// Sættes af mount(). state er app.js' fælles tilstand (samme objekt hele tiden).
let state = null;
let list = null;

const startOfDay = (at) => new Date(at).setHours(0, 0, 0, 0);

function dayLabel(at, now) {
  const daysAgo = Math.round((startOfDay(now) - startOfDay(at)) / MS_PER_DAY);
  if (daysAgo === 0) return t('I dag');
  if (daysAgo === 1) return t('I går');
  // Bygget af dele, fordi da-DK indsætter "den", når året er med.
  const date = new Date(at);
  const weekday = date.toLocaleDateString(locale, { weekday: 'long' });
  const dayAndMonth = date.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const year = date.getFullYear() === new Date(now).getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${weekday[0].toUpperCase()}${weekday.slice(1)} ${dayAndMonth}${year}`;
}

function entryState(entry) {
  if (entry.undoable && !entry.undone) {
    return el('button', {
      type: 'button', className: 'button button-small button-primary', 'aria-label': t('Fortryd: {label}', { label: tr(entry.label) }),
      onclick: (event) => run('/api/undo', { id: entry.id }, event.currentTarget),
    }, icon('arrow-counterclockwise'), t('Fortryd'));
  }
  return el('span', { className: 'log-state' }, entry.undone ? t('Fortrudt') : entry.type === 'recycle' ? t('Gendan fra papirkurven') : t('Kan ikke fortrydes'));
}

function entryRow(entry) {
  const time = new Date(entry.at);
  return el('li', { className: entry.undone ? 'log-entry is-undone' : 'log-entry' },
    el('span', { className: DANGER_TYPES.has(entry.type) ? 'log-icon is-danger' : 'log-icon' }, icon(TYPE_ICON[entry.type] ?? 'clock')),
    el('div', { className: 'log-text' },
      el('span', { className: 'log-label' }, tr(entry.label)),
      el('time', { datetime: time.toISOString() }, time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))),
    entryState(entry));
}

// ponytail: hele loggen tegnes igen ved hver ændring; den har højst 200 poster og ændrer sig kun ved en handling.
function render() {
  if (!state.log.length) {
    setChildren(list, el('li', { className: 'log-empty' }, icon('clock'), t('Ingen handlinger endnu. Alt, du slår fra, bliver skrevet her, så du kan fortryde det.')));
    return;
  }
  const now = Date.now();
  const days = new Map();
  for (const entry of state.log) {
    const label = dayLabel(entry.at, now);
    days.set(label, [...(days.get(label) ?? []), entry]);
  }
  setChildren(list, [...days].map(([label, entries]) => el('li', { className: 'log-day' },
    el('h2', { className: 'log-day-title' }, label),
    el('ol', { className: 'log-entries' }, entries.map(entryRow)))));
}

// ---------- Modulkontrakten (se docs/design.md) ----------

export function mount(panel, context) {
  state = context.state;
  panel.innerHTML = `<ol class="log" aria-label="${t('Handlinger')}"></ol>`;
  list = panel.querySelector('.log');
}

export const show = render;
export const onSnapshot = render;
export const onLog = render;
