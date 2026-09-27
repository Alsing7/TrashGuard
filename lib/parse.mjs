// Rene parsere uden sideeffekter, så de kan testes uden Windows-kald.

const FILETIME_EPOCH_OFFSET_MS = 11644473600000n;

export function expandEnv(text, env = process.env) {
  return text.replace(/%([^%]+)%/g, (whole, name) => {
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key ? env[key] : whole;
  });
}

// Finder exe-stien i en kommandolinje som `"C:\x\y.exe" --flag`,
// `C:\Program Files\Elgato\Volume Controller\x.exe` (mellemrum uden anførselstegn)
// eller `%windir%\system32\x.exe -k netsvcs`.
export function extractExe(command, env = process.env) {
  if (!command) return null;
  const text = expandEnv(String(command).trim(), env).replace(/^\\\?\?\\/, '');
  if (!text) return null;
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    return end > 1 ? text.slice(1, end) : null;
  }
  const withExtension = /^(.+?\.(?:exe|com|bat|cmd|lnk))(?=\s|$)/i.exec(text);
  if (withExtension) return withExtension[1];
  return text.split(/\s+/)[0];
}

export function fileName(filePath) {
  if (!filePath) return '';
  return filePath.split('\\').pop().toLowerCase();
}

// StartupApproved: første byte lige (02, 06) = aktiv, ulige (03) = slået fra.
// Manglende værdi betyder aktiv.
export function isApprovedEnabled(hex) {
  if (!hex) return true;
  return parseInt(hex.slice(0, 2), 16) % 2 === 0;
}

// Samme bytes som Jobliste skriver: 02 + nuller, eller 03 000000 + FILETIME.
export function approvedValue(enabled, nowMs = Date.now()) {
  if (enabled) return '02' + '00'.repeat(11);
  const filetime = (BigInt(nowMs) + FILETIME_EPOCH_OFFSET_MS) * 10000n;
  let hex = '';
  for (let byteIndex = 0n; byteIndex < 8n; byteIndex++) {
    hex += ((filetime >> (8n * byteIndex)) & 0xffn).toString(16).padStart(2, '0');
  }
  return '03000000' + hex;
}

export function parseJsonLine(line) {
  const text = String(line).replace(/^\uFEFF/, '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// "CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond" -> "Microsoft Corporation"
export function signerName(subject) {
  if (!subject) return null;
  const organisation = /(?:^|,\s*)O=("[^"]+"|[^,]+)/.exec(subject);
  const common = /(?:^|,\s*)CN=("[^"]+"|[^,]+)/.exec(subject);
  const picked = organisation?.[1] ?? common?.[1];
  return picked ? picked.replace(/^"|"$/g, '').trim() : null;
}
