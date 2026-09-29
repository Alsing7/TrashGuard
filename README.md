Status: v3 (Disk) · 2026-09-27 · verificeret mod koden

Vibecoding er fedt!!

# TrashGuard

Lokalt dashboard, der finder CPU-, RAM- og GPU-slugere og baggrunds-bloat, viser hvad hver ting hænger sammen med (opstartspost, tjeneste, planlagt opgave, forældreproces), og slår det fra med ét klik, der kan fortrydes. Disk-fanen viser, hvad der fylder på dine drev, som kasser eller solstråle.

## Start

```
powershell -ExecutionPolicy Bypass -File lav-genvej.ps1
```

Det laver genvejen **TrashGuard** på skrivebordet med "Kør som administrator". Dobbeltklik, godkend UAC, og browseren åbner på `http://127.0.0.1:4319/`.

Den måler kun, mens en fane er åben. Når den sidste fane lukkes, lukker serveren efter `shutdownGraceMs` (config.json). Uden admin kan den se alt, men ikke ændre tjenester, opgaver eller opstartsposter for alle brugere.

## Fire linser

Omskifteren øverst (CPU, RAM, GPU, VRAM) styrer det store tal, kurven og rækkefølgen af syndere. Hver linse viser et live-tal. Den valgte linse huskes i browseren. Detaljepanelet viser altid alle fire.

| Linse | Tal | Rangeres efter | Måles |
|---|---|---|---|
| CPU | % af hele CPU'en | snit i sessionen | hvert tick (`sampleIntervalMs`) |
| RAM | working set (privat hukommelse i anden kolonne) | nu | hvert tick |
| GPU | processens travleste GPU-motor, som i Jobliste | snit i sessionen | hvert `gpuEveryTicks`. tick; værdien holdes imellem, så det er et øjebliksbillede, ikke et gennemsnit |
| VRAM | lokal brug (det, der ligger i VRAM) | nu | hvert tick |

VRAM bruger Windows' tæller for *lokal brug*, fordi tælleren for *dedikeret brug* pr. proces kan vise mere end kortet har. Den er desuden loftet af kortets samlede forbrug.

## Sådan bedømmer den

| Kategori | Hvornår |
|---|---|
| Syndere | Kendt bloat, eller startet af noget andet end dig (autostart eller baggrund) |
| Dine programmer | Har et vindue, eller er startet af et program med vindue eller fra Stifinder |
| Du stoler på | Du har trykket "Stol på" (gemt i `data/stol-paa.json`), eller det er TrashGuard selv |
| Windows selv | Windows-fil signeret af Microsoft, en proces på `protectedProcesses`, eller en proces hvis sti Windows skjuler. Bliver kun synder med mærket Baggrund |

**Baggrund** betyder intet vindue og mindst én ressource over sin tærskel i `backgroundThresholds`: CPU-snit, RAM, GPU-snit eller VRAM. Mærket siger hvilke, fx *Baggrund: RAM, VRAM*.

Score pr. linse = linsens tal (CPU/GPU-snit i %, RAM/VRAM i MB) × vægtene i `config.json` (`weights`) for de mærker, den har. Kun syndere får en score.

## Handlinger

| Ting | Slå fra | Fortryd |
|---|---|---|
| Proces | `taskkill /F /T` | Kan ikke fortrydes |
| Opstartspost | `StartupApproved`, samme bytes som Jobliste | Den tidligere værdi skrives tilbage |
| Planlagt opgave | `schtasks /Change /DISABLE` | `/ENABLE` |
| Tjeneste | Stop og sæt til Manuel (Deaktiveret bag ekstra klik) | Tidligere opstartstype, og den startes igen, hvis den kørte |
| Deaktiveret tjeneste | **Aktivér (Manuel)** eller **Aktivér (Automatisk)**, ét klik. Automatisk starter den også | Tilbage til Deaktiveret |

Deaktiverede tjenester står øverst i tjenestetabellen og vises altid, også når "Vis Windows' egne" er slået fra. Det gælder uanset hvem der har deaktiveret dem.

Alt logges i `data/handlinger.json`. Fortryd bygges fra den gemte tidligere tilstand og slår målet op igen. Loggen indeholder aldrig kommandoer.

Låst: processer og tjenester på `protectedProcesses`/`protectedServices`, samt tjenester med opstartstype Boot/System. En låst tjeneste kan ikke slås fra, men den kan aktiveres igen, hvis noget andet har deaktiveret den.

## Disk-fanen

Vælg et drev eller skriv en mappe. Scanningen kører parallelt (`disk.concurrency` mapper ad gangen), og kortet tegnes undervejs. Junctions og symlinks følges ikke, og hardlinks tælles én gang. Størrelser er filernes egen størrelse, ikke pladsen på disken.

- **Låste filer:** filer, som Windows holder låst (`hiberfil.sys`, `pagefile.sys`, registreringsdatabasens filer), kan Node ikke åbne. Deres størrelse slås op bagefter i mappeoversigten via `ps/sizes.ps1`, så de tæller med.
- **Gendannelsespunkter:** på et drevs rod hentes pladsen til skyggekopier (kræver administrator). Den vises som kassen *Gendannelsespunkter* i `System Volume Information`, som ingen må åbne.
- **Statuslinjen** viser for drev "X fundet af Y brugt" og kan foldes ud. Den viser de mapper, der ikke kunne læses (højst 25), og antallet af filer uden størrelse. Resten er NTFS' egne data og afrunding til hele klynger.

- **Samling:** filer og mapper under `disk.minItemMb` samles til "Små filer" i deres mappe. I visningen samles ting under `disk.minFraction` af udsnittet til "Andet".
- **Gemt:** seneste scanning pr. rod ligger i `data/disk/` (`index.json` plus én fil pr. rod), så den åbner med det samme. "Scan denne mappe igen" genscanner kun den mappe.
- **Visninger:** *Kasser* viser 3 niveauer som kasser i kasser, *Solstråle* viser 4 ringe. Klik på en mappe for at gå ind. Backspace eller midten af solstrålen går et niveau op. Valget huskes i browseren.
- **Farver:** rav = kendt skrald (`folders` i `kendt-bloat.json`; et mønster med `\` matcher stiens slutning, ellers mappens navn). Stålblå = låst. Resten er neutral.
- **Flyt til papirkurv** (to klik): TrashGuard måler tingen igen og beder derefter `ps/recycle.ps1` flytte den. Scriptet nægter, hvis papirkurven er slået fra på drevet, eller hvis tingen er større end papirkurvens maksimum (`CapacityMargin` i scriptet). I de tilfælde ville Windows nemlig slette permanent. Windows' egen advarsel om permanent sletning er slået til som sidste sikring. Handlingen logges og gendannes fra Windows' papirkurv.
- **Låst** (`disk.lockedTrees`, `disk.lockedExact`, `disk.lockedRootFolders`): drevrødder, filer direkte i en drevrod, Windows og Program Files med alt indhold, samt mapper som `Users`, din profil, `AppData`, `Desktop`, `Documents` og `Downloads` selv. Indholdet i de sidste må gerne ryddes.
- **Åbn i Stifinder** åbner mappen med tingen markeret. Explorer starter som din almindelige bruger.

## Sikkerhed

Serveren kører som administrator, så den lytter kun på `127.0.0.1`. Den afviser forkert `Host` (DNS-rebinding) og fremmed `Origin`, og handlinger kræver et token, der laves ved hver opstart.

## Filer

- `server.mjs`: HTTP, SSE og livscyklus
- `lib/disk.mjs`: scanner, træ, låse- og skraldregler og visningsudsnit. `lib/disk-service.mjs`: Disk-fanens ruter, gemte scanninger og papirkurv
- `ps/recycle.ps1`: flytter til papirkurven efter kapacitetstjek
- `ps/sizes.ps1`: størrelser på låste filer via mappeoversigten, plus pladsen til gendannelsespunkter
- `public/`: `app.js` (Live, Opstart, Log), `disk.js` (Disk-fanen), `ui.js` (fælles hjælpere)
- `lib/`: `parse` (rene parsere), `sampler` (CPU, RAM, GPU og VRAM pr. program), `classify` (mærker og score), `inventory` (opstart, tjenester, opgaver), `actions` (handlinger og fortryd), `guard` (sikkerhedstjek)
- `ps/sampler.ps1`: løkken, der måler (kun ASCII, fordi PowerShell 5.1 læser UTF-8 uden BOM forkert)
- `ps/inventory.ps1`: læser opstartsposter, tjenester og opgaver
- `kendt-bloat.json`: redigér frit. Nøgler under `exe` matcher filnavnet, under `service` tjenestenavnet, og under `task` en del af opgavens sti og navn
- `docs/plan.md`: implementeringsplanen

## Test

```
node --test
```
