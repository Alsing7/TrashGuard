Status: v5 (UI-overhaul "Legeplads" færdig) · 2026-10-08 · verificeret mod koden. UI'ens regler og beslutninger står i docs/design.md

Vibecoding er fedt!!

# TrashGuard

Lokalt dashboard, der finder CPU-, RAM- og GPU-slugere og baggrunds-bloat, viser hvad hver ting hænger sammen med (opstartspost, tjeneste, planlagt opgave, forældreproces), og slår det fra med ét klik, der kan fortrydes. Disk-fanen viser, hvad der fylder på dine drev, som kasser eller solstråle.

## Start

```
powershell -ExecutionPolicy Bypass -File lav-genvej.ps1
```

Det laver genvejen **TrashGuard** på skrivebordet med "Kør som administrator". Dobbeltklik, godkend UAC, og browseren åbner på `http://127.0.0.1:4319/`.

Den måler kun, mens en fane er åben. Når den sidste fane lukkes, lukker serveren efter `shutdownGraceMs` (config.json). Uden admin kan den se alt, men ikke ændre tjenester, opgaver eller opstartsposter for alle brugere.

## Topbjælken

Fanerne Live, Opstart, Disk og Log, status (Forbinder, Måler, Live, Ingen forbindelse) med en puls ved hvert tick, og Opdatér. Live-fanen viser den valgte linses tal. Opstart-fanen får et rødt mærke med antallet af døde poster (slået til, men filen findes ikke) og et orange mærke, når seneste opstart var langsommere end normalt.

## Live-fanen

- **Overskriften** har den valgte linses farve: det store tal (forbrug fra ting, du ikke selv har åbnet), "Bruger mest lige nu", en bjælke med baggrund, andet og i alt, og kurven over de seneste 5 minutter.
- **Spol tilbage:** hold musen over kurven, eller giv den fokus og brug piletasterne (Shift+pil springer 30 s, Escape går tilbage til nu). Boblefeltet viser så boblernes størrelse på det tidspunkt.
- **Boblefeltet:** arealet er forbruget lige nu, farven er kategorien. Fyldt er aktiv, ring er i hvile, stiplet ring er lukket. Højst 14 bobler pr. kategori plus en "+N"-boble. Et klik på en boble vælger den, et klik i forklaringen åbner kategorien. Feltet er til øjet; listen er den præcise og tastaturvenlige vej.
- **Listen:** de fire kategorier kan foldes sammen. Hver række har menneskenavnet (beskrivelsen) og exe-navnet, mærkerne Kendt bloat, Baggrund, Autostart (via X) og Lukket nu, og to tal: linsens tal og snittet (CPU, GPU) eller den private hukommelse (RAM).
- **Detaljen:** kategori, alle otte tal, sparkline, sti og signatur, årsagskæden (kilde, forældre, proces; forældre kan klikkes), Kendt bloat-tekst, Afslut med bekræftelse, kontakter for opstartspost og opgave, tjenestens opstartstype og Stol på / Fjern tillid. Escape og X lukker. Fra 1180 px bredde står detaljen som en tredje kolonne ved siden af listen; smallere tager den listens plads med en tilbage-knap.

## Fire linser

Linsefanerne øverst på Live (CPU, RAM, GPU, VRAM) styrer det store tal, kurven, boblerne og rækkefølgen i listen. Hver linsefane viser sit tal, en lille kurve og hvad der bruger mest lige nu. Den valgte linse huskes i browseren. Detaljepanelet viser altid alle fire.

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
| Tjeneste | Segmentkontrollen **Automatisk / Manuel / Deaktiveret**. Manuel stopper den (bekræftes fra Automatisk), Deaktiveret bekræftes altid, og en Manuel tjeneste, der kører, har en **Stop**-knap | Tidligere opstartstype, og den startes igen, hvis den kørte |
| Deaktiveret tjeneste | **Manuel** eller **Automatisk** i samme kontrol, ét klik. Automatisk starter den også | Tilbage til Deaktiveret |

Deaktiverede tjenester står øverst i tjenestelisten og vises altid, også når "Vis Windows' egne" er slået fra. Det gælder uanset hvem der har deaktiveret dem.

Alt logges i `data/handlinger.json`. Fortryd bygges fra den gemte tidligere tilstand og slår målet op igen. Loggen indeholder aldrig kommandoer.

Låst: processer og tjenester på `protectedProcesses`/`protectedServices`, samt tjenester med opstartstype Boot/System. En låst tjeneste kan ikke slås fra, men den kan aktiveres igen, hvis noget andet har deaktiveret den.

## Opstart-fanen

Øverst står *Seneste opstart* og *Tidligere*. Data kommer fra Windows' eventlog via `ps/boot.ps1` ved start og på "Opdatér". Scriptet læser eventfelter og ikke beskedtekst, så Windows' sprog er ligegyldigt. Det kræver ikke administrator.

- **Seneste opstart:** den samlede tid, en chip med afvigelsen fra normalt (orange, når opstarten var langsommere), starttype og dato. Starttypen kommer fra Kernel-Boot 27: kold start, hurtig start eller fra dvale.
- **Tidslinje:** faserne Windows og Skrivebord og derefter opstartsposterne i den rækkefølge, Windows startede dem, hver så bred som sin tid. En stiplet streg viser den normale samlede tid, og tre mærker viser logget ind, posterne begynder og færdige, alt regnet fra tænd.
- **Tid pr. opstartspost:** Explorer starter Run-nøglerne én ad gangen og logger start (Shell-Core 9707) og slut (9708). Posterne står værst først med en bjælke, en hvid streg ved normalen og en kontakt. *Normalt* er medianen af de andre opstarter.
- **Mærker:** "30 s" i rødt betyder *Windows ventede maks.*: tiden er mindst `boot.explorerWaitSeconds`. En ratio-chip som "6,1×" betyder *Langsommere end normalt*: mindst `boot.slowerFactor` gange normalen og mindst `boot.slowerMinSeconds` sekunder over. Den fulde tekst står, når man holder musen over. Hvad der er langsommere, regnes ét sted, i `lib/boot.mjs`.
- **Slå fra:** Explorer logger kun teksten efter sidste backslash i Run-værdien. Den matches mod opstartsposterne, og kontakten er den samme handling som i listen nedenunder.
- **Fejlede tjenester:** Service Control Manager 7000, 7009, 7011, 7022 og 7023 inden for `boot.failedServiceWindowSeconds` efter tænd, som røde chips.
- **Hurtig start:** er den slået til, og ligger sidste rigtige genstart mindst en dag tilbage, står det som én linje. Så genstarter "Luk computeren" ikke kernen og driverne.
- **Tidligere:** et søjlediagram over de seneste `boot.sessions` opstarter. Hver søjle er en knap, der viser den opstart i kortet. Shell-Core-loggen ruller, så de ældste kan stå uden tider.
- **Opstartsposter, planlagte opgaver og tjenester** ligger bag en vælger med antal og prikker: en okker prik tæller kendt bloat, en rød tæller døde poster. "Vis Windows' egne" viser også Microsofts egne; er den slået fra, siger et rødt mærke ved den, hvor mange døde poster filteret skjuler. Under navnet står filnavnet og kilden; hele stien står, når man holder musen over. Tjenesterne har segmentkontrollen fra *Handlinger*.

## Disk-fanen

Vælg et drev (hvert drev har en ring, der bliver rød over 90 % fyldt) eller skriv en mappe. Scanningen kører parallelt (`disk.concurrency` mapper ad gangen), og kortet tegnes undervejs. Junctions og symlinks følges ikke, og hardlinks tælles én gang. Størrelser er filernes egen størrelse, ikke pladsen på disken.

- **Låste filer:** filer, som Windows holder låst (`hiberfil.sys`, `pagefile.sys`, registreringsdatabasens filer), kan Node ikke åbne. Deres størrelse slås op bagefter i mappeoversigten via `ps/sizes.ps1`, så de tæller med.
- **Gendannelsespunkter:** på et drevs rod hentes pladsen til skyggekopier (kræver administrator). Den vises som kassen *Gendannelsespunkter* i `System Volume Information`, som ingen må åbne.
- **Statuslinjen** viser for drev "X fundet af Y brugt" og kan foldes ud. Den viser de mapper, der ikke kunne læses (højst 25), og antallet af filer uden størrelse. Resten er NTFS' egne data og afrunding til hele klynger.

- **Samling:** filer og mapper under `disk.minItemMb` samles til "Små filer" i deres mappe. I visningen samles ting under `disk.minFraction` af udsnittet til "Andet".
- **Gemt:** seneste scanning pr. rod ligger i `data/disk/` (`index.json` plus én fil pr. rod), så den åbner med det samme. "Scan igen" i detaljen genscanner kun den mappe, og "Scan hele drevet igen" i statuslinjen hele roden.
- **Visninger:** *Kasser* viser 3 niveauer som kasser i kasser, *Solstråle* viser 4 ringe. Klik på en mappe for at gå ind. Backspace, brødkrummerne eller midten af solstrålen går op. Valget huskes i browseren.
- **Etiketter:** store blade får navn og størrelse med stor skrift, og solstrålen skriver navnene langs buen i de 2 inderste ringe. Et navn vises helt eller med mindst 6 tegn før "…".
- **Farver:** okker = kendt skrald (`folders` i `kendt-bloat.json`; et mønster med `\` matcher stiens slutning, ellers mappens navn). Skravering på skifer = låst. Mapper som `Users` og din profil, der kun er låst selv, mens indholdet må ryddes, skraveres ikke. Resten har én tone pr. mappe øverst i udsnittet (indigo, blå, lilla, petrol, blomme), og en mappe, hvis indhold vises, er en mørkere ramme om det. Legenden siger Kendt skrald, Låst og Alt andet.
- **Største indhold:** listen ved siden af kortet viser de 12 største og en "Vis alle N"-knap, når der er flere. Det er tastaturvejen til alt i udsnittet.
- **Papirkurv** (to klik): TrashGuard måler tingen igen og beder derefter `ps/recycle.ps1` flytte den. Scriptet nægter, hvis papirkurven er slået fra på drevet, hvis tingen er større end papirkurvens maksimum (`CapacityMargin` i scriptet), eller hvis det, der allerede ligger i papirkurven, plus det nye ikke kan være der. I de tilfælde ville Windows nemlig slette permanent: tingen selv eller de ældste ting i papirkurven. Windows' egen advarsel om permanent sletning er slået til som sidste sikring. Handlingen logges og gendannes fra Windows' papirkurv.
- **Låst** (`disk.lockedTrees`, `disk.lockedExact`, `disk.lockedRootFolders`): drevrødder, filer direkte i en drevrod, Windows og Program Files med alt indhold, samt mapper som `Users`, din profil, `AppData`, `Desktop`, `Documents` og `Downloads` selv. Indholdet i de sidste må gerne ryddes.
- **Åbn i Stifinder** åbner mappen med tingen markeret. Explorer starter som din almindelige bruger.
- **Hvorfor mangler der noget?** er en chip i statuslinjen, der folder forklaringen ud.

## Ryd op-fanen

Kendte caches (`clean` i `kendt-bloat.json`) med størrelse. Vælg dem, der skal ryddes, og tryk **Papirkurv** to gange. Indholdet i mapperne flyttes til papirkurven; selve mapperne bliver stående. Fanen måler første gang, den vises, og igen på "Mål igen".

- **Listen:** én række pr. program med `name`, `text` og `paths`. Stierne må bruge `%miljøvariabler%`, og `*` matcher ét stiled (fx alle browserprofiler). Rækker uden en eksisterende mappe vises ikke. Junctions og symlinks følges ikke, og låste stier (se Disk) springes over.
- **Filer i brug** (fx Chromes cache, mens Chrome kører) springes over og tælles i svaret. Resten flyttes.
- **Samme sikring som Disk:** `ps/recycle.ps1` med kapacitetstjek og tjek af papirkurvens fyld. Afviser den, stopper oprydningen.
- Windows' egen Temp ryddes ikke, fordi Windows-mappen er låst.

## Log-fanen

Alle handlinger grupperet pr. dag (I dag, I går, ellers ugedag og dato), nyeste først. Hver post er én række med ikon, tekst, klokkeslæt og Fortryd, når handlingen kan fortrydes.

## Sprog

TrashGuard findes på dansk og engelsk. Knappen ved siden af Opdatér skifter (DA/EN), og valget huskes i browseren. Første gang vælges sproget efter browserens sprog. Et skift genindlæser siden, så tal og datoer også følger med (1,5 % mod 1.5 %).

- **Browseren:** dansk er kilden. Teksterne står som `t('Vælg alle')` i koden, og `public/en.js` oversætter dem. `node --test` fejler, hvis en tekst mangler en oversættelse.
- **Serveren** kender ikke sproget. Den sender sine tekster (fejl, beskeder, logposter) som `{ da, en }`, og browseren vælger. Logposter fra før sprogene står kun på dansk.
- **`kendt-bloat.json`:** forklaringer og Ryd op-navne er `{ "da": "…", "en": "…" }`. Et navn, der er ens på begge sprog (fx "Chrome"), kan være en almindelig streng.

## Sikkerhed

Serveren kører som administrator, så den lytter kun på `127.0.0.1`. Den afviser forkert `Host` (DNS-rebinding) og fremmed `Origin`, og handlinger kræver et token, der laves ved hver opstart.

## Filer

- `server.mjs`: HTTP, SSE og livscyklus
- `lib/disk.mjs`: scanner, træ, låse- og skraldregler og visningsudsnit. `lib/disk-service.mjs`: Disk-fanens ruter, gemte scanninger og papirkurv. `lib/clean.mjs`: Ryd op-fanens liste og oprydning
- `ps/recycle.ps1`: flytter en liste til papirkurven efter tjek af kapacitet og fyld
- `ps/sizes.ps1`: størrelser på låste filer via mappeoversigten, plus pladsen til gendannelsespunkter
- `public/index.html`: skallen med topbjælke, sprogknap, bannere og fem tomme faner. `app.js`: strømmen fra serveren, den fælles tilstand, faneskift og topbjælken
- `public/`: ét modul pr. fane, hver med sin CSS: `live.js` (overskrift, linser, liste, detalje) + `field.js` (boblefeltet) + `live.css` (Live), `startup.js` + `startup.css` (Opstart), `disk.js` + `disk.css` (Disk), `clean.js` + `clean.css` (Ryd op), `log.js` + `log.css` (Log). Kontrakten mellem app.js og fanerne står i `docs/design.md`
- `public/i18n.js`: sprogvalg, `t()` og `tr()`. `public/en.js`: den engelske ordbog. `lib/text.mjs`: serverens `{ da, en }`
- `public/ui.js`: fælles hjælpere og kontroller (talformat, handlinger, bekræftelse, kontakt, chip, segment, tjenestekontrol, kurver). `public/style.css`: farver, grundstil og fælles komponenter. `public/icons.css`: Bootstrap Icons (MIT) som masker, genereret af `tools/icons.mjs`
- `tools/palette-check.mjs`: regner kontrast og CIEDE2000 ΔE for farverne i `style.css` og kortets flader i `disk.css`
- `docs/design.md`: designkontrakten for UI'en (farveroller, beslutninger, ydelse, modulkontrakt)
- `lib/`: `parse` (rene parsere), `sampler` (CPU, RAM, GPU og VRAM pr. program), `classify` (mærker og score), `inventory` (opstart, tjenester, opgaver), `actions` (handlinger og fortryd), `guard` (sikkerhedstjek)
- `ps/sampler.ps1`: løkken, der måler (kun ASCII, fordi PowerShell 5.1 læser UTF-8 uden BOM forkert)
- `ps/inventory.ps1`: læser opstartsposter, tjenester og opgaver
- `ps/boot.ps1`: læser de seneste opstarter fra eventloggen. `lib/boot.mjs` opsummerer dem
- `kendt-bloat.json`: redigér frit. Nøgler under `exe` matcher filnavnet, under `service` tjenestenavnet, og under `task` en del af opgavens sti og navn. `folders` farver kendt skrald i Disk, og `clean` er Ryd op-fanens liste
- `test/`: `core`, `disk` og `boot` til `node --test`
- `docs/plan.md`: implementeringsplanen

## Test

```
node --test
```
