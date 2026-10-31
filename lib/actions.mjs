// Planlægger, udfører og fortryder handlinger. Mål slås altid op i serverens egen tilstand,
// og fortryd bygges fra den gemte tidligere tilstand, aldrig fra gemte kommandoer.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { approvedValue } from './parse.mjs';
import { text } from './text.mjs';

const SERVICE_START_ARG = { Auto: 'auto', Manual: 'demand', Disabled: 'disabled' };
const SERVICE_MODES = { manual: 'demand', disabled: 'disabled', auto: 'auto' };
const SERVICE_MODE_LABEL = { manual: text('Manuel', 'Manual'), disabled: text('Deaktiveret', 'Disabled'), auto: text('Automatisk', 'Automatic') };
const HEX_PATTERN = /^[0-9a-f]*$/;
const LOG_LIMIT = 200;
const STEP_TIMEOUT_MS = 30000;
const WIN32_ERRORS = {
  5: text('Adgang nægtet. Kør TrashGuard som administrator.', 'Access denied. Run TrashGuard as administrator.'),
  1051: text('Andre tjenester afhænger af den. Stop dem først.', 'Other services depend on it. Stop them first.'),
  1060: text('Tjenesten findes ikke længere.', 'The service no longer exists.'),
  1062: text('Tjenesten kører ikke.', 'The service is not running.'),
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
    if (!group) return refuse(text('Programmet findes ikke længere.', 'The program no longer exists.'));
    if (group.killLocked) return refuse(text('Denne proces er beskyttet og kan ikke afsluttes herfra.', 'This process is protected and cannot be ended from here.'));
    return {
      label: text(`Afsluttede ${group.name}`, `Ended ${group.name}`), target: { key: group.key }, undoable: false,
      steps: [step('taskkill.exe', ['/F', '/T', ...group.rootPids.flatMap((pid) => ['/PID', String(pid)])])],
    };
  }

  if (request.type === 'startup') {
    const entry = inventory.startupById.get(String(request.id));
    if (!entry) return refuse(text('Opstartsposten findes ikke længere.', 'The startup entry no longer exists.'));
    const enable = request.enable === true;
    if (entry.enabled === enable) return refuse(enable ? text('Den er allerede slået til.', 'It is already on.') : text('Den er allerede slået fra.', 'It is already off.'));
    return {
      label: enable ? text(`Slog til ved opstart: ${entry.name}`, `Turned on at startup: ${entry.name}`) : text(`Slog fra ved opstart: ${entry.name}`, `Turned off at startup: ${entry.name}`), target: { id: entry.id }, undoable: true,
      prev: { approvedHex: entry.approvedHex ?? null },
      steps: [writeApproved(entry, approvedValue(enable))],
    };
  }

  if (request.type === 'task') {
    const task = inventory.tasksById.get(String(request.id));
    if (!task) return refuse(text('Opgaven findes ikke længere.', 'The task no longer exists.'));
    const enable = request.enable === true;
    if (task.enabled === enable) return refuse(enable ? text('Opgaven er allerede aktiv.', 'The task is already enabled.') : text('Opgaven er allerede deaktiveret.', 'The task is already disabled.'));
    return {
      label: enable ? text(`Aktiverede opgave: ${task.name}`, `Enabled task: ${task.name}`) : text(`Deaktiverede opgave: ${task.name}`, `Disabled task: ${task.name}`), target: { id: task.id }, undoable: true,
      prev: { enabled: task.enabled },
      steps: [step('schtasks.exe', ['/Change', '/TN', task.id, enable ? '/ENABLE' : '/DISABLE'])],
    };
  }

  if (request.type === 'service') {
    const service = inventory.servicesByName.get(String(request.name).toLowerCase());
    if (!service) return refuse(text('Tjenesten findes ikke længere.', 'The service no longer exists.'));
    if (!(service.startMode in SERVICE_START_ARG)) return refuse(text(`Opstartstypen ${service.startMode} kan ikke ændres herfra.`, `The startup type ${service.startMode} cannot be changed from here.`));
    const startArg = SERVICE_MODES[request.mode];
    if (!startArg) return refuse(text('Ukendt tilstand.', 'Unknown mode.'));
    // Låste tjenester må gerne vækkes igen, hvis noget andet har deaktiveret dem.
    if (protectedServices.has(service.name.toLowerCase()) && service.startMode !== 'Disabled') return refuse(text('Windows har brug for denne tjeneste. Den er låst.', 'Windows needs this service. It is locked.'));
    const enabling = request.mode === 'auto';
    const alreadyThere = SERVICE_START_ARG[service.startMode] === startArg && (enabling ? service.state === 'Running' : service.state !== 'Running');
    if (alreadyThere) return refuse(text('Tjenesten er allerede sat sådan.', 'The service is already set that way.'));
    const mode = SERVICE_MODE_LABEL[request.mode];
    const change = service.startMode === 'Disabled' ? text(`aktiveret som ${mode.da}`, `enabled as ${mode.en}`)
      : enabling ? text('sat til Automatisk og startet', 'set to Automatic and started')
        : text(`stoppet og sat til ${mode.da}`, `stopped and set to ${mode.en}`);
    return {
      label: text(`${service.display}: ${change.da}`, `${service.display}: ${change.en}`),
      target: { name: service.name }, undoable: true,
      prev: { startMode: service.startMode, delayed: service.delayed, state: service.state },
      steps: enabling
        ? [step('sc.exe', ['config', service.name, 'start=', startArg]), step('sc.exe', ['start', service.name], true)]
        : [step('sc.exe', ['stop', service.name], true), step('sc.exe', ['config', service.name, 'start=', startArg])],
    };
  }

  return refuse(text('Ukendt handling.', 'Unknown action.'));
}

export function planUndo(entry, { inventory }) {
  if (!entry || entry.undone || !entry.undoable) return refuse(text('Kan ikke fortrydes.', 'Cannot be undone.'));

  if (entry.type === 'startup') {
    const startupEntry = inventory.startupById.get(entry.target.id);
    const hex = entry.prev.approvedHex;
    if (!startupEntry) return refuse(text('Opstartsposten findes ikke længere.', 'The startup entry no longer exists.'));
    if (hex !== null && !HEX_PATTERN.test(hex)) return refuse(text('Loggen er beskadiget.', 'The log is damaged.'));
    return { steps: [writeApproved(startupEntry, hex)] };
  }

  if (entry.type === 'task') {
    const task = inventory.tasksById.get(entry.target.id);
    if (!task) return refuse(text('Opgaven findes ikke længere.', 'The task no longer exists.'));
    return { steps: [step('schtasks.exe', ['/Change', '/TN', task.id, entry.prev.enabled ? '/ENABLE' : '/DISABLE'])] };
  }

  if (entry.type === 'service') {
    const service = inventory.servicesByName.get(String(entry.target.name).toLowerCase());
    if (!service) return refuse(text('Tjenesten findes ikke længere.', 'The service no longer exists.'));
    const startArg = entry.prev.startMode === 'Auto' && entry.prev.delayed ? 'delayed-auto' : SERVICE_START_ARG[entry.prev.startMode];
    if (!startArg) return refuse(text('Loggen er beskadiget.', 'The log is damaged.'));
    const steps = [step('sc.exe', ['config', service.name, 'start=', startArg])];
    if (entry.prev.state === 'Running') steps.push(step('sc.exe', ['start', service.name], true));
    return { steps };
  }

  return refuse(text('Kan ikke fortrydes.', 'Cannot be undone.'));
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
      // Windows' egen fejltekst står på Windows' sprog; den kendte tekst oversættes.
      const known = WIN32_ERRORS[win32Code];
      reject(Object.assign(new Error(known?.da ?? (output || `${file} failed (code ${error.code}).`)), { text: known ?? (output ? null : text(`${file} fejlede (kode ${error.code}).`, `${file} failed (code ${error.code}).`)) ?? undefined }));
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
