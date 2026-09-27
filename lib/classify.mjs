// Mærker, kategori og bloat-score for hver gruppe fra sampleren.
import { fileName } from './parse.mjs';

const MICROSOFT_SIGNER = 'microsoft corporation';
const KILL_LOCKS = new Set(['critical', 'windows', 'pending', 'stopped', 'nopath', 'self']);
// Systemprocesser: giver hverken vindue eller autostart videre, og tæller kun som synder ved reelt CPU-forbrug.
const SYSTEM_LOCKS = new Set(['critical', 'windows', 'pending', 'nopath']);
const BYTES_PER_MB = 1048576;
const LENS_VALUE = {
  cpu: (group) => group.avg,
  ram: (group) => group.ram / BYTES_PER_MB,
  gpu: (group) => group.gpuAvg,
  vram: (group) => group.vram / BYTES_PER_MB,
};

export function createKnownBloat(raw) {
  const lowerMap = (object) => new Map(Object.entries(object ?? {}).map(([name, text]) => [name.toLowerCase(), text]));
  const byExe = lowerMap(raw.exe);
  const byService = lowerMap(raw.service);
  const taskNeedles = [...lowerMap(raw.task)];
  return {
    forExe: (exePath) => byExe.get(fileName(exePath)) ?? null,
    forService: (name) => byService.get(String(name).toLowerCase()) ?? null,
    forTask: (taskName) => taskNeedles.find(([needle]) => String(taskName).toLowerCase().includes(needle))?.[1] ?? null,
  };
}

export function protection(group, fileInfo, { protectedProcesses, windowsDir }) {
  if (!group.running) return 'stopped';
  if (protectedProcesses.has(String(group.name).toLowerCase())) return 'critical';
  if (!group.path) return 'nopath';
  if (!group.path.toLowerCase().startsWith(windowsDir.toLowerCase() + '\\')) return null;
  if (!fileInfo) return 'pending';
  const microsoft = fileInfo.valid && String(fileInfo.signer).toLowerCase() === MICROSOFT_SIGNER;
  return microsoft ? 'windows' : null;
}

function ownSignals(group, ctx) {
  const { inventory, knownBloat } = ctx;
  const sources = group.services.map((hosted) => {
    const service = inventory.servicesByName.get(hosted.name.toLowerCase());
    return { kind: 'service', id: hosted.name, label: service?.display ?? hosted.display ?? hosted.name, startMode: service?.startMode ?? null, enabled: service?.startMode !== 'Disabled' };
  });
  for (const item of inventory.byExe.get(String(group.path).toLowerCase()) ?? []) {
    if (!sources.some((source) => source.kind === item.kind && source.id === item.id)) sources.push(item);
  }
  const autostart = sources.some((source) => source.enabled && (source.kind !== 'service' || source.startMode === 'Auto'));
  const bloatText = knownBloat.forExe(group.path)
    ?? group.services.map((hosted) => knownBloat.forService(hosted.name)).find(Boolean)
    ?? null;
  const lock = group.pids.some((pid) => ctx.selfPids.has(pid)) ? 'self' : protection(group, ctx.meta.get(String(group.path).toLowerCase()), ctx.config);
  return { sources, autostart, bloatText, lock };
}

// Intet vindue, og mindst én ressource over sin tærskel. Returnerer hvilke, fx ['RAM', 'VRAM'].
export function backgroundReasons(group, thresholds) {
  if (group.win || !group.running) return [];
  return [
    group.avg >= thresholds.cpuPercent && 'CPU',
    group.ram >= thresholds.ramMb * BYTES_PER_MB && 'RAM',
    group.gpuAvg >= thresholds.gpuPercent && 'GPU',
    group.vram >= thresholds.vramMb * BYTES_PER_MB && 'VRAM',
  ].filter(Boolean);
}

function category(group, signals, ctx) {
  if (signals.lock === 'self') return 'self';
  if (signals.lock === 'critical') return 'critical';
  if (ctx.trusted.has(group.key)) return 'trusted';
  if (signals.bloatText) return 'suspect';
  const background = signals.background.length > 0;
  if (SYSTEM_LOCKS.has(signals.lock)) return background ? 'suspect' : 'windows';
  if (!signals.startedByYou && (signals.autostart || background)) return 'suspect';
  return 'yours';
}

export function classifyAll(groups, ctx) {
  const results = new Map(groups.map((group) => [group.key, { ...ownSignals(group, ctx), win: group.win }]));

  for (const group of groups) {
    const signals = results.get(group.key);
    const ancestors = group.ancestors
      .map((ancestor) => ({ name: ancestor.name, signals: results.get(ancestor.key) }))
      .filter((ancestor) => ancestor.signals && !SYSTEM_LOCKS.has(ancestor.signals.lock));
    const autostartParent = !signals.autostart ? ancestors.find((ancestor) => ancestor.signals.autostart) : null;
    const topmost = group.ancestors.at(-1)?.name?.toLowerCase();

    signals.autostartVia = autostartParent?.name ?? null;
    signals.autostart ||= Boolean(autostartParent);
    signals.startedByYou = group.win
      || ancestors.some((ancestor) => ancestor.signals.win)
      || (!signals.autostart && topmost === 'explorer.exe');
    signals.background = backgroundReasons(group, ctx.config.thresholds);
    signals.category = category(group, signals, ctx);
    signals.killLocked = KILL_LOCKS.has(signals.lock);
    signals.scores = scores(group, signals, ctx.config.weights);
  }
  return results;
}

// Én score pr. linse: CPU og GPU efter snit i sessionen, RAM og VRAM (i MB) efter nu.
function scores(group, signals, weights) {
  let multiplier = signals.category === 'suspect' ? 1 : 0;
  if (signals.background.length) multiplier *= weights.background;
  if (signals.autostart) multiplier *= weights.autostart;
  if (signals.bloatText) multiplier *= weights.knownBloat;
  return Object.fromEntries(Object.entries(LENS_VALUE).map(([lens, value]) => [lens, value(group) * multiplier]));
}

// Hvad syndere bruger lige nu: CPU og GPU i %, RAM og VRAM i bytes.
export function headlines(groups, results) {
  const totals = { cpu: 0, ram: 0, gpu: 0, vram: 0 };
  for (const group of groups) {
    if (!group.running || results.get(group.key)?.category !== 'suspect') continue;
    for (const lens of Object.keys(totals)) totals[lens] += group[lens];
  }
  totals.gpu = Math.min(100, totals.gpu);
  return totals;
}
