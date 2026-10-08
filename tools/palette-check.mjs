// Tjekker farverne i public/style.css og kortets flader i public/disk.css: kontrast (WCAG) og CIEDE2000 ΔE mellem rollefarverne.
// Kør: node tools/palette-check.mjs. Afslutter med kode 1, hvis et krav ikke holder.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const MIN_DELTA_E = 15;
const MIN_GRAPHIC = 3;
const MIN_TEXT = 4.5;
const CLOSEST_SHOWN = 6;
// Alle rollefarver kan stå på samme skærm: topbjælkens mærker er der altid, og Live viser både ressourcer og kategorier.
const ROLE_COLORS = ['--res-cpu', '--res-ram', '--res-gpu', '--res-vram', '--cat-suspect', '--cat-yours', '--cat-trusted', '--cat-windows', '--junk', '--danger', '--slow', '--ok'];
// Disk-kortets flader. disk.js tegner alle etiketter på dem i --text.
const MAP_FILLS = ['--tile-0', '--tile-1', '--tile-2', '--tile-3', '--tile-4', '--tile-dim', '--junk-fill', '--junk-soft', '--locked-fill'];
// [forgrund, baggrund]: tekst i en farve på en flade. --danger står aldrig som tekst på --raised (3,8:1).
const TEXT_PAIRS = [
  ['--text', '--ground'], ['--text', '--panel'], ['--text', '--raised'],
  ['--muted', '--ground'], ['--muted', '--panel'], ['--muted', '--raised'],
  ['--ink', '--text'],
  ['--danger', '--ground'], ['--ok', '--ground'], ['--junk', '--ground'], ['--slow', '--ground'],
  ['--danger', '--panel'], ['--ok', '--panel'], ['--junk', '--panel'], ['--slow', '--panel'],
  ['--junk', '--raised'],
  ...MAP_FILLS.map((fill) => ['--text', fill]),
];

// Hex-tokens i den første :root-blok i en fil under public/.
function rootTokens(file) {
  const css = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
  const start = css.indexOf(':root {');
  return [...css.slice(start, css.indexOf('}', start)).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [name, hex.toLowerCase()]);
}
const tokens = Object.fromEntries(['style.css', 'disk.css'].flatMap(rootTokens));

const channels = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
const linear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const [red, green, blue] = channels(hex).map(linear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// sRGB → CIELAB (D65).
function lab(hex) {
  const [red, green, blue] = channels(hex).map(linear);
  const pivot = (value) => (value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116);
  const x = pivot((0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047);
  const y = pivot(0.2126729 * red + 0.7151522 * green + 0.072175 * blue);
  const z = pivot((0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const radians = (degrees) => (degrees * Math.PI) / 180;
const hueOf = (b, a) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360);
const chromaWeight = (chroma) => Math.sqrt(chroma ** 7 / (chroma ** 7 + 25 ** 7));

// CIEDE2000 (Sharma, Wu og Dalal 2005).
function deltaE([lightness1, a1, b1], [lightness2, a2, b2]) {
  const tilt = 0.5 * (1 - chromaWeight((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2));
  const [a1p, a2p] = [a1 * (1 + tilt), a2 * (1 + tilt)];
  const [chroma1, chroma2] = [Math.hypot(a1p, b1), Math.hypot(a2p, b2)];
  const [hue1, hue2] = [hueOf(b1, a1p), hueOf(b2, a2p)];
  const bothChromatic = chroma1 * chroma2 !== 0;
  let hueStep = hue2 - hue1;
  if (!bothChromatic) hueStep = 0;
  else if (hueStep > 180) hueStep -= 360;
  else if (hueStep < -180) hueStep += 360;
  const hueDelta = 2 * Math.sqrt(chroma1 * chroma2) * Math.sin(radians(hueStep / 2));
  const lightness = (lightness1 + lightness2) / 2;
  const chroma = (chroma1 + chroma2) / 2;
  let hue = hue1 + hue2;
  if (bothChromatic) hue = Math.abs(hue1 - hue2) > 180 ? (hue < 360 ? hue + 360 : hue - 360) / 2 : hue / 2;
  const turn = 1 - 0.17 * Math.cos(radians(hue - 30)) + 0.24 * Math.cos(radians(2 * hue)) + 0.32 * Math.cos(radians(3 * hue + 6)) - 0.2 * Math.cos(radians(4 * hue - 63));
  const lightnessScale = 1 + (0.015 * (lightness - 50) ** 2) / Math.sqrt(20 + (lightness - 50) ** 2);
  const chromaScale = 1 + 0.045 * chroma;
  const hueScale = 1 + 0.015 * chroma * turn;
  const rotation = -Math.sin(radians(60 * Math.exp(-(((hue - 275) / 25) ** 2)))) * 2 * chromaWeight(chroma);
  const [dl, dc, dh] = [(lightness2 - lightness1) / lightnessScale, (chroma2 - chroma1) / chromaScale, hueDelta / hueScale];
  return Math.sqrt(dl * dl + dc * dc + dh * dh + rotation * dc * dh);
}

// Selvtjek mod Sharmas testpar 1 og 17.
assert.equal(deltaE([50, 2.6772, -79.7751], [50, 0, -82.7485]).toFixed(4), '2.0425');
assert.equal(deltaE([50, 2.5, 0], [73, 25, -18]).toFixed(4), '27.1492');

const failures = [];
const fixed = (value) => value.toFixed(1).replace('.', ',');
const missing = [...ROLE_COLORS, ...TEXT_PAIRS.flat()].filter((name) => !tokens[name]);
if (missing.length) failures.push(`Mangler i :root: ${[...new Set(missing)].join(', ')}`);

console.log('| Token | Hex | Mod --panel | Blæk på farven |\n|---|---|---|---|');
for (const name of ROLE_COLORS.filter((role) => tokens[role])) {
  const onPanel = contrast(tokens[name], tokens['--panel']);
  const inkOn = contrast(tokens['--ink'], tokens[name]);
  if (onPanel < MIN_GRAPHIC) failures.push(`${name} har ${fixed(onPanel)}:1 mod --panel`);
  if (inkOn < MIN_TEXT) failures.push(`Blæk på ${name} har ${fixed(inkOn)}:1`);
  console.log(`| \`${name}\` | \`${tokens[name]}\` | ${fixed(onPanel)}:1 | ${fixed(inkOn)}:1 |`);
}

console.log('\n| Tekst | På | Kontrast |\n|---|---|---|');
for (const [front, back] of TEXT_PAIRS.filter((pair) => pair.every((name) => tokens[name]))) {
  const ratio = contrast(tokens[front], tokens[back]);
  if (ratio < MIN_TEXT) failures.push(`${front} på ${back} har ${fixed(ratio)}:1`);
  console.log(`| \`${front}\` | \`${back}\` | ${fixed(ratio)}:1 |`);
}

const roles = ROLE_COLORS.filter((role) => tokens[role]);
const pairs = roles.flatMap((first, index) => roles.slice(index + 1).map((second) => ({ first, second, distance: deltaE(lab(tokens[first]), lab(tokens[second])) })));
pairs.sort((a, b) => a.distance - b.distance);
for (const pair of pairs.filter((candidate) => candidate.distance < MIN_DELTA_E)) failures.push(`ΔE ${fixed(pair.distance)} mellem ${pair.first} og ${pair.second}`);
console.log(`\n${pairs.length} par af rollefarver. Mindste ΔE00: ${fixed(pairs[0].distance)}. De tætteste:`);
for (const pair of pairs.slice(0, CLOSEST_SHOWN)) console.log(`- \`${pair.first}\` og \`${pair.second}\`: ${fixed(pair.distance)}`);

if (failures.length) {
  console.log(`\nFEJL:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nAlle krav holder.');
