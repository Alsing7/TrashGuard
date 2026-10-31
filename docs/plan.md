Status: bygget · 2026-10-08 · verificeret mod koden

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
| `ps/boot.ps1` | De seneste opstarter fra eventloggen: starttype, logon, Run-tider, fejlede tjenester |
| `lib/boot.mjs` | Opsummerer opstarterne: tid og starttidspunkt pr. post, median af de andre opstarter, mærker, `slower` pr. opstart |
| `public/*` | UI: skal, ét modul og én CSS pr. fane, fælles hjælpere (se `docs/design.md`) |
| `tools/icons.mjs`, `tools/palette-check.mjs` | Genererer `public/icons.css`; tjekker farvernes kontrast og ΔE |
| `config.json` | Port, interval, tærskler, vægte, beskyttede navne |
| `kendt-bloat.json` | Redigerbar liste over kendt bloat |
| `test/core.test.mjs`, `test/disk.test.mjs`, `test/boot.test.mjs` | `node --test` |
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

## Udvidelse: Seneste opstart (2026-10-07)
Brugeren ville se, hvad der gjorde opstarten langsom, uden at skulle spørge hver gang. Explorer starter Run-nøglerne én ad gangen og logger hver af dem i Shell-Core (9707/9708), så tiden pr. post kan måles direkte. Opstarten 2026-10-07 tog 2 min 26 s mod normalt 59 s, fordi SecurityHealthSystray og RtkAudUService64 begge ramte Explorers grænse på 30 s. Data læses kun ved start og på "Opdatér", fordi de kun ændrer sig ved en genstart.

## Udvidelse: UI-overhaul (2026-10-07)
Brugeren ville have en mere levende, minimalistisk UI med mindre tekst. En designkonkurrence med tre retninger endte med "Legeplads" (natblå flader, store farvede felter, boblefelt) med podninger fra "Instrumentbræt" og "Signal". `docs/design.md` er kontrakten. Fundamentet delte klienten i ét modul pr. fane bag en fast modulkontrakt (`mount`, `show`, `hide`, `on…`), så Live, Opstart og Disk kan skrives om parallelt uden at røre hinandens filer. Farverne er målt med `tools/palette-check.mjs` (alle 12 rollefarver mindst ΔE00 15 fra hinanden og 3:1 mod fladen), ikonerne genereres af `tools/icons.mjs`, og Log-fanen er færdig. `lib/boot.mjs` beholder nu hver opstartsposts starttidspunkt (til tidslinjen) og giver hver opstart et `slower`-flag efter samme regel som posterne.

## Afslutning: UI-overhaul (2026-10-08)
Live, Opstart og Disk blev bygget parallelt efter fundamentet, kontrolleret pr. fane og rettet. Til sidst blev fanernes fælles ønsker samlet i de fælles filer: faste talformattere og fokus tilbage efter en handling i `ui.js` (`run`), `chip()` med `label`, et canvas, der kun laver bufferen om ved ny størrelse, en kortere puls, og de gamle farvenavne er slettet. Fanernes lokale kopier af det (talformat i Live, `runHere` i Disk, `labeledChip` og `act` i Opstart) er fjernet. `docs/design.md` beskriver nu det, der er bygget, og README har et afsnit pr. fane. Live holder kravet på under 8 ms pr. tick i snit (målt 7,8 ms på en belastet maskine, 11 af 15 runder under 8 ms), men med lille margen (se design.md, Ydelse).

## Udvidelse: Engelsk (2026-10-31)
Hele appen findes på dansk og engelsk med en DA/EN-knap i topbjælken. Dansk er kilden: browserens tekster er `t('…')` med den danske tekst som nøgle i `public/en.js`, og en test fejler ved en manglende oversættelse eller forkerte pladsholdere. Serveren sender `{ da, en }` (`lib/text.mjs`) og kender ikke sproget, så logposter kan vises på begge sprog. Et sprogskift genindlæser siden, fordi talformatterne laves én gang ved start.

## Udvidelse: Ryd op (2026-10-30)
Fanen "Ryd op" flytter indholdet af kendte cache-mapper (`clean` i `kendt-bloat.json`) til papirkurven, valgt i en brainstorm: papirkurv frem for permanent sletning, egen fane, én række pr. program. `lib/clean.mjs` udfolder `%variabler%` og `*`, springer junctions og låste stier over, måler med Disk-scanneren og kalder `ps/recycle.ps1` pr. mappe. Scriptet tager nu en liste og afviser også, når papirkurven ikke har plads, fordi Windows ellers sletter de ældste ting i den permanent. Det gælder også Disk-fanen. Spec og plan: `docs/superpowers/`.
