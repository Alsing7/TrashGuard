Status: godkendt i brainstorm · 2026-10-30

# Ryd op: kendte caches til papirkurven

## Mål

En fane, "Ryd op", der viser kendte cache-placeringer på maskinen med størrelse og flytter de valgte til papirkurven med ét bekræftet klik. Ingen leder i Disk-kortet efter mapperne.

## Beslutninger

- **Papirkurv, aldrig permanent.** TrashGuards princip holder. Alt kan gendannes fra Windows' papirkurv.
- **Egen fane** mellem Disk og Log, uafhængig af Disk-scanningen.
- **Indholdet tømmes, mappen bliver stående.** Hvert direkte barn flyttes for sig. Junctions og symlinks røres ikke (hverken som mål, som barn eller ved udfoldning af `*`).
- **Ingen aldersgrænse.** Filer i brug afvises af Windows og tælles; resten fortsætter.
- **Papirkurvens fyld tjekkes.** Windows sletter de ældste ting i papirkurven permanent, når den er fuld. Derfor afviser `ps/recycle.ps1`, hvis det, der allerede ligger i papirkurven (`SHQueryRecycleBin`), plus det nye overstiger `MaxCapacity × CapacityMargin`. Det gælder også Disk-fanens Papirkurv, fordi den bruger samme script.
- **Mål fra serverens egen liste.** Klienten sender rækkenavne, aldrig stier.

## Data

Ny nøgle `clean` i `kendt-bloat.json`, en liste af rækker:

```json
{ "name": "Chrome", "text": "Browserens cache. Bygges op igen.",
  "paths": ["%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Cache",
            "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Code Cache",
            "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\GPUCache"] }
```

`%miljøvariabler%` udfoldes med `expandEnv`. Et `*` matcher ét stiled (alle mapper på det niveau, ikke junctions). Rækker uden en eneste eksisterende sti vises ikke. `folders` (ravfarven i Disk) er uændret.

Startlisten: Temp (din), Windows Temp, CrashDumps, NVIDIA shader-cache (DXCache, GLCache), AMD DxCache, DirectX (D3DSCache), npm (npm-cache), Yarn, pnpm, pip, Chrome, Edge, Brave, Firefox (`Profiles\*\cache2`), Discord (Cache, Code Cache), VS Code (Cache, CachedData), Steam (htmlcache). Udeladt: Stifinders thumbcache (altid låst), Windows Update og gendannelsespunkter (Windows' egne værktøjer).

## Server: `lib/clean.mjs`

- `expandRows(rows, env)`: rækker → `[{ name, text, paths: [eksisterende, normaliserede mapper] }]`, uden reparse points, uden stier som `rules.lockReason` afviser.
- `createCleanService({ rows, rules, scanOptions, recycleScript, dataDir, runPowerShell, onLog })` med ruterne:
  - `POST /api/clean/list` → `{ rows: [{ name, text, paths, size, files }] }`. Måler hver sti med `startScan`. Kører ikke samtidig med en oprydning.
  - `POST /api/clean/run` `{ names: [...] }` → ukendte navne afvises med 400. For hver sti: list direkte børn (lstat, spring reparse points over), skriv listen til en fil, kald `recycle.ps1 -ListFile … -Bytes <målt størrelse>`. Summér `moved`, `failed`, flyttede bytes. Ét logopslag af typen `recycle`, `undoable: false`. Svaret indeholder de nye målinger.
- Fejlårsager fra scriptet (`bin-disabled`, `no-bin-settings`, `too-big`, `bin-full`) gives videre som danske tekster; `too-big`/`bin-full` stopper resten af kørslen.

## `ps/recycle.ps1`

- Parametre: `-ListFile` (JSON-liste af stier, alle på samme drev) og `-Bytes` (samlet størrelse). `-Path` udgår; Disk-fanen skriver en liste med ét element.
- Før-tjek som i dag plus `bin-full` (`SHQueryRecycleBin` på drevet: `i64Size + Bytes > MaxCapacity × CapacityMargin` → `{ ok = $false; reason = 'bin-full'; usedBytes; maxBytes }`).
- Hver sti flyttes med sit eget `SHFileOperation`-kald. Mangler stien, tælles den ikke. Svar: `{ ok = $true; moved; failed }`.
- Kun ASCII.

## Disk-fanen

`disk-service.mjs` skriver én sti til en listefil og læser `{ ok, moved, failed }`. `failed > 0` giver samme tekst som i dag ("Windows kunne ikke flytte det hele…"). `bin-full` får en ny tekst.

## UI: `public/clean.js`, `public/clean.css`

- Modulkontrakten fra `docs/design.md`: `mount`, `show` (måler første gang), `hide` (`cancelConfirm`).
- En liste: afkrydsning (rigtig `input type="checkbox"` med label), navn, størrelse i data-skrift. `text` og stierne i `title`. Rækker sorteres efter størrelse. Intet er valgt fra start; "Vælg alle" i hovedet.
- Fod: "Valgt: X GB" og `confirmButton('Papirkurv', 'Bekræft: X GB', …, 'button button-danger', 'trash3')`. "Mål igen" som `icon-button`.
- Under måling: dæmpet tekst "Måler…", knapperne deaktiveret.
- Faste regler fra design.md: dansk, tokens fra style.css, ingen inline style, `.chip`/`.callout` genbruges, 390 px uden vandret scroll, CSS indkapslet under `#tab-clean`.
- `index.html`: fanen og `section#tab-clean`; `server.mjs`: `clean.js` og `clean.css` på `STATIC_FILES`; `app.js`: `TABS.clean`. Log-fanen kender allerede `recycle`.

## Test

- `node --test`: `expandRows` med en midlertidig mappe (env peger derhen): `*` foldes ud, junction springes over, ikke-eksisterende sti droppes, låst sti droppes. `/api/clean/run` med ukendt navn → 400 uden at kalde PowerShell. Børnelisten springer junctions over.
- I hånden: `recycle.ps1` mod en testmappe i scratchpad: flyt virker, en åben fil tælles som `failed`, og et `-Bytes` lige under `MaxCapacity × CapacityMargin` giver `bin-full`, når papirkurven ikke er tom. Aldrig mod brugerens rigtige caches.
- README og docs/plan.md får et afsnit.

## Ikke med

Aldersfilter, advarsel om kørende programmer, opdatering af gemte Disk-scanninger, planlagt automatisk oprydning.
