// Planlægger, udfører og fortryder handlinger. Mål slås altid op i serverens egen tilstand,
// og fortryd bygges fra den gemte tidligere tilstand, aldrig fra gemte kommandoer.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { approvedValue } from './parse.mjs';

const SERVICE_START_ARG = { Auto: 'auto', Manual: 'demand', Disabled: 'disabled' };
const SERVICE_MODES = { manual: 'demand', disabled: 'disabled', auto: 'auto' };
const SERVICE_MODE_LABEL = { manual: 'Manuel', disabled: 'Deaktiveret', auto: 'Automatisk' };
const HEX_PATTERN = /^[0-9a-f]*$/;
const LOG_LIMIT = 200;
const STEP_TIMEOUT_MS = 30000;
const WIN32_ERRORS = {
  5: 'Adgang nægtet. Kør TrashGuard som administrator.',
  1051: 'Andre tjenester afhænger af den. Stop dem først.',
  1060: 'Tjenesten findes ikke længere.',
  1062: 'Tjenesten kører ikke.',
};
// Tegntabel 850 (dansk konsol): kun de bogstaver, fejltekster faktisk bruger.
const OEM_850 = { 0x81: 'ü', 0x82: 'é', 0x84: 'ä', 0x86: 'å', 0x8f: 'Å', 0x91: 'æ', 0x92: 'Æ', 0x94: 'ö', 0x9b: 'ø', 0x9d: 'Ø' };

const refuse = (error) => ({ error });
const step = (file, args, mayFail = false) => ({ file, args, mayFail });

function writeApproved(entry, hex) {
  return hex === null
    ? step('reg.exe', ['delete', entry.approvedKey, '/v', entry.name, '/f'], true)
    : step('reg.exe', ['add', entry.approvedKey, '/v', entry.name, '/t', 'REG_BINARY', '/d', hex, '/f']);
}

export function planAction(request, { groups, inventory, protectedServices }) {
  if (request.type === 'kill') {
    const group = groups.get(String(request.key));
    if (!group) return refuse('Programmet findes ikke længere.');
    if (group.killLocked) return refuse('Denne proces er beskyttet og kan ikke afsluttes herfra.');
    return {
      label: `Afsluttede ${group.name}`, target: { key: group.key }, undoable: false,
      steps: [step('taskkill.exe', ['/F', '/T', ...group.rootPids.flatMap((pid) => ['/PID', String(pid)])])],
    };
  }

  if (request.type === 'startup') {
    const entry = inventory.startupById.get(String(request.id));
    if (!entry) return refuse('Opstartsposten findes ikke længere.');
    const enable = request.enable === true;
    if (entry.enabled === enable) return refuse(enable ? 'Den er allerede slået til.' : 'Den er allerede slået fra.');
    return {
      label: `${enable ? 'Slog til' : 'Slog fra'} ved opstart: ${entry.name}`, target: { id: entry.id }, undoable: true,
      prev: { approvedHex: entry.approvedHex ?? null },
      steps: [writeApproved(entry, approvedValue(enable))],
    };
  }

  if (request.type === 'task') {
    const task = inventory.tasksById.get(String(request.id));
    if (!task) return refuse('Opgaven findes ikke længere.');
    const enable = request.enable === true;
    if (task.enabled === enable) return refuse(enable ? 'Opgaven er allerede aktiv.' : 'Opgaven er allerede deaktiveret.');
    return {
      label: `${enable ? 'Aktiverede' : 'Deaktiverede'} opgave: ${task.name}`, target: { id: task.id }, undoable: true,
      prev: { enabled: task.enabled },
      steps: [step('schtasks.exe', ['/Change', '/TN', task.id, enable ? '/ENABLE' : '/DISABLE'])],
    };
  }

  if (request.type === 'service') {
    const service = inventory.servicesByName.get(String(request.name).toLowerCase());
    if (!service) return refuse('Tjenesten findes ikke længere.');
    if (!(service.startMode in SERVICE_START_ARG)) return refuse(`Opstartstypen ${service.startMode} kan ikke ændres herfra.`);
    const startArg = SERVICE_MODES[request.mode];
    if (!startArg) return refuse('Ukendt tilstand.');
    // Låste tjenester må gerne vækkes igen, hvis noget andet har deaktiveret dem.
    if (protectedServices.has(service.name.toLowerCase()) && service.startMode !== 'Disabled') return refuse('Windows har brug for denne tjeneste. Den er låst.');
    const enabling = request.mode === 'auto';
    const alreadyThere = SERVICE_START_ARG[service.startMode] === startArg && (enabling ? service.state === 'Running' : service.state !== 'Running');
    if (alreadyThere) return refuse('Tjenesten er allerede sat sådan.');
    const change = service.startMode === 'Disabled' ? `aktiveret som ${SERVICE_MODE_LABEL[request.mode]}`
      : enabling ? 'sat til Automatisk og startet'
        : `stoppet og sat til ${SERVICE_MODE_LABEL[request.mode]}`;
    return {
      label: `${service.display}: ${change}`,
      target: { name: service.name }, undoable: true,
      prev: { startMode: service.startMode, delayed: service.delayed, state: service.state },
      steps: enabling
        ? [step('sc.exe', ['config', service.name, 'start=', startArg]), step('sc.exe', ['start', service.name], true)]
        : [step('sc.exe', ['stop', service.name], true), step('sc.exe', ['config', service.name, 'start=', startArg])],
    };
  }

  return refuse('Ukendt handling.');
}

export function planUndo(entry, { inventory }) {
  if (!entry || entry.undone || !entry.undoable) return refuse('Kan ikke fortrydes.');

  if (entry.type === 'startup') {
    const startupEntry = inventory.startupById.get(entry.target.id);
    const hex = entry.prev.approvedHex;
    if (!startupEntry) return refuse('Opstartsposten findes ikke længere.');
    if (hex !== null && !HEX_PATTERN.test(hex)) return refuse('Loggen er beskadiget.');
    return { steps: [writeApproved(startupEntry, hex)] };
  }

  if (entry.type === 'task') {
    const task = inventory.tasksById.get(entry.target.id);
    if (!task) return refuse('Opgaven findes ikke længere.');
    return { steps: [step('schtasks.exe', ['/Change', '/TN', task.id, entry.prev.enabled ? '/ENABLE' : '/DISABLE'])] };
  }

  if (entry.type === 'service') {
    const service = inventory.servicesByName.get(String(entry.target.name).toLowerCase());
    if (!service) return refuse('Tjenesten findes ikke længere.');
    const startArg = entry.prev.startMode === 'Auto' && entry.prev.delayed ? 'delayed-auto' : SERVICE_START_ARG[entry.prev.startMode];
    if (!startArg) return refuse('Loggen er beskadiget.');
    const steps = [step('sc.exe', ['config', service.name, 'start=', startArg])];
    if (entry.prev.state === 'Running') steps.push(step('sc.exe', ['start', service.name], true));
    return { steps };
  }

  return refuse('Kan ikke fortrydes.');
}

function decodeOem(buffer) {
  let text = '';
  for (const byte of buffer) text += byte < 0x80 ? String.fromCharCode(byte) : (OEM_850[byte] ?? '?');
  return text.trim();
}

function runStep({ file, args, mayFail }) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: STEP_TIMEOUT_MS, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (!error || mayFail) return resolve();
      const output = decodeOem(Buffer.concat([stdout, stderr]));
      const win32Code = Number(/FAILED (\d+)/.exec(output)?.[1] ?? error.code);
      reject(new Error(WIN32_ERRORS[win32Code] ?? (output || `${file} fejlede (kode ${error.code}).`)));
    });
  });
}

export async function runSteps(steps) {
  for (const current of steps) await runStep(current);
}

export function createJsonStore(filePath, fallback) {
  return {
    read() {
      try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
      } catch {
        return fallback;
      }
    },
    write(value) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    },
  };
}

export function logEntry(type, plan) {
  return { id: randomUUID(), at: Date.now(), type, label: plan.label, target: plan.target, prev: plan.prev ?? null, undoable: plan.undoable, undone: false };
}

export function appendLog(log, entry) {
  return [entry, ...log].slice(0, LOG_LIMIT);
}
