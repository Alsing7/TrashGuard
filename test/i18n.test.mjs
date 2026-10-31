import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { EN } from '../public/en.js';

const PUBLIC = new URL('../public/', import.meta.url);
const read = (name) => readFileSync(new URL(name, PUBLIC), 'utf8');
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

// Alle t('…') med en fast tekst. t() med en variabel (fx opstartstyperne) står i en liste, som også skal være i EN.
function usedKeys() {
  const keys = new Map();
  for (const file of readdirSync(PUBLIC).filter((name) => name.endsWith('.js') && name !== 'en.js')) {
    const source = read(file);
    assert.doesNotMatch(source, /\bt\(\s*`/, `${file}: t() med \`…\` kan ikke tjekkes; brug '…' og {navn}`);
    for (const match of source.matchAll(/\bt\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) keys.set(match[2].replace(/\\(.)/g, '$1'), file);
  }
  const html = read('index.html').replace(/<head>[\s\S]*?<\/head>/, '');
  for (const match of html.matchAll(/>([^<]+)</g)) if (match[1].trim()) keys.set(match[1].trim(), 'index.html');
  for (const match of html.matchAll(/(?:aria-label|title)="([^"]+)"/g)) keys.set(match[1], 'index.html');
  return keys;
}

test('i18n: hver dansk tekst i browseren har en engelsk oversættelse', () => {
  const missing = [...usedKeys()].filter(([key]) => !(key in EN)).map(([key, file]) => `${file}: ${key}`);
  assert.deepEqual(missing, []);
});

test('i18n: oversættelserne har de samme {pladsholdere} som den danske tekst', () => {
  const wrong = Object.entries(EN).filter(([da, en]) => placeholders(da).join() !== placeholders(en).join()).map(([da]) => da);
  assert.deepEqual(wrong, []);
});
