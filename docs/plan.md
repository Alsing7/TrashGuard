Status: bygget · 2026-09-27 · verificeret mod koden

# TrashGuard – implementeringsplan

**Mål:** Lokalt web-dashboard, der finder CPU-slugere og baggrunds-bloat, viser hvad hver ting er knyttet til, og slår det fra med ét klik, der kan fortrydes.

**Arkitektur:** `server.mjs` (Node, kun stdlib) kører som administrator og lytter kun på `127.0.0.1:4319`. En vedvarende PowerShell-løkke (`ps/sampler.ps1`) udsender én JSON-linje hvert 2. sekund, men kun mens en browserfane er forbundet via SSE. Opstartsposter, tjenester og opgaver læses af `ps/inventory.ps1` ved opstart, ved "Opdatér" og efter hver handling. Handlinger køres med `execFile` (reg.exe, schtasks.exe, sc.exe, taskkill.exe) uden shell. Mål findes altid i serverens egen tilstand, aldrig i klientens data.

**Stak:** Node 18+ (stdlib `http`, `child_process`, `node:test`), Windows PowerShell 5.1, CIM. Ingen npm-afhængigheder.

## Globale krav
- Kun `127.0.0.1`. Host-headeren skal være `127.0.0.1:<port>` eller `localhost:<port>`.
- Alle handlinger kræver headeren `X-TrashGuard-Token` (tilfældigt ved hver opstart) og en Origin, der matcher, hvis den er sat.
- Sampling kun mens en fane er forbundet. Når den sidste fane er lukket, lukker serveren efter `shutdownGraceMs`.
- Tjenester slås som standard fra til **Manuel**. **Deaktiveret** ligger bag et ekstra klik.
- Hver ændring logges i `data/handlinger.json` med den tidligere tilstand. At afslutte en proces kan ikke fortrydes.
- Fladt UI: ingen gradient, ingen blur, ingen emoji. Al tekst er på dansk med rigtige Æ, Ø og Å.
- `.ps1`-filer er kun ASCII (PowerShell 5.1 læser UTF-8 uden BOM forkert).

## Filer
| Fil | Ansvar |
|---|---|
| `server.mjs` | HTTP, sikkerhedstjek, SSE, livscyklus, ruter |
| `lib/parse.mjs` | Rene parsere: exe-sti fra kommando, StartupApproved-bytes, JSON-linjer |
| `lib/sampler.mjs` | CPU-deltaer, RAM, GPU (fastholdt mellem målinger), VRAM (loftet), gruppering pr. program/tjeneste, historik pr. linse |
| `lib/classify.mjs` | Mærker, baggrundsårsager, score pr. linse, overskriftstal pr. linse |
| `lib/inventory.mjs` | Kører inventory.ps1 og beriger med exe-sti, om filen findes, og kendt bloat |
| `lib/actions.mjs` | Planlægger og udfører handlinger, handlingslog og fortryd |
| `lib/guard.mjs` | Tjek af Host, Origin og token |
| `lib/disk.mjs` | Diskscanner, træ, låse- og skraldregler, visningsudsnit |
| `lib/disk-service.mjs` | Disk-ruter, gemte scanninger, genscanning, papirkurv, Stifinder |
| `ps/recycle.ps1` | Papirkurv med kapacitetstjek (SHFileOperation) |
| `ps/sizes.ps1` | Størrelser på låste filer via mappeoversigten; skyggekopiernes plads |
| `ps/sampler.ps1` | Løkke: processer, vinduer, RAM, VRAM, GPU-motorer (hvert `gpuEveryTicks`. tick), tjeneste-PID'er, signaturer |
| `ps/inventory.ps1` | Opstartsposter, tjenester, planlagte opgaver, admin-status |
| `public/*` | UI |
| `config.json` | Port, interval, tærskler, vægte, beskyttede navne |
| `kendt-bloat.json` | Redigerbar liste over kendt bloat |
| `test/core.test.mjs`, `test/disk.test.mjs` | `node --test` |
| `lav-genvej.ps1` | Genvej på skrivebordet med "Kør som administrator" |

## Opgaver
1. Parsere og deres test (`lib/parse.mjs`).
2. Sampler: CPU-deltaer, gruppering, historik, plus test for PID-genbrug.
3. Klassificering: mærker og score, plus test for beskyttet-før-alt og ukendt signatur.
4. PowerShell-scripts og inventory.
5. Handlinger, log og fortryd, plus test for, hvilke handlinger der bliver afvist.
6. Server: sikkerhedstjek (med test), SSE og livscyklus.
7. UI.
8. Genvej og README.

## Review-fokus
1. PID genbruges, eller en proces genstarter, så CPU-tiden falder. Forventet: ingen negativ CPU, nulstil deltaet.
2. Kommando uden anførselstegn med mellemrum (`C:\Program Files\Elgato\Volume Controller\X.exe`) og `%miljøvariabler%`. Forventet: korrekt exe-sti.
3. En fremmed hjemmeside eller DNS-rebinding mod admin-serveren. Forventet: 403 uden token eller med forkert Host.
4. Signaturen for en Windows-proces er ikke hentet endnu. Forventet: "Afslut" er låst, indtil den er kendt.
5. Tjeneste med opstartstype Boot/System eller en tjeneste på den beskyttede liste. Forventet: serveren afviser, uanset hvad klienten sender.

## Udvidelse: RAM og GPU (2026-09-27)
Fire linser (CPU, RAM, GPU, VRAM), valgt i en grill-session. GPU-motorer koster ca. 300 ms pr. CIM-kald og måles derfor kun hvert `gpuEveryTicks`. tick. VRAM pr. proces bruger `LocalUsage`, fordi `DedicatedUsage` pr. proces viste 27 GB for Voicemod på et 16 GB-kort. Mærket Baggrund udløses af en hvilken som helst ressource over sin tærskel i `backgroundThresholds`.

## Udvidelse: Disk (2026-09-27)
Disk-fanen som SpaceSniffer, valgt i en grill-session: almindelig parallel filscanning (målt ca. 15.000 filer/s på C:; D: med 243.000 filer tog 27 sek.), seneste scanning gemt pr. rod, kasser og solstråle, "Flyt til papirkurv" med kapacitetstjek. MFT-læsning (som WizTree) er fravalgt, indtil ventetiden er et problem. Den kan skiftes ind bag `startScan` uden at røre klienten.
