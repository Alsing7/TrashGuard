Status: kontrakt for UI-overhaulen v5 (Legeplads), færdig · 2026-10-08 · verificeret mod koden (farver, beslutninger for alle fire faner, ydelse, filer, modulkontrakt, ui.js, komponenter)

# TrashGuard: designkontrakt (Legeplads med podninger)

Denne fil er den ene sandhed for UI'en. Brugeren valgte retningen "Legeplads" med podninger fra "Instrumentbræt" og "Signal" (designkonkurrence 2026-10-07). Når kode og denne fil er uenige, er det en fejl, og den rettes i samme omgang.

## Kilder

- Visuel reference: mockuppen i `C:\Users\Teddy\AppData\Local\Temp\claude\C--Users-Teddy-Desktop-Test-server\8875ebdf-1229-4c5e-92e8-ed7d40fd3ebc\scratchpad\design\legeplads\` (`spec.md`, `style.css`, `mock.js`, `index.html`, `shot-*.png`). Tag stil, mål og komponenter derfra, men ret de fejl, der står nedenfor.
- Podninger: `...\design\instrument\` (spec.md, mock.js) og `...\design\signal\` (spec.md, mock.js, make-icons.cjs).
- Brugerens brief: "mere vibrant og generelt pænere UI hele vejen rundt. Menneskevenligt, minimalistisk, give så meget information som muligt, med så lidt tekst som muligt, moderne og være næsten sjovt at bruge, til at holde øje med sin PC."

## Faste regler

- Al tekst på dansk med rigtige æ, ø og å. Sætningsbogstaver. Ingen versaler som etiketter.
- Ingen emoji. Ikoner er Bootstrap Icons (MIT) som base64 data-URI-masker i `.bi`-mønstret. Stierne hentes fra de officielle SVG'er og genereres af `tools/icons.mjs` til `public/icons.css`.
- Fladt: ingen `linear-gradient` eller `radial-gradient`. `conic-gradient` kun til et datadrevet ring- eller cirkeldiagram. Ingen farvede accentstriber på kanter (fx `border-left: 3px solid farve`). Ingen blur, ingen `backdrop-filter`, ingen dekorative skygger. Modal-baggrunde dæmpes kun let.
- Kun lokale skrifttyper med fallback. Display: `"Futura XBlk BT", "Futura Extra Black", Bahnschrift, "Segoe UI", sans-serif`. Data: `Bahnschrift, "Segoe UI Variable Text", "Segoe UI", sans-serif`. Brødtekst: `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`. Tal altid med `tabular-nums`.
- CSP er `default-src 'self'`: ingen inline `<style>`, `<script>` eller `style`-attributter i markup eller i HTML-strenge. Dynamiske mål sættes med `element.style` eller `style.setProperty` fra JS. Nye filer skal på `STATIC_FILES` i `server.mjs`.
- Ingen eksterne biblioteker. Vanilla JS-moduler.
- Mindste skriftstørrelse 11 px. Kontrast mindst AA for tekst (4,5:1) og 3:1 for kontroller og grafiske markører, der bærer betydning.
- Tastatur: alle handlinger kan nås og udføres med tastaturet. Synlig fokusring (2 px i tekstfarve). Rækker og klikbare flader er rigtige `button`-elementer eller har `role="button"` og reagerer på Enter og mellemrum. Klikmål mindst 24×24 px (et usynligt klikområde tæller).
- `prefers-reduced-motion: reduce` slår al bevægelse fra.
- Ingen vandret scroll ned til 390 px bredde, på alle faner.
- Ingen funktion må forsvinde. Se funktionslisten nederst.

## Farveroller

Én farve betyder én ting i hele appen. Grundtonerne er Legeplads': natblå flader og lys tekst. Hex-værdierne står på `:root` øverst i `public/style.css` (kortets flader på `:root` øverst i `public/disk.css`), og `node tools/palette-check.mjs` læser dem derfra og regner kontrast (WCAG) og CIEDE2000 ΔE. Scriptet afslutter med fejl, hvis et krav ikke holder. Kør det efter hver farveændring, og ret tabellen her i samme omgang.

Krav: alle 12 rollefarver kan stå på samme skærm (topbjælkens mærker er der altid, og Live viser både ressourcer og kategorier), så hvert af de 66 par skal have ΔE00 ≥ 15. Hver rollefarve skal have mindst 3:1 mod `--panel`, og blæk på farven mindst 4,5:1, fordi farvede flader bærer blæktekst.

| Rolle | Token | Hex | Mod `--panel` | Blæk på farven | Bruges til |
|---|---|---|---|---|---|
| Bund | `--ground` | `#1d1a4e` | | | Sidens bund, felter inde i paneler |
| Flade | `--panel` | `#29256a` | | | Paneler, faneskinne, bannere |
| Hævet | `--raised` | `#352f84` | | | Hover, standardknap |
| Linje | `--line` | `#4a43a0` | | | Slukket kontakt, inputkant, skillelinjer |
| Tekst | `--text` | `#f6f4ff` | 12,3:1 | | Tekst, valgt fane og primærknap (hvid flade med blæktekst) |
| Dæmpet tekst | `--muted` | `#b3ace6` | 6,4:1 | | Sekundær tekst |
| Blæk | `--ink` | `#1d1a4e` | | | Tekst på alle lyse og farvede flader |
| Ressource CPU | `--res-cpu` | `#ffd447` | 9,4:1 | 11,3:1 | Linsefanerne, overskriftsfladen (den valgte linses farve), kurver, detaljens fire ressourcefelter, "Bruger mest lige nu" |
| Ressource RAM | `--res-ram` | `#5ce1e6` | 8,5:1 | 10,2:1 | Som CPU |
| Ressource GPU | `--res-gpu` | `#ff8fd8` | 6,5:1 | 7,8:1 | Som CPU |
| Ressource VRAM | `--res-vram` | `#c3f25c` | 10,3:1 | 12,3:1 | Som CPU |
| Kategori Syndere | `--cat-suspect` | `#ff7a45` | 5,2:1 | 6,2:1 | Bobler, sektionsprikker, kategorichip i detaljen |
| Kategori Dine programmer | `--cat-yours` | `#4aa8ff` | 5,3:1 | 6,4:1 | Som Syndere |
| Kategori Du stoler på | `--cat-trusted` | `#b8a1ff` | 6,1:1 | 7,3:1 | Som Syndere |
| Kategori Windows selv | `--cat-windows` | `#9aa0ad` | 5,1:1 | 6,1:1 | Som Syndere. Rolig grå, fordi den er den mindst interessante |
| Kendt skrald | `--junk` | `#bca476` | 5,6:1 | 6,6:1 | Mærket Kendt bloat (opstart, opgaver, tjenester, processer) og kendt skrald på disken. Det er samme begreb |
| Fare | `--danger` | `#ff5f86` | 4,6:1 | 5,5:1 | Afslut, Deaktivér, Papirkurv, bevæbnet bekræftelse, fejlede tjenester, døde opstartsposter, Windows ventede maks., fejl-toast |
| Langsommere | `--slow` | `#ffa53d` | 6,8:1 | 8,2:1 | Afvigelse på opstartstider og mærket på Opstart-fanen. Egen farve, ikke delt med `--cat-suspect` eller `--danger` |
| Succes, slået til, kører | `--ok` | `#3fe0a0` | 7,9:1 | 9,5:1 | Kontakt slået til, "kører nu", Live-prikken, succes-toast |

Tekst i en farve (alle mindst 4,5:1, og scriptet tjekker hvert par): `--text` på `--ground` 14,7, på `--raised` 10,2. `--muted` på `--ground` 7,6, på `--raised` 5,3. Blæk på `--text` 14,7. På `--ground`: `--danger` 5,5, `--ok` 9,5, `--junk` 6,6, `--slow` 8,2. På `--panel`: `--danger` 4,6, `--ok` 7,9, `--junk` 5,6, `--slow` 6,8. `--junk` på `--raised` 4,6 (Kendt bloat på en valgt række). `--danger` står aldrig som tekst på `--raised` (3,8:1) eller på en tonet fare-flade. Derfor fylder `.button-danger` sig med fare og blæktekst ved hover.

Kortets flader i `disk.css` bærer etiketter i `--text`, og disk.js tegner alle etiketter på kortet i `--text` (også "Små filer", "Andet" og størrelsen midt i solstrålen). `--tile-0` til `--tile-4` er én tone pr. mappe øverst i udsnittet (indigo `#6455da` 5,0, blå `#3366cc` 4,9, lilla `#8a4dd6` 4,7, petrol `#177684` 4,9, blomme `#a8429b` 4,9). disk.js giver mapperne tonerne på skift (`TILE_TOKENS`, indeks modulo 5) og gør en mappe 12 % mørkere (`LEVEL_SHADE`) for hvert niveau, der er tegnet inde i den. Det kan kun hæve kontrasten. Desuden `--tile-dim` 10,5, `--junk-fill` (`#846a39`) 4,7, `--junk-soft` (`#635336`) 6,8 og `--locked-fill` 8,6. `--muted` står ikke på kortet.

Mindste ΔE00 er 16,1 (`--cat-trusted` og `--cat-windows`). De næste: `--res-gpu` og `--danger` 16,5, `--junk` og `--slow` 16,8, `--cat-suspect` og `--slow` 16,9, `--res-cpu` og `--slow` 17,3.

Ingen farve har to roller. Legeplads' sol havde fem betydninger; nu er sol kun CPU's ressourcefarve, og Dine programmer er blå, så mynte kun betyder "slået til".

Komponenter farves med `data-res="cpu|ram|gpu|vram"` eller `data-cat="suspect|yours|trusted|windows"`, som sætter `--c` (fx `.chip-fill`, `.tab-pill`). `--tile-*`, `--junk-fill`, `--junk-soft` og `--locked-fill` står i `disk.css`, fordi disk.js læser dem. De gamle navne fra før overhaulen (`--base`, `--surface`, `--signal` og flere) er slettet; intet bruger dem.

## Beslutninger

### Hele appen

- Én topbjælke: logo, faner som pilleskinne (Live, Opstart, Disk, Log), status-prik og en rund Opdatér-ikonknap. Fanerne står altid på én linje: er der ikke plads, forkortes statusteksten med "…", og under 720 px får fanerne deres egen linje. Live-fanen viser den valgte linses tal, også på smal skærm (mindre pille, og fanerne deler bredden efter indholdet). Opstart-fanen viser et faremærke med antallet af døde opstartsposter (kun når det er over 0) og et `--slow`-mærke, når seneste opstart var langsommere end normalt.
- Admin- og problembanneret er korte piller med ikon (Legeplads' tekst).
- Toast: hvid pille med rundt ikon. `confirmButton` får et valgfrit ikon og en lunte: en 3 px streg i knappen, der løber ned over de 4 sekunder, bekræftelsen varer. Det er bevægelse som svar på en handling, og den slås fra ved reduced motion.
- Kontakter (`role="switch"`) viser serverens tilstand. De skifter først, når inventory-eventet kommer, ikke ved klik. Mens kaldet kører, er kontakten deaktiveret.
- Menneskenavnet først overalt (fra Signal): beskrivelsen (`desc`), hvis den findes, ellers exe-navnet. Exe-navnet står efter i dæmpet tekst.

### Live

- Overskriften er Legeplads' flade, men i den valgte linses ressourcefarve, og lavere end mockuppens ca. 270 px. Linsefanerne viser hver sin ressources tal, mikrokurve og "Bruger mest lige nu": navnet på den gruppe, der bruger mest af den ressource lige nu, på tværs af alle kategorier (fra Instrumentbræt). Det patches, ikke genopbygges. Overskriftstallet tæller hen til det nye tal i `TWEEN_STEPS` (5) trin over `TWEEN_MS` (400 ms), et trin pr. billede, der alligevel tegnes; ikke ved reduced motion.
- Spol tilbage (fra Signal): når man holder musen over eller trækker hen over 5-minutters-kurven, vises en lodret markør med tidspunkt ("for 40 s siden"), og boblefeltet viser boblernes størrelse på det tidspunkt ud fra `state.history`. Når musen forlader kurven, vender feltet tilbage til nu. Med tastaturet: kurven er fokuserbar (`role="slider"`), pil venstre og højre flytter markøren ét punkt (2 s), Shift+pil og Page Up/Down 15 punkter (30 s), og Escape går tilbage til nu. Historikken er justeret fra enden (nyeste punkt sidst), og grupper med kortere historik har ingen boble på ældre tidspunkter.
- Boblefeltet: areal er forbruget lige nu i linsen, farven er kategorien. Fyldt betyder aktiv, ring betyder i hvile, og stiplet ring betyder lukket. Feltet er dekoration for øjet, og listen er den præcise og tastaturvenlige vej: boblerne er `span` med `role="button"` uden tabindex, forklaringens knapper har `tabindex="-1"`, så intet i feltet er i tab-rækkefølgen. Et klik på en boble vælger gruppen og flytter ingen bobler; et klik i forklaringen eller på "+N" åbner kategorien i listen.
- Hvem der får en boble (`field.js`, `FIELD`):
  - Højst 14 bobler pr. kategori (`perSection`) plus en "+N"-boble. Den valgte gruppe er altid med. Der er ingen grænse for ringe: en grænse skiftede bobler ud, hver gang en boble skiftede mellem ring og skive.
  - Udvalget følger det jævne forbrug, linsens `rankBy` (CPU `avg`, GPU `gpuAvg`, RAM `ram`, VRAM `vram`). En boble, der står i feltet, rangeres med `stayFactor` (2) gange sit forbrug plus linsens `idle`, så den bliver stående, til en anden bruger dobbelt så meget.
  - Arealet er forbruget nu. En hvilende boble vågner først over `idle` × `wakeFactor` (3), så forbrug omkring grænsen ikke blinker mellem ring og skive.
  - Kendt bloat-mærket står kun på fyldte bobler, ikke på ringe.
- Ydelse i feltet: kun `transform` og `opacity` animeres, i `--move` (300 ms) efter hvert tick, og der kører ingen løkke mellem ticks. Skift mellem ring og skive sker uden fade. Bobleknuderne har fast størrelse og form og skaleres med `transform`, så tick-opdateringer ikke udløser layout. Layoutet relaxeres fra de forrige positioner i typede arrays; ved et tick viger den boble, der voksede, mens naboerne vejer `steadyMass` (8) gange mere. Flytninger under `moveMin` (2 px) tegnes ikke, flytninger under `glideMin` (6 px) springer uden overgang, og en radius tegnes først om, når den ændrer sig mindst `scaleMin` (20 %) og `growMin` (4 px). Skalaen står stille inden for `scaleSlack` (2,5). Tallet i boblen er altid det præcise. Et linseskift relaxerer grundigt (`iterations` 360 mod `tickIterations` 70).
- Små bobler får et usynligt klikområde på mindst 24 px. Tekst i bobler er mindst 11 px, ellers vises den ikke.
- Layout: fra 1180 px er der tre kolonner. Feltet står til venstre (sticky), listen fylder resten, og en valgt gruppes detalje er den tredje kolonne ved siden af listen. Fra 900 til 1179 px står feltet og listen side om side, og detaljen erstatter listen. Under 900 px er der én kolonne med feltet (380 px højt) over listen, og detaljen erstatter også her listen. Når detaljen erstatter listen, har den en tilbage-knap; tilbage, X og Escape lukker og giver fokus tilbage til rækken.
- Rækkerne har to linjer: menneskenavn og exe, og chips med ikon (Kendt bloat i `--junk`, Baggrund med "Baggrund:" til skærmlæsere, Autostart eller "via X" afkortet med "…", Lukket nu). "nu", "snit" og "privat" står én gang i sektionens titellinje. Under 720 px brydes exe-navnet ned på sin egen linje.
- Listen patches pr. tick: app.js skifter kun de ændrede grupper ud, og en række tegnes kun, når dens gruppeobjekt eller linsen er skiftet. Rangen er forbruget i hele `sortStep` og skifter først, når forbruget er et helt trin fra den forrige rang, så rækker ved en afrundingsgrænse ikke bytter plads ved hvert tick. Rækkerne flyttes med længste voksende delfølge (`placeRows`), så kun de nødvendige rækker flytter.
- Afslut, der lykkes, får boblen til at springe (Legeplads' `burst`).

### Opstart

- Seneste opstart: stor tid, afvigelse som chip ("+39 s"; i `--slow` med `graph-up-arrow` kun, når `session.slower`), starttype- og datochips.
- Tidslinjen: 2 faser (Windows og Skrivebord) og derefter posterne efter `startedAt`, i den rækkefølge Windows kørte dem, hver så bred som sin tid. Spændet er max(færdig, normal) × `TIMELINE_ROOM` (1,03). Sporet er 46 px højt (40 px ved højst 720 px). Den stiplede normal-streg starter 8 px over sporet og slutter ved sporets underkant, og bloknavnene ligger i et lag over den (z-index 2 mod 1) på blokkens egen farve. Et navn skjules, når feltet er højst 40 px bredt (container query); `title` og `aria-label` (`role="img"`) har altid hele teksten. 3 mærker i 2 rækker: logget ind, poster begynder og færdige.
- Hvad der er "langsommere", beregnes ét sted, i `lib/boot.mjs`, med `slowerFactor` og `slowerMinSeconds`. Fundamentet tilføjer et `slower`-flag pr. opstart med samme regel. Klienten regner det ikke selv ud.
- Posterne, værst først: bjælke med hvid streg ved normalen, tid og normal, ratio-chip ("6,1×") i stedet for teksten "Langsommere end normalt", og en "30 s"-chip i `--danger` for "Windows ventede maks.". Den fulde tekst står i `title` og `aria-label` (`chip()` med `label`). Under navnet står exe-filnavnet i dæmpet tekst, når det er forskelligt fra navnet; hele kommandoen står i `title`. Kontakten slår opstartsposten fra og til.
- Tidligere opstarter: et søjlediagram, hvor hver søjle er en knap (`aria-pressed`), der vælger opstarten. Mindste søjlehøjde er 6 % (`MIN_BAR_PERCENT`). Datoen vises altid; klokkeslættet (11 px) vises, når søjlen er mindst 32 px bred, og altid på søjler, der deler dato med en nabo (`.is-twin`). Kortet er 360 px bredt og sticky over 1100 px.
- Fejlede tjenester er fare-chips. Hurtig start-noten er én linje (`.callout` med `lightning-charge`), kun når hurtig start er slået til, og der er gået mindst 1 døgn siden sidste rigtige genstart. Forklaringen står i `title`.
- Opstartsposter, planlagte opgaver og tjenester ligger bag en segmentvælger (en `role="tablist"` med 3 rigtige `role="tab"`). Tallet er de viste rækker. `--junk`-prikken tæller kendt bloat. Fare-prikken tæller døde poster på fanens hele liste med topbjælkens regel (`orphan` og `enabled !== false` og `startMode !== 'Disabled'`), så summen er lig topbjælkens mærke. "Vis Windows' egne" bevares; er den slået fra, står et fare-mærke ved den med antallet af døde poster, filteret skjuler ("N døde poster er skjult"), kun når tallet er over 0.
- Listen har 3 subgrid-kolonner: navn (med mærker og en linje med filnavn · kilde; hele stien i `title`), tilstand og handling. Handlingen er venstrestillet, så tjenesternes segmenter står på én lodret linje. Ved højst 1100 px er der 2 kolonner: tilstanden står under navnet og handlingen til højre. Ved højst 720 px skjules kilden.
- Fanen patcher: `onTick` skifter kun "kører nu" i de rækker, hvis program er startet eller lukket. Fanernes tal og prikker skrives kun ved ændring, og listen, opstartskortet og søjlerne bygges kun om, når deres data ændrer sig. Serveren sender inventory-eventet, før handlingen svarer, så en ombygning sker, mens den trykkede knap er deaktiveret; fanen giver fokus tilbage til samme kontrol (`data-focus-key`), eller til rækkens første brugbare knap, når kontrollen nu er det valgte segment.
- Tjenester: en segmentkontrol `[Automatisk | Manuel | Deaktiveret]` viser opstartstypen, og et klik skifter til den. Serveren tillader alle tre fra enhver tilstand, undtagen låste tjenester, der kun må aktiveres fra Deaktiveret. Bekræftelse som i dag: Manuel bekræftes, når tjenesten er Automatisk eller kører, og Deaktiveret bekræftes altid. Aktivering er ét klik. Kører en Manuel tjeneste, vises en lille Stop-knap (handlingen `manual`). Boot/System-tjenester og låste tjenester viser en låsenote. Der må ikke være døde knapper: et segment, der ikke kan bruges, er deaktiveret med en `title`, der siger hvorfor.

### Disk

- Legeplads' kort med afrundede klodser og store navne i store blade (mindst 150 × 90 px). Låst tegnes som skravering (et canvas-mønster, ikke en gradient: 8 px mellem stregerne, streg 1,5 px, alfa 0,13) på en neutral flade, så det ikke ligner dit indhold (fra Instrumentbræt). Skraveringen gælder Windows- og programmappernes træer, Windows' egne mapper i drevroden og filer direkte i drevroden, ikke de mapper, der kun er låst selv, mens indholdet må ryddes (`needed`, fx `Users` og din profil). Kendt skrald i `--junk`. Resten har én tone pr. mappe øverst i udsnittet (se Farveroller).
- Alle etiketter på kortet tegnes i `--text`, så kontrasten holder. `tools/palette-check.mjs` måler `--text` på hver flade. En etiket vises med hele navnet eller mindst 6 tegn før "…" (`LABEL_MIN_CHARS`), og grupper ("N mindre ting", "Små filer") får aldrig den store etiket. Solstrålen skriver navnene langs buen i de 2 inderste ringe (`ARC_LABEL.levels`), vendt på den nederste halvdel. Kernen viser "C:\" ved en drevrod og siger kun "Klik for at gå et niveau op", når man kan gå op. Kasser viser 3 niveauer, solstrålen 4.
- Drev med datadrevet ring (`--danger` over 90 %), status som chips, brødkrummer med ikon, Kasser/Solstråle med ikoner. "Hvorfor mangler der noget?" er en `button` med `aria-expanded`, der står fast i chiprækken; forklaringen står på sin egen linje under den. Legenden: Kendt skrald, Låst (forklaringen i `title`) og Alt andet (tre toner); prøverne har en 2 px kant i `--muted`.
- Detaljepanelet: titel (`tabindex="-1"`), stor størrelse, knaprække med ikoner (Åbn i Stifinder, Kopiér sti, Scan igen, Papirkurv med bekræftelse), låsenote og "Største indhold" som knapper med en tynd andelsbjælke: 12 rækker (`LIST_LIMIT`) og en "Vis alle N"-knap, når der er flere. Udsnittet har op til 80 børn (`disk.maxChildren` i config.json).
- Tastatur og fokus: fokus bevares ved ombygning (`data-focus`). Backspace og brødkrummer sætter fokus på rækken, man kom fra; et klik ind i en mappe sætter det på første række. Detaljen bygges kun om, når dens indhold ændrer sig, så fokus og en bevæbnet Papirkurv overlever en scanning. Et svar fra en ældre sti kasseres (`fetchTicket`). Under scanning hentes udsnittet højst hvert 1500 ms.

### Log

- Grupperet pr. dag (I dag, I går, ellers ugedag og dato som "Fredag 2. oktober", med årstal bagest, når det er et andet år). Hver post er én række med ikoncirkel, tekst, klokkeslæt og Fortryd. Ikke en stak ens afrundede kort.

## Ydelse

- En skjult fane eller et skjult dokument laver intet arbejde: ingen DOM-ændringer, ingen canvas-tegning, ingen observers.
- Topbjælken skriver kun det, der er ændret. Pr. tick skifter kun pulsen (`data-beat`, en 250 ms CSS-animation), og Live-pillens tekst, når tallet ændrer sig.
- Pr. tick med Live synlig: patch kun det, der har ændret sig. Ingen `replaceChildren` på rækker, der ikke har ændret sig. Ingen layout-læsning (`clientWidth`, `getBoundingClientRect`, `getComputedStyle`) efter DOM-skrivning i samme løkke. Canvas-størrelser caches og opdateres via ResizeObserver, og `prepareCanvas` laver kun lærredets buffer om, når størrelsen ændrer sig. Tal formateres med faste `Intl.NumberFormat` i ui.js.
- Mål for Live med alle sektioner åbne: under 8 ms scripting og rendering pr. tick i snit, og ingen kørende animationsløkke mellem ticks. Mål det, før du siger, det er færdigt.
- Det er antallet af overgange, der starter, der koster stil (ca. 30-50 µs hver), ikke hvor længe de varer. Derfor starter feltet så få som muligt (se Live).
- Måling 2026-10-08 (harnessens `live\perfr-4350.cjs` på optagede data, 1440 px, Windows selv foldet ud, 227 rækker, CDP Script + Layout + RecalcStyle pr. tick over 40 s): CPU-linsen målte 7,1-8,1 ms i 14 af 15 runder og 9,6 ms i én runde under en belastningstop (median 7,7, snit 7,8; 11 af 15 under 8 ms). RAM-linsen målte 3,9-4,7 ms. Maskinen var belastet: samme side uden bevægelse målte 5,0-5,6 ms. Live-agenten målte omkring 6,25 ms i en rolig periode. Kravet holder i snit, men med lille margen under belastning. Pulsen er en sammensat (composited) animation, men koster stadig ca. 8 stilberegninger og 0,5 ms pr. tick (uden puls: 6,9 ms); 120, 250 og 420 ms varighed måler ens.
- Sektioner, der er foldet sammen, har ingen rækker i DOM.

## Filer og ejerskab

Overhaulen er færdig, og ejerskabet nedenfor beskriver, hvem der byggede hvad, og hvilken fil der har hvilket ansvar. En ændring i en fælles fil (style.css, ui.js, app.js) gælder alle faner.

| Fil | Ejer | Indhold |
|---|---|---|
| `public/index.html` | Fundament | Skallen: topbjælke, bannere, toast og fire tomme `section.panel` (`#tab-live`, `#tab-startup`, `#tab-disk`, `#tab-log`). Fanerne sætter selv deres markup ind i `mount()` |
| `public/style.css` | Fundament | Tokens, grundstil, fælles komponenter (se nedenfor) |
| `public/icons.css`, `tools/icons.mjs` | Fundament | Ikonmasker. `icons.css` er genereret: ret i `tools/icons.mjs` og kør `node tools/icons.mjs` |
| `tools/palette-check.mjs` | Fundament | Tjekker farverne i `style.css` og kortets flader i `disk.css` (se Farveroller) |
| `public/ui.js` | Fundament | Fælles hjælpere (se nedenfor) |
| `public/app.js` | Fundament | Strømmen, den fælles tilstand, faneskift, topbjælke, bannere og fordelingen til fanerne |
| `public/log.js`, `public/log.css` | Fundament | Log-fanen, færdig |
| `public/live.js`, `public/field.js`, `public/live.css` | Live | live.js: overskrift, linser, spol tilbage, liste, detalje. field.js: boblefeltet (`FIELD`), som live.js importerer |
| `public/startup.js`, `public/startup.css` | Opstart | Seneste opstart, tidligere opstarter, opstartsposter, opgaver, tjenester |
| `public/disk.js`, `public/disk.css` | Disk | Disk-fanen |
| `server.mjs`, `lib/boot.mjs`, `test/boot.test.mjs` | Fundament | Statiske filer, starttidspunkt og `slower` pr. opstart |

Fanernes CSS er indkapslet under fanens panel (`#tab-live { … }` med CSS-nesting), så en fanes regler aldrig rammer en anden fane. Ingen regel står i to faners CSS: mærker er `chip()` og `.chip-*`, tonede bokse er `.callout`. En regel, som to faner kommer til at dele, flyttes til style.css. Regler, som kun én fane bruger (fx Opstarts `.card`, `.check` og `.run-dot`, Disks `.disk-why` og `.disk-input`), bliver i fanens fil.

En ny fil skal på `STATIC_FILES` i `server.mjs` (en liste over filnavne; typen følger endelsen) og linkes i `index.html` eller importeres af et modul.

### Modulkontrakten

Hver fane er et ES-modul, som `app.js` importerer som `import * as live from './live.js'`. Modulet eksporterer:

| Eksport | Krævet | Kaldes |
|---|---|---|
| `mount(panel, context)` | ja | Én gang ved start, før strømmen åbner. Sætter fanens skabelon ind (`panel.innerHTML` med en statisk streng; ingen `style`-attributter) og binder lyttere inde i panelet |
| `show()` | ja | Når fanen bliver vist (også den første ved start). Tegner alt fra `context.state` og starter dokumentlyttere, observers og timere |
| `hide()` | nej | Når fanen skjules. Stopper alt, `show()` startede, og kalder `cancelConfirm()` |
| `onSnapshot()` | nej | Hele tilstanden kan være skiftet: efter `snapshot` (første forbindelse og hver genforbindelse), og når dokumentet bliver synligt igen efter at have misset hændelser. Tegn alt forfra |
| `onTick(tick)` | nej | Nye tal. `tick` er serverens event: `{ at, headlines, totals, groups }`, hvor `groups` kun er de ændrede grupper. Tilstanden er allerede opdateret |
| `onInventory()` | nej | `state.inventory` er skiftet ud (efter hver handling og "Opdatér") |
| `onBoot()` | nej | `state.boot` er skiftet ud |
| `onLog()` | nej | `state.log` er skiftet ud |
| `onDisk()` | nej | `state.disk` er skiftet ud (scanning i gang, scanning færdig) |

Regler: app.js kalder kun hooks på den synlige fane og kun mens dokumentet er synligt. En skjult fane får ingen hændelser, så `show()` og `onSnapshot()` skal kunne tegne alt fra `context.state` alene, også når der er kommet nye data imens. En fane, der springer genopbygning over med en signatur, nulstiller signaturen i `show()`. Topbjælken (Live-pillen, mærkerne på Opstart, admin-banneret, status og puls) tegnes af app.js, ikke af fanerne.

`context` = `{ state, setLens(lens) }`:

- `state` er det ene objekt med serverens data. Det skiftes aldrig ud, så et modul må gemme referencen i `mount()`. Kun app.js skriver i det; fanerne læser. Felter: `groups` (Map key → gruppe), `history` (Map key → `{ cpu, ram, gpu, vram }` med op til `historyLength` punkter, nyeste sidst), `headlineHistory` (`{ cpu, ram, gpu, vram }`), `historyLength` (serverens `config.historyLength`, 150, sendt med `snapshot`; 0 før første snapshot), `lens` (`'cpu' | 'ram' | 'gpu' | 'vram'`), `headlines`, `totals`, `inventory` (eller `null`), `boot` (eller `null`), `log`, `protectedServices` (Set med små bogstaver), `disk` (diskens `{ index, active, locks }` eller `null`).
- `setLens(lens)` er den eneste skrivning fra en fane: den sætter `state.lens`, husker den i browseren og opdaterer Live-pillen. Fanen tegner selv sit indhold bagefter.
- Handlinger (`run`, `post`, `toast`) importeres fra `ui.js`.

### ui.js

| Eksport | Signatur og adfærd |
|---|---|
| `token`, `$`, `el`, `setChildren`, `icon` | Som før. `icon(name)` giver `<span class="bi bi-name" aria-hidden="true">` |
| `oneDecimal`, `percentParts`, `percent`, `memoryParts`, `memory` | Dansk talformat med faste `Intl.NumberFormat` (et nyt pr. kald koster ca. 0,1 ms). `percentParts(value)` giver `[tal, '%']`, `memoryParts(mb)` giver `[tal, 'MB' \| 'GB' \| 'TB']` |
| `lensParts(lens, value)`, `lensValue(lens, value)` | Linsens tal: `%` for cpu og gpu, MB, GB eller TB for ram og vram. `lensParts` giver `[tal, enhed]`, `lensValue` den samlede tekst. Det eneste sted, der ved, hvilke linser er hukommelse |
| `cssColor(name)` | Læser et token fra `:root` (til canvas) |
| `startModeLabel(service)` | Tjenestens opstartstype på dansk, fx "Automatisk (forsinket)". Den ene oversættelse, som `serviceControl`, Live og Opstart deler |
| `MS_PER_DAY` | Millisekunder pr. døgn (Log og Opstart) |
| `post(path, body)` | POST med token. Kaster `Error` med serverens tekst |
| `run(path, body, button)` | Som `post`, viser svaret som toast og returnerer `true`/`false`. Knappen er deaktiveret, mens kaldet kører. En deaktiveret knap mister fokus til `<body>`; havde knappen fokus, får den det tilbage bagefter, hvis den stadig er i DOM'en, og fokus ikke er flyttet imens |
| `toast(message, isError = false)` | Hvid pille med rundt ikon: `check-lg` på `--ok` eller `x-lg` på `--danger` |
| `confirmButton(label, confirmLabel, onConfirm, className = 'button button-small', iconName = null)` | Første klik bevæbner: `confirmLabel`, `.button-confirm` (fyldt fare) og lunten (3 px streg, der løber ned over 4 s). Andet klik kalder `onConfirm(button)`. Kun én knap er bevæbnet ad gangen |
| `cancelConfirm()` | Slår en bevæbnet knap tilbage |
| `toggle(label, checked, onToggle)` | `button.toggle` med `role="switch"`, `aria-checked` og `label` som `aria-label` og `title`. Klik kalder `onToggle(button)`; brug `run(…, button)`, så kontakten er deaktiveret imens. Den skifter først, når fanen tegner ny data |
| `chip(text, { iconName, tone, title, label })` | `span.chip`. `tone`: `junk`, `danger`, `slow`, `ok`, `dashed` eller `fill` (farven fra `data-res`/`data-cat` på chippen). Med `label` er chippen et kort mærke: `role="img"`, og `label` er både `aria-label` og `title` |
| `segment(label, choices)` | `div.segment` (`role="group"`). `choices`: `{ text, pressed, title, onPick, confirmLabel }`. Uden `onPick` er valget deaktiveret, og `title` siger hvorfor. Med `confirmLabel` er valget en `confirmButton` |
| `bindTablist(list, onPick)` | Klik og pil venstre/højre i en `role="tablist"`. Sætter `aria-selected` og `tabindex` (kun den valgte er i tab-rækkefølgen) og kalder `onPick(tab)` |
| `serviceControl(service, isProtected)` | Tjenestens opstartstype som `segment` `[Automatisk \| Manuel \| Deaktiveret]` plus en Stop-knap, når en Manuel tjeneste kører. Reglerne fra Opstart ovenfor. Boot/System, andre opstartstyper end de tre og låste tjenester (`isProtected` og ikke Deaktiveret) giver en låsenote. Returnerer en liste af noder. Bruges af både Live og Opstart, så den ligger her |
| `prepareCanvas(canvas, size = null)` | Skarpt canvas. `size` (`{ width, height }` fra en ResizeObserver) undgår layout-læsning. Er størrelsen uændret, ryddes lærredet med `context.reset()` i stedet for at sætte `width` og `height`, som laver bufferen om |
| `drawLine(canvas, values, minScale, color, slots, { lineWidth = 2, size = null } = {})` | Kurve justeret fra højre, `lineJoin` round, fyld med alfa 0,16 og en prik på nyeste punkt. Allokerer intet pr. punkt |

### Fælles komponenter i style.css

Knapper: `.button` (standard), `.button-primary` (hvid flade, blæktekst), `.button-ok`, `.button-danger` (fare-kant, fyldt fare ved hover), `.button-small`, `.button-confirm` (sættes af `confirmButton`). Rund ikonknap: `.icon-button` (40 px) og `.icon-button-small` (34 px); `.is-spinning` drejer ikonet. Faner som pilleskinne: `.tabs` med `.tab[role="tab"]`, `.tab-count`, `.tab-pill`, `.tab-badge` (`.is-slow`, `.is-junk`); bruges også til Opstarts segmentvælger. Kontakt: `.toggle`. Segmentkontrol: `.segment`. Chips: `.chips`, `.chip`, `.chip-*`. Callout: `.callout` med `.callout-junk`, `.callout-danger`, `.callout-slow` (flad tonet flade, ikonet i farven, ingen kantstribe). `.lock-note`, `kbd`, `.banner`, `.toast`, `.visually-hidden`. Fokusring: 2 px i `--text`. Reduced motion sætter alle varigheder til 1 ms og skjuler lunten.

Topbjælkens mærker på Opstart: `#tab-startup-dead` (antal døde poster i `--danger`, skjult ved 0) og `#tab-startup-slow` (ikonet `graph-up-arrow` i `--slow`, når `state.boot.sessions[0].slower`).

## Test

- Fælles testværktøj: `...\scratchpad\harness\`. `node serve.mjs <port>` kører en frisk kopi af TrashGuard på en egen port (start den i baggrunden). `node shoot.cjs <port> <ud-mappe> [desktop|mobile|all]` tager billeder af alle faner og melder JS-fejl og vandret overløb. `browser.cjs` åbner en side, hvor alle kald, der ændrer noget på PC'en (`/api/action`, `/api/undo`, `/api/disk/recycle`, `/api/disk/reveal`, `/api/disk/scan`, `/api/disk/rescan`, `/api/disk/stop`), besvares falsk i browseren. Brug kun den, når du klikker på handlinger.
- Porte: fundamentet 4330, Live 4331, Opstart 4332, Disk 4333, gennemgang 4334-4338, afslutning 4350. Aldrig 4319, det er brugerens egen instans.
- `node --test` i TrashGuard skal bestå.

## Funktionsliste (intet må forsvinde)

Linser CPU/RAM/GPU/VRAM med valg der huskes. Overskriftstal, samlet forbrug og kurve over 5 min. Kategorierne Syndere, Dine programmer, Du stoler på og Windows selv, sammenfoldelige. Mærkerne Kendt bloat, Baggrund: X, Autostart via X og Lukket nu. Detaljepanel med årsagskæde (kilde, forældre, proces) hvor forældre kan klikkes, alle otte tal (CPU nu/snit, GPU nu/snit, RAM, privat RAM, VRAM, antal processer), sparkline, sti og signatur, Kendt bloat-tekst, Afslut med bekræftelse og låsetekster, slå opstart og opgave fra og til, tjenestehandlinger, Stol på og Fjern tillid. Escape lukker detaljen. Opstart: Seneste opstart med tidslinje, tid pr. post, normal, mærker, fejlede tjenester, Hurtig start-note og tidligere opstarter. Lister for opstartsposter, planlagte opgaver og tjenester med "Vis Windows' egne", Kendt bloat og "Filen findes ikke". Disk: drev, mappe-sti og scan, status under scanning med Stop, brødkrummer, Kasser/Solstråle (huskes), kort med tooltip, Backspace går op, detaljepanel med Åbn i Stifinder, Kopiér sti, Scan igen og Papirkurv (flyt til papirkurven), legende, "Hvorfor mangler der noget?" og "Scan hele drevet igen". Log med Fortryd. Admin-banner, problem-banner, toast, Opdatér, status (Forbinder, Måler, Live, Ingen forbindelse), og at fanen lukker serveren, når den sidste fane lukkes.
