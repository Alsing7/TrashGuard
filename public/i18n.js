// Sprog: dansk er kilden, og den danske tekst er nøglen i den engelske ordbog (en.js).
// Serverens tekster kommer som { da, en } og vælges med tr(). Et sprogskift genindlæser siden,
// så alt, der er formateret ved start (tal, datoer, faste Intl-formattere), følger med.
import { EN } from './en.js';

const STORAGE_KEY = 'trashguard-lang';
export const LANGS = ['da', 'en'];

function detect() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(stored)) return stored;
  } catch {
    // Privat vindue eller blokeret lager: browserens sprog afgør det.
  }
  return String(navigator.language).toLowerCase().startsWith('da') ? 'da' : 'en';
}

export const lang = detect();
export const locale = lang === 'da' ? 'da-DK' : 'en-GB';

export function setLang(next) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Valget huskes bare ikke.
  }
  location.reload();
}

// t('Valgt: {size}', { size }) -> "Selected: 2 GB". Mangler en oversættelse, vises den danske tekst.
export function t(text, vars = null) {
  const translated = lang === 'da' ? text : (EN[text] ?? text);
  return vars ? translated.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : translated;
}

// Serverens tekst: { da, en } eller en almindelig streng (fx gamle logposter og navne).
export const tr = (value) => (value && typeof value === 'object' ? (value[lang] ?? value.da) : value);
