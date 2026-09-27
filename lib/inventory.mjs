// Kører inventory.ps1 og beriger resultatet: exe-sti, om filen findes, kendt bloat.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extractExe, isApprovedEnabled } from './parse.mjs';

const INVENTORY_TIMEOUT_MS = 60000;
const INVENTORY_MAX_BYTES = 32 * 1024 * 1024;

export function runPowerShell(scriptPath, args = [], timeoutMs = INVENTORY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: INVENTORY_MAX_BYTES, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

// Uden mappe (fx "rundll32.exe") kan vi ikke sige, at den mangler.
function fileMissing(exePath) {
  return Boolean(exePath && exePath.includes('\\') && !existsSync(exePath));
}

export function enrichInventory(raw, knownBloat, windowsDir) {
  const windowsPrefix = windowsDir.toLowerCase() + '\\';

  const startup = raw.startup.map((entry) => {
    const exe = extractExe(entry.command);
    return {
      ...entry, kind: 'startup', type: entry.kind,
      id: `${entry.kind}:${entry.scope}:${entry.name}`,
      label: entry.name, exe,
      enabled: isApprovedEnabled(entry.approvedHex),
      orphan: fileMissing(exe),
      bloatText: knownBloat.forExe(exe),
    };
  });

  const tasks = raw.tasks.map((task) => {
    const exe = task.execute ? extractExe(task.execute.startsWith('"') ? task.execute : `"${task.execute}"`) : null;
    const id = task.path + task.name;
    return {
      ...task, kind: 'task', id, label: task.name, exe,
      enabled: task.state !== 'Disabled',
      microsoft: task.path.startsWith('\\Microsoft\\'),
      orphan: fileMissing(exe),
      bloatText: knownBloat.forTask(id) ?? knownBloat.forExe(exe),
    };
  });

  const services = raw.services.map((service) => {
    const exe = extractExe(service.command);
    return {
      ...service, kind: 'service', id: service.name, label: service.display, exe,
      enabled: service.startMode !== 'Disabled',
      windows: Boolean(exe?.toLowerCase().startsWith(windowsPrefix)),
      orphan: fileMissing(exe),
      bloatText: knownBloat.forService(service.name) ?? knownBloat.forExe(exe),
    };
  });

  // Opslag fra exe-sti til det, der starter den. Tjenester i delte værter (svchost) findes via PID i stedet.
  const byExe = new Map();
  for (const item of [...startup, ...tasks, ...services.filter((service) => !service.windows)]) {
    if (!item.exe) continue;
    const key = item.exe.toLowerCase();
    byExe.set(key, [...(byExe.get(key) ?? []), { kind: item.kind, id: item.id, label: item.label, enabled: item.enabled, startMode: item.startMode ?? null }]);
  }

  return {
    admin: raw.admin,
    drives: raw.drives ?? [],
    startup, tasks, services,
    byExe,
    servicesByName: new Map(services.map((service) => [service.name.toLowerCase(), service])),
    startupById: new Map(startup.map((entry) => [entry.id, entry])),
    tasksById: new Map(tasks.map((task) => [task.id, task])),
  };
}
