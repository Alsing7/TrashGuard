// Opstarter fra Windows' eventlog: fra tænd til opstartsprogrammerne er færdige.
// Ren funktion over ps/boot.ps1's output, så den kan testes uden Windows-kald.

const RUN_LIST_STARTED = 9705;
const RUN_STARTED = 9707;
const RUN_DONE = 9708;
const TIMEOUT_EVENTS = new Set([7009, 7011, 7022]);
const MS_PER_SECOND = 1000;

// "Langsommere": mindst slowerFactor gange normalen og mindst slowerMinSeconds over. Gælder både poster og hele opstarter.
function isSlower(seconds, normal, settings) {
  return seconds !== null && normal !== null && seconds >= normal * settings.slowerFactor && seconds - normal >= settings.slowerMinSeconds;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Par 9707 med næste 9708 for samme kommando.
function pairRuns(runs) {
  const started = new Map();
  const items = [];
  for (const run of runs) {
    if (run.id === RUN_STARTED) started.set(run.command, run.at);
    if (run.id !== RUN_DONE || !started.has(run.command)) continue;
    items.push({ command: run.command, startedAt: started.get(run.command), finishedAt: run.at });
    started.delete(run.command);
  }
  return items;
}

function failedServicesIn(events) {
  const byName = new Map();
  for (const event of events) {
    const timeout = TIMEOUT_EVENTS.has(event.id) || Boolean(byName.get(event.name)?.timeout);
    byName.set(event.name, { name: event.name, timeout });
  }
  return [...byName.values()];
}

function buildSession(boot, nextBootAt, raw, settings) {
  const inWindow = (at) => at >= boot.at && at < nextBootAt;
  const runs = raw.runs.filter((run) => inWindow(run.at)).sort((a, b) => a.at - b.at);
  const items = pairRuns(runs);
  const doneAt = items.length ? Math.max(...items.map((item) => item.finishedAt)) : null;
  const serviceUntil = Math.min(nextBootAt, boot.at + settings.failedServiceWindowSeconds * MS_PER_SECOND);
  return {
    at: boot.at,
    type: boot.type,
    logonAt: raw.logons.filter(inWindow).sort((a, b) => a - b)[0] ?? null,
    runsStartedAt: runs.find((run) => run.id === RUN_LIST_STARTED)?.at ?? null,
    doneAt,
    totalSeconds: doneAt === null ? null : (doneAt - boot.at) / MS_PER_SECOND,
    items: items.map((item) => ({ command: item.command, startedAt: item.startedAt, seconds: (item.finishedAt - item.startedAt) / MS_PER_SECOND })),
    failedServices: failedServicesIn(raw.failedServices.filter((event) => event.at >= boot.at && event.at < serviceUntil)),
  };
}

// "Normalt" = medianen af de andre opstarter, så en enkelt dårlig dag ikke trækker sig selv op.
function compareWithOthers(sessions, settings) {
  return sessions.map((session, index) => {
    const others = sessions.filter((_, otherIndex) => otherIndex !== index);
    const normalTotalSeconds = median(others.map((other) => other.totalSeconds).filter((value) => value !== null));
    const items = session.items.map((item) => {
      const normal = median(others.flatMap((other) => other.items.filter((candidate) => candidate.command === item.command).map((candidate) => candidate.seconds)));
      return {
        ...item,
        normal,
        hitLimit: item.seconds >= settings.explorerWaitSeconds,
        slower: isSlower(item.seconds, normal, settings),
      };
    }).sort((a, b) => b.seconds - a.seconds);
    return { ...session, normalTotalSeconds, slower: isSlower(session.totalSeconds, normalTotalSeconds, settings), items };
  });
}

export function summarizeBoots(raw, settings) {
  const boots = [...raw.boots].sort((a, b) => a.at - b.at);
  const sessions = boots.map((boot, index) => buildSession(boot, boots[index + 1]?.at ?? Infinity, raw, settings));
  return {
    lastBoot: raw.lastBoot,
    fastStartup: Boolean(raw.fastStartup),
    waitLimitSeconds: settings.explorerWaitSeconds,
    sessions: compareWithOthers(sessions, settings).reverse(),
  };
}
