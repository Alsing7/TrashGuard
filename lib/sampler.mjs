// Gør rå procesmålinger til CPU-%, RAM, GPU-% og VRAM pr. program eller tjeneste.
// Et program = alle processer med samme exe-sti. En tjenestevært = de tjenester den kører.

const HUNDRED_NS_PER_MS = 1e4;
const MAX_ANCESTOR_DEPTH = 8;
const IDLE_PID = 0;
const MAX_PERCENT = 100;
export const LENSES = ['cpu', 'ram', 'gpu', 'vram'];

export function groupKey(proc, hostedServices) {
  if (hostedServices?.length) return 'svc:' + hostedServices.map((service) => service.name).sort().join(',');
  return 'exe:' + (proc.path || proc.name || String(proc.pid)).toLowerCase();
}

export function cpuPercent(before, proc, at, cores) {
  // Ny proces, PID genbrugt af et andet program, eller CPU-tid der falder: intet delta.
  if (!before || before.name !== proc.name || proc.cpu < before.cpu || at <= before.at) return 0;
  return ((proc.cpu - before.cpu) / ((at - before.at) * HUNDRED_NS_PER_MS * cores)) * 100;
}

export function createSampler({ cores, historyLength, minAverageWindowMs }) {
  let previousByPid = new Map();
  // GPU måles sjældnere end resten; mellem målingerne gælder den seneste værdi.
  let gpuByPid = new Map();
  let lastAt = null;
  const groups = new Map();

  function ancestorsOf(rootProc, procsByPid, keyByPid) {
    const ancestors = [];
    const visited = new Set([rootProc.pid]);
    let current = procsByPid.get(rootProc.ppid);
    // ponytail: PID-genbrug kan i sjældne tilfælde give en forkert forælder; kræver CreationDate at løse.
    while (current && !visited.has(current.pid) && ancestors.length < MAX_ANCESTOR_DEPTH) {
      visited.add(current.pid);
      ancestors.unshift({ name: current.name, key: keyByPid.get(current.pid) });
      current = procsByPid.get(current.ppid);
    }
    return ancestors;
  }

  function ingest(tick, servicesByPid) {
    const at = tick.at;
    const tickMs = lastAt === null ? 0 : at - lastAt;
    lastAt = at;
    const procs = tick.procs.filter((proc) => proc.pid !== IDLE_PID);
    if (tick.system?.gpuTotal != null) gpuByPid = new Map(procs.map((proc) => [proc.pid, proc.gpu ?? 0]));
    // Loft: en proces kan ikke bruge mere VRAM end hele kortet har i brug.
    const vramCeiling = tick.system?.vramUsed || Infinity;
    const procsByPid = new Map(procs.map((proc) => [proc.pid, proc]));
    const keyByPid = new Map(procs.map((proc) => [proc.pid, groupKey(proc, servicesByPid.get(proc.pid))]));
    const nextPrevious = new Map();
    const live = new Map();

    for (const proc of procs) {
      const percent = cpuPercent(previousByPid.get(proc.pid), proc, at, cores);
      const counted = percent > 0 ? proc.cpu - previousByPid.get(proc.pid).cpu : 0;
      nextPrevious.set(proc.pid, { cpu: proc.cpu, at, name: proc.name });

      const key = keyByPid.get(proc.pid);
      const entry = live.get(key) ?? { procs: [], cpu: 0, cpuTime: 0, ram: 0, priv: 0, vram: 0, gpu: 0, win: false };
      entry.procs.push(proc);
      entry.cpu += percent;
      entry.cpuTime += counted;
      entry.ram += proc.ram;
      entry.priv += proc.priv ?? 0;
      entry.vram += proc.vram ?? 0;
      entry.gpu += gpuByPid.get(proc.pid) ?? 0;
      entry.win ||= proc.win;
      live.set(key, entry);
    }
    previousByPid = nextPrevious;

    for (const [key, entry] of live) {
      const group = groups.get(key) ?? { key, firstSeen: at, cpuTime: 0, gpuTime: 0, history: Object.fromEntries(LENSES.map((lens) => [lens, []])) };
      const gpu = Math.min(MAX_PERCENT, entry.gpu);
      const pids = new Set(entry.procs.map((proc) => proc.pid));
      const roots = entry.procs.filter((proc) => !pids.has(proc.ppid));
      const first = roots[0] ?? entry.procs[0];
      Object.assign(group, {
        name: first.name,
        path: first.path,
        services: servicesByPid.get(first.pid) ?? [],
        pids: [...pids],
        rootPids: roots.map((proc) => proc.pid),
        count: entry.procs.length,
        cpu: entry.cpu,
        cpuTime: group.cpuTime + entry.cpuTime,
        ram: entry.ram,
        priv: entry.priv,
        vram: Math.min(entry.vram, vramCeiling),
        gpu,
        gpuTime: group.gpuTime + gpu * tickMs,
        win: entry.win,
        running: true,
        lastSeen: at,
        ancestors: ancestorsOf(first, procsByPid, keyByPid),
      });
      groups.set(key, group);
    }

    // Programmer, der er lukket, bliver på listen: en updater, der kører 20 sek. i timen, er også bloat.
    for (const group of groups.values()) {
      if (!live.has(group.key) && group.running) Object.assign(group, { running: false, cpu: 0, ram: 0, priv: 0, vram: 0, gpu: 0, count: 0, pids: [], rootPids: [] });
      const windowMs = Math.max(at - group.firstSeen, minAverageWindowMs);
      group.avg = (group.cpuTime / (windowMs * HUNDRED_NS_PER_MS * cores)) * 100;
      group.gpuAvg = group.gpuTime / windowMs;
      for (const lens of LENSES) {
        group.history[lens].push(group[lens]);
        if (group.history[lens].length > historyLength) group.history[lens].shift();
      }
    }
    return [...groups.values()];
  }

  return { ingest, groups };
}
