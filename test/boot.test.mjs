import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBoots } from '../lib/boot.mjs';

const settings = { explorerWaitSeconds: 30, slowerFactor: 2, slowerMinSeconds: 5, failedServiceWindowSeconds: 300 };
const S = 1000;
const run = (at, command, seconds) => [{ at, id: 9707, command }, { at: at + seconds * S, id: 9708, command }];
const day = (start, healthSeconds) => [{ at: start + 30 * S, id: 9705, command: '' }, ...run(start + 30 * S, 'SecurityHealthSystray.exe', healthSeconds), ...run(start + 70 * S, 'GG" -dbEnv=production', 10)];

test('opstart: tid pr. post, normal = median af de andre, grænse og langsommere', () => {
  const days = [0, 1, 2].map((index) => index * 86400 * S);
  const raw = {
    lastBoot: 1, fastStartup: true,
    boots: days.map((at) => ({ at, type: 1 })),
    logons: days.map((at) => at + 5 * S),
    runs: [...day(days[0], 0.5), ...day(days[1], 0.6), ...day(days[2], 30.8)],
    failedServices: [
      { at: days[2] + 35 * S, id: 7000, name: 'Steam Client Service' },
      { at: days[2] + 35 * S, id: 7009, name: 'Steam Client Service' },
      { at: days[2] + 400 * S, id: 7000, name: 'For sent' },
    ],
  };
  const summary = summarizeBoots(raw, settings);
  const [today, yesterday] = summary.sessions;

  assert.equal(summary.sessions.length, 3);
  assert.equal(today.at, days[2], 'nyeste først');
  assert.equal(today.logonAt, days[2] + 5 * S);
  assert.equal(today.totalSeconds, 80);
  assert.equal(today.normalTotalSeconds, 80);
  assert.equal(today.items[0].command, 'SecurityHealthSystray.exe', 'langsomste først');
  assert.equal(today.items[0].startedAt, days[2] + 30 * S, 'starttidspunktet bevares');
  assert.equal(today.items[1].startedAt, days[2] + 70 * S);
  assert.equal(today.slower, false, 'samme samlede tid som normalt');
  assert.equal(today.items[0].normal, 0.55);
  assert.equal(today.items[0].hitLimit, true);
  assert.equal(today.items[0].slower, true);
  assert.equal(today.items[1].slower, false, 'samme tid som normalt');
  assert.deepEqual(today.failedServices, [{ name: 'Steam Client Service', timeout: true }], 'samlet pr. tjeneste, uden for vinduet tæller ikke');
  assert.equal(yesterday.items.find((item) => item.command.startsWith('Security')).hitLimit, false);
});

test('opstart uden Run-data (loggen er rullet) giver tom liste, ikke fejl', () => {
  const summary = summarizeBoots({ lastBoot: 1, fastStartup: false, boots: [{ at: 0, type: 0 }], logons: [], runs: [], failedServices: [] }, settings);
  assert.equal(summary.sessions[0].totalSeconds, null);
  assert.deepEqual(summary.sessions[0].items, []);
});

test('opstart: slower pr. opstart med samme regel som posterne', () => {
  const days = [0, 1, 2].map((index) => index * 86400 * S);
  const boots = (seconds) => ({
    lastBoot: 1, fastStartup: false, boots: days.map((at) => ({ at, type: 0 })), logons: [], failedServices: [],
    runs: days.flatMap((at, index) => run(at, 'A.exe', seconds[index])),
  });
  const [slowToday, normalYesterday] = summarizeBoots(boots([60, 60, 130]), settings).sessions;
  assert.equal(slowToday.normalTotalSeconds, 60);
  assert.equal(slowToday.slower, true, '130 s er mindst 2 gange 60 s og mindst 5 s over');
  assert.equal(normalYesterday.slower, false, 'normalen er medianen af 60 og 130');

  const [tiny] = summarizeBoots(boots([2, 2, 5]), settings).sessions;
  assert.equal(tiny.slower, false, 'over 2 gange normalen, men kun 3 s over');
});

test('opstart uden tider er ikke langsommere', () => {
  const summary = summarizeBoots({ lastBoot: 1, fastStartup: false, boots: [{ at: 0, type: 0 }, { at: 86400 * S, type: 0 }], logons: [], runs: run(0, 'A.exe', 10), failedServices: [] }, settings);
  assert.equal(summary.sessions[0].totalSeconds, null);
  assert.equal(summary.sessions[0].slower, false);
});
