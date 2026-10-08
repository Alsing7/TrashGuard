// Opstart-fanen: seneste opstart med tidslinje, tidligere opstarter og opstartsposter, opgaver og tjenester.
import { el, icon, chip, toggle, setChildren, oneDecimal, run, cancelConfirm, serviceControl, startModeLabel, bindTablist, MS_PER_DAY } from './ui.js';

const TEMPLATE = `
  <div class="boot-wrap">
    <section class="card boot" id="boot" aria-label="Opstart"><p class="empty">Læser Windows' eventlog…</p></section>
    <section class="card history" id="boot-history" aria-labelledby="history-title" hidden>
      <h2 class="card-title" id="history-title">Tidligere <span class="chip" id="history-count"></span></h2>
      <div class="history-bars" id="history-bars"></div>
      <p class="history-legend" id="history-legend"></p>
      <p class="history-worst" id="history-worst"></p>
    </section>
  </div>
  <div class="inventory-bar">
    <div class="tabs inv-tabs" role="tablist" aria-label="Opstartsposter, planlagte opgaver og tjenester" id="inv-tabs">
      <button type="button" role="tab" class="tab" id="inv-tab-startup" data-inv="startup" aria-controls="inventory" aria-selected="true"><span class="bi bi-power" aria-hidden="true"></span><span class="inv-long">Opstartsposter</span><span class="inv-short">Poster</span><span class="inv-meta"></span></button>
      <button type="button" role="tab" class="tab" id="inv-tab-tasks" data-inv="tasks" aria-controls="inventory" aria-selected="false"><span class="bi bi-calendar-check" aria-hidden="true"></span><span class="inv-long">Planlagte opgaver</span><span class="inv-short">Opgaver</span><span class="inv-meta"></span></button>
      <button type="button" role="tab" class="tab" id="inv-tab-services" data-inv="services" aria-controls="inventory" aria-selected="false"><span class="bi bi-gear" aria-hidden="true"></span><span class="inv-long">Tjenester</span><span class="inv-short">Tjenester</span><span class="inv-meta"></span></button>
    </div>
    <label class="check"><input type="checkbox" id="show-windows"><span class="check-box" aria-hidden="true"><span class="bi bi-check-lg"></span></span>Vis Windows' egne<span id="hidden-dead"></span></label>
  </div>
  <div id="inventory" role="tabpanel" aria-labelledby="inv-tab-startup"><ol class="card inventory" id="inventory-list"><li class="empty">Læser opstartsposter, opgaver og tjenester…</li></ol></div>`;

const BOOT_TYPE = { 0: ['power', 'kold start'], 1: ['lightning-charge', 'hurtig start'], 2: ['moon-stars', 'fra dvale'] };
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
// Afvigelser under 10 s vises med én decimal, større i hele sekunder.
const WHOLE_SECONDS_FROM = 10;
// Tidslinjen er lidt længere end opstarten, så normal-linjen kan stå efter sidste post.
const TIMELINE_ROOM = 1.03;
// Selv den korteste opstart får en søjle, der kan ses og rammes.
const MIN_BAR_PERCENT = 6;
const EMPTY_TEXT = {
  startup: 'Ingen opstartsposter.',
  tasks: "Ingen planlagte opgaver. Slå \"Vis Windows' egne\" til for at se Windows' egne.",
  services: "Ingen tjenester. Slå \"Vis Windows' egne\" til for at se Windows' egne.",
};

// Fælles tilstand fra app.js (samme objekt hele tiden), fanens noder og dens egen visningstilstand.
// Nøglerne (bootData, bootNames, listKey, metaKeys) beskriver det, der står i DOM'en, så uændrede data ikke skrives igen.
let state = null;
let nodes = null;
const view = { boot: null, bootIndex: 0, invTab: 'startup', runSlots: [], pressedKey: null, bootData: null, bootNames: null, listKey: null, metaKeys: {} };

// ---------- Fælles ----------

function duration(seconds) {
  if (seconds < SECONDS_PER_MINUTE) return `${oneDecimal(seconds)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / SECONDS_PER_MINUTE)} min ${whole % SECONDS_PER_MINUTE} s`;
}

const capitalize = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;
const bootTime = (at) => capitalize(new Date(at).toLocaleString('da-DK', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }));
const sinceBoot = (session, at) => `+${duration((at - session.at) / MS_PER_SECOND)}`;

// Filnavnet uden mappe, anførselstegn og argumenter: `C:\A\b.exe` og Explorers `b.exe" --x` giver `b.exe`.
const fileName = (path) => path.slice(path.lastIndexOf('\\') + 1).split('"')[0].trim();

// Explorer logger kun det, der står efter sidste \ i Run-værdien, fx `GG" -dbEnv=production -auto=true`.
const startupFor = (command) => state.inventory?.startup.find((entry) => entry.command && entry.command.slice(entry.command.lastIndexOf('\\') + 1) === command);
const runLabel = (command) => startupFor(command)?.name ?? fileName(command);

// Fokus og tastaturet: serveren sender inventory-eventet, før handlingen svarer, så rækkerne bygges om, mens den
// trykkede knap er deaktiveret og fokus står på <body>. Fanen husker derfor den kontrol, der sidst blev trykket på
// (view.pressedKey), og ombygningen sætter fokus tilbage på samme kontrol; bygges intet om, gør run() det selv.
// Nøglen gælder kun, mens kontrollen stadig er deaktiveret (kaldet kører); ellers er den forældet og ville flytte
// fokus og siden hen til et gammelt klik.
function pendingControl(container) {
  const pressed = view.pressedKey && container.querySelector(`[data-focus-key="${CSS.escape(view.pressedKey)}"]`);
  return pressed?.disabled ? pressed : null;
}

function keepFocus(container, rebuild) {
  const active = document.activeElement;
  const key = container.contains(active) ? active.dataset.focusKey : active === document.body && pendingControl(container) ? view.pressedKey : null;
  rebuild();
  const target = key && container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (!target) return;
  // Et segment, der nu er det valgte, er deaktiveret; så får rækkens første brugbare kontrol fokus.
  (target.disabled ? target.closest('li')?.querySelector('button:not(:disabled)') : target)?.focus();
  view.pressedKey = null;
}

const startupToggle = (entry) => toggle(`Opstart: ${entry.name}`, entry.enabled,
  (button) => run('/api/action', { type: 'startup', id: entry.id, enable: !entry.enabled }, button));

function withFocusKey(node, key) {
  node.dataset.focusKey = key;
  return node;
}

// ---------- Seneste opstart ----------

function fastStartupNote(boot) {
  const days = Math.floor((Date.now() - boot.lastBoot) / MS_PER_DAY);
  if (!boot.fastStartup || days < 1) return null;
  return el('p', { className: 'callout', title: 'Hurtig start er slået til, så "Luk computeren" starter ikke kernen og driverne forfra.' }, icon('lightning-charge'),
    el('span', {}, `Hurtig start: sidste rigtige genstart for ${days} ${days === 1 ? 'dag' : 'dage'} siden. Brug "Genstart" en gang imellem.`));
}

function bigDuration(seconds) {
  if (seconds < SECONDS_PER_MINUTE) return [oneDecimal(seconds), el('small', {}, 's')];
  const whole = Math.round(seconds);
  return [String(Math.floor(whole / SECONDS_PER_MINUTE)), el('small', {}, 'min'), ` ${whole % SECONDS_PER_MINUTE}`, el('small', {}, 's')];
}

// Farven kommer fra serverens slower-flag (lib/boot.mjs); klienten regner ikke selv "langsommere" ud.
function deviationChip(session) {
  if (session.totalSeconds === null || session.normalTotalSeconds === null) return null;
  const delta = session.totalSeconds - session.normalTotalSeconds;
  const size = Math.abs(delta);
  const text = size >= SECONDS_PER_MINUTE ? duration(size) : `${size < WHOLE_SECONDS_FROM ? oneDecimal(size) : Math.round(size)} s`;
  const label = `${duration(size)} ${delta < 0 ? 'hurtigere' : 'langsommere'} end normalt (${duration(session.normalTotalSeconds)})`;
  return chip(`${delta < 0 ? '−' : '+'}${text}`, session.slower ? { tone: 'slow', iconName: 'graph-up-arrow', label } : { label });
}

function bootHead(session) {
  const [typeIcon, typeText] = BOOT_TYPE[session.type] ?? ['power', 'ukendt starttype'];
  return el('div', { className: 'boot-head' },
    session.totalSeconds !== null && el('p', { className: 'boot-total', title: 'Fra tænd til opstartsposterne var færdige' }, bigDuration(session.totalSeconds)),
    deviationChip(session),
    el('div', { className: 'chips boot-chips' }, chip(typeText, { iconName: typeIcon }), chip(bootTime(session.at), { iconName: 'calendar-event' })));
}

const runTone = (item) => (item.hitLimit ? 'is-limit' : item.slower ? 'is-slower' : '');

function itemLabel(item, waitLimitSeconds) {
  const normal = item.normal === null ? '' : `, normalt ${duration(item.normal)}`;
  const limit = item.hitLimit ? `. Windows ventede maks. (${waitLimitSeconds} s)` : '';
  return `${runLabel(item.command)}: ${duration(item.seconds)}${normal}${limit}`;
}

// Blokke og mærker placeres i procent af tidslinjen. Et mærkes tekst forskydes lige så mange procent af sin egen bredde,
// så den aldrig stikker ud over kanten: ved 0 % står den til højre for stregen, ved 100 % til venstre.
function timeline(session, waitLimitSeconds) {
  const spanMs = Math.max(session.doneAt - session.at, (session.normalTotalSeconds ?? 0) * MS_PER_SECOND) * TIMELINE_ROOM;
  const share = (at) => ((at - session.at) / spanMs) * 100;
  const runs = [...session.items].sort((a, b) => a.startedAt - b.startedAt);
  const runsAt = session.runsStartedAt ?? runs[0].startedAt;
  const logonAt = session.logonAt !== null && session.logonAt < runsAt ? session.logonAt : null;

  // Navnet ligger i sit eget lag over normal-stregen (se startup.css), så stregen aldrig skærer teksten.
  const block = (tone, label, from, to, name) => {
    const node = el('div', { className: `timeline-block ${tone}`, role: 'img', 'aria-label': label, title: label },
      el('span', { className: 'timeline-name' }, el('span', {}, name)));
    node.style.left = `${share(from)}%`;
    node.style.width = `${share(to) - share(from)}%`;
    return node;
  };
  const anchored = (className, at, ...children) => {
    const node = el('div', { className }, el('span', {}, children));
    node.style.left = `${share(at)}%`;
    node.firstChild.style.transform = `translateX(-${share(at)}%)`;
    return node;
  };
  const mark = (at, text, row) => at !== null && anchored(`timeline-mark ${row}`, at, el('b', {}, sinceBoot(session, at)), ` ${text}`);
  const normalAt = session.normalTotalSeconds === null ? null : session.at + session.normalTotalSeconds * MS_PER_SECOND;

  return el('div', { className: 'timeline' },
    normalAt !== null && anchored('timeline-normal', normalAt, `normalt ${duration(session.normalTotalSeconds)}`),
    el('div', { className: 'timeline-track' },
      block('is-phase', `Windows starter: ${duration(((logonAt ?? runsAt) - session.at) / MS_PER_SECOND)} før ${logonAt ? 'login' : 'opstartsposterne'}`, session.at, logonAt ?? runsAt, 'Windows'),
      logonAt && block('is-phase', `Skrivebordet: ${duration((runsAt - logonAt) / MS_PER_SECOND)} fra login til opstartsposterne`, logonAt, runsAt, 'Skrivebord'),
      runs.map((item) => block(`is-run ${runTone(item)}`, itemLabel(item, waitLimitSeconds), item.startedAt, item.startedAt + item.seconds * MS_PER_SECOND, runLabel(item.command)))),
    el('div', { className: 'timeline-marks' },
      mark(logonAt, 'logget ind', 'is-upper'),
      mark(session.runsStartedAt, 'poster begynder', 'is-lower'),
      mark(session.doneAt, 'færdige', 'is-upper')));
}

function failedServices(session) {
  if (!session.failedServices.length) return null;
  return el('div', { className: 'boot-failed' },
    el('span', { className: 'boot-failed-label' }, 'Fejlede tjenester'),
    el('div', { className: 'chips' }, session.failedServices.map((service) => {
      const reason = service.timeout ? 'svarede ikke i tide' : 'kunne ikke starte';
      return chip(service.name, { tone: 'danger', iconName: service.timeout ? 'hourglass-split' : 'x-octagon', label: `${service.name} ${reason}` });
    })));
}

function itemChip(item, waitLimitSeconds) {
  if (item.hitLimit) return chip(`${waitLimitSeconds} s`, { tone: 'danger', iconName: 'hourglass-split', label: `Windows ventede maks. (${waitLimitSeconds} s)` });
  if (!item.slower) return null;
  const ratio = item.normal > 0 ? `${oneDecimal(item.seconds / item.normal)}×` : '';
  return chip(ratio, { tone: 'slow', iconName: 'graph-up-arrow', label: `Langsommere end normalt${ratio ? `: ${ratio.slice(0, -1)} gange så lang tid` : ''}` });
}

function bootItem(item, scale, waitLimitSeconds) {
  const entry = startupFor(item.command);
  const label = runLabel(item.command);
  const exe = fileName(entry?.exe || item.command);
  const bar = el('div', { className: `boot-bar ${runTone(item)}`, 'aria-hidden': 'true' }, el('span', { className: 'boot-bar-fill' }));
  bar.firstChild.style.width = `${(item.seconds / scale) * 100}%`;
  if (item.normal !== null) {
    const normal = el('span', { className: 'boot-bar-normal' });
    normal.style.left = `${(item.normal / scale) * 100}%`;
    bar.append(normal);
  }
  return el('li', { className: 'boot-item' },
    el('div', { className: 'boot-name' },
      el('p', { className: 'boot-title' }, el('b', {}, label), itemChip(item, waitLimitSeconds)),
      exe !== label && el('small', { title: entry?.command ?? item.command }, exe)),
    bar,
    el('p', { className: 'boot-time' }, duration(item.seconds), el('small', {}, item.normal === null ? 'ingen normal' : `normalt ${duration(item.normal)}`)),
    entry ? withFocusKey(startupToggle(entry), `boot:${entry.id}`) : el('span'));
}

// Det, opstartskortet og søjlerne læser fra inventory: navn, exe og kontakt for hver post.
const bootInventoryKey = () => state.boot.sessions.flatMap((session) => session.items).map((item) => {
  const entry = startupFor(item.command);
  return entry ? `${entry.id}|${entry.name}|${entry.exe}|${entry.enabled}` : '';
}).join('\n');

// Kortet og søjlerne bygges kun om, når opstartsdata eller det, de læser fra inventory, er ændret.
// "Opdatér" sender begge dele igen, ofte uændret.
function renderBoot() {
  const boot = state.boot;
  if (!boot) return;
  const data = JSON.stringify(boot);
  const names = bootInventoryKey();
  if (data === view.bootData && names === view.bootNames) return;
  // Nye opstartsdata (også mens fanen var skjult) viser den nyeste opstart.
  if (data !== view.bootData) view.bootIndex = 0;
  Object.assign(view, { boot, bootData: data, bootNames: names });
  renderHistory();
  renderSession();
}

// Den valgte opstart. Et klik på en søjle tegner kun denne og markeringen.
function renderSession() {
  const session = view.boot.sessions[view.bootIndex];
  keepFocus(nodes.boot, () => setChildren(nodes.boot, session ? bootCard(view.boot, session) : el('p', { className: 'empty' }, 'Windows har ingen opstarter i eventloggen.')));
  markSelectedBoot();
}

function bootCard(boot, session) {
  const scale = Math.max(1, ...session.items.flatMap((item) => [item.seconds, item.normal ?? 0]));
  return [
    el('h2', { className: 'card-title' }, view.bootIndex === 0 ? 'Seneste opstart' : 'Opstart'),
    fastStartupNote(boot),
    bootHead(session),
    session.totalSeconds !== null && timeline(session, boot.waitLimitSeconds),
    failedServices(session),
    session.items.length
      ? el('ol', { className: 'boot-items' }, session.items.map((item) => bootItem(item, scale, boot.waitLimitSeconds)))
      : el('p', { className: 'empty' }, 'Windows har ikke længere tiderne for opstartsposterne fra denne opstart.'),
  ];
}

// ---------- Tidligere opstarter ----------

function historyLabel(session) {
  const total = session.totalSeconds === null ? 'ingen tider' : duration(session.totalSeconds);
  const slower = session.slower ? ', langsommere end normalt' : '';
  const failed = session.failedServices.length ? `, ${session.failedServices.length} ${session.failedServices.length === 1 ? 'tjeneste' : 'tjenester'} fejlede` : '';
  const worst = session.items[0] ? `, værst: ${runLabel(session.items[0].command)} ${duration(session.items[0].seconds)}` : '';
  return `${bootTime(session.at)}: ${total}${slower}${failed}${worst}`;
}

const shortDate = (at) => `${new Date(at).getDate()}.${new Date(at).getMonth() + 1}`;

// En søjle, der deler dato med en nabo, viser altid klokkeslættet, så de to kan skelnes (se startup.css).
function historyBar(session, index, scale, sharesDate) {
  const kind = session.totalSeconds === null ? 'is-empty' : session.slower ? 'is-slow' : '';
  const fill = el('span', { className: `history-fill ${kind}` }, session.failedServices.length > 0 && el('span', { className: 'history-fail' }));
  if (session.totalSeconds !== null) fill.style.height = `${Math.max(MIN_BAR_PERCENT, (session.totalSeconds / scale) * 100)}%`;
  const label = historyLabel(session);
  const bar = el('button', { type: 'button', className: sharesDate ? 'history-bar is-twin' : 'history-bar', 'aria-label': label, title: label, 'aria-pressed': 'false', onclick: () => selectBoot(index) },
    el('span', { className: 'history-track' }, fill),
    el('span', { className: 'history-date', 'aria-hidden': 'true' }, shortDate(session.at),
      el('span', { className: 'history-time' }, new Date(session.at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }))));
  return withFocusKey(bar, `boot-bar:${session.at}`);
}

function legendEntry(className, text) {
  return el('span', {}, el('span', { className: `swatch ${className}` }), text);
}

function renderHistory() {
  const sessions = view.boot.sessions;
  nodes.history.hidden = sessions.length < 2;
  nodes.historyCount.textContent = String(sessions.length);
  const scale = Math.max(1, ...sessions.map((session) => session.totalSeconds ?? 0));
  const dates = sessions.map((session) => shortDate(session.at));
  const sharesDate = (index) => dates[index - 1] === dates[index] || dates[index + 1] === dates[index];
  keepFocus(nodes.historyBars, () => setChildren(nodes.historyBars, sessions.map((session, index) => historyBar(session, index, scale, sharesDate(index))).reverse()));
  setChildren(nodes.historyLegend,
    sessions.some((session) => session.totalSeconds !== null && !session.slower) && legendEntry('is-normal', 'normal'),
    sessions.some((session) => session.slower) && legendEntry('is-slow', 'langsommere'),
    sessions.some((session) => session.failedServices.length) && legendEntry('is-fail', 'fejlede tjenester'));
}

function markSelectedBoot() {
  const count = view.boot.sessions.length;
  for (const [position, bar] of [...nodes.historyBars.children].entries()) {
    bar.setAttribute('aria-pressed', String(count - 1 - position === view.bootIndex));
  }
  const worst = view.boot.sessions[view.bootIndex]?.items[0];
  setChildren(nodes.historyWorst, worst && [el('span', {}, 'Værst: '), `${runLabel(worst.command)}, ${duration(worst.seconds)}`]);
}

function selectBoot(index) {
  view.bootIndex = index;
  renderSession();
}

// ---------- Opstartsposter, opgaver og tjenester ----------

const byBloatThenName = (a, b) => Number(Boolean(b.bloatText || b.orphan)) - Number(Boolean(a.bloatText || a.orphan)) || String(a.name).localeCompare(String(b.name), 'da');
const isDisabled = (service) => service.startMode === 'Disabled';

// Samme filtre og sortering som altid. Deaktiverede tjenester står øverst og skjules aldrig, så de er hurtige at aktivere igen.
function inventoryLists(inventory, showWindows) {
  return {
    startup: [...inventory.startup].sort(byBloatThenName),
    tasks: inventory.tasks.filter((task) => showWindows || !task.microsoft || task.bloatText).sort(byBloatThenName),
    services: inventory.services.filter((service) => showWindows || !service.windows || service.bloatText || isDisabled(service))
      .sort((a, b) => Number(isDisabled(b)) - Number(isDisabled(a)) || byBloatThenName({ ...a, name: a.display }, { ...b, name: b.display })),
  };
}

// Død post: slået til, men filen findes ikke. Samme regel som topbjælkens mærke (app.js), så tallene stemmer.
const isDead = (item) => item.orphan && item.enabled !== false && item.startMode !== 'Disabled';
const deadCount = (items) => items.filter(isDead).length;
const deadText = (count) => (count === 1 ? 'død post: slået til, men filen findes ikke' : 'døde poster: slået til, men filen findes ikke');

function tabBadge(count, className, text) {
  return count > 0 && el('span', { className: `tab-badge ${className}`, title: `${count} ${text}` }, String(count), el('span', { className: 'visually-hidden' }, ` ${text}`));
}

// Skriver kun, når et af tallene er ændret. Antallet er de viste rækker; prikkerne tæller hele listen,
// så en død post, som filteret skjuler, stadig ses (og "Vis Windows' egne" siger, at den er skjult).
function writeIfChanged(name, target, key, ...children) {
  if (view.metaKeys[name] === key) return;
  view.metaKeys[name] = key;
  setChildren(target, ...children);
}

function renderTabMeta(tab, shown, all) {
  const bloat = all.filter((item) => item.bloatText).length;
  const dead = deadCount(all);
  writeIfChanged(tab.dataset.inv, tab.querySelector('.inv-meta'), `${shown.length}|${bloat}|${dead}`,
    el('span', { className: 'tab-count' }, String(shown.length)),
    tabBadge(bloat, 'is-junk', 'kendt bloat'),
    tabBadge(dead, '', deadText(dead)));
}

function renderHiddenDead(lists, inventory) {
  const hidden = Object.keys(lists).reduce((sum, kind) => sum + deadCount(inventory[kind]) - deadCount(lists[kind]), 0);
  writeIfChanged('hiddenDead', nodes.hiddenDead, String(hidden), tabBadge(hidden, '', hidden === 1 ? 'død post er skjult' : 'døde poster er skjult'));
}

function itemChips(item) {
  return [
    item.bloatText && chip('Kendt bloat', { tone: 'junk', iconName: 'trash3', title: item.bloatText }),
    item.orphan && chip('Filen findes ikke', { tone: 'danger', iconName: 'file-earmark-x' }),
  ];
}

const runningDot = () => el('span', { className: 'run-dot' }, 'kører nu');

// To linjer: navnet med mærker, og under det filnavnet og kilden i dæmpet tekst. Hele stien står i title.
function inventoryRow(item, { title, sub, path, status, actions }) {
  return el('li', { className: 'inv-row' },
    el('div', { className: 'inv-name' },
      el('p', { className: 'inv-title' }, el('b', {}, title), itemChips(item)),
      el('p', { className: 'inv-sub' }, path && el('span', { className: 'inv-path', title: path }, fileName(path)), sub && el('span', { className: 'inv-source' }, sub))),
    el('div', { className: 'inv-state' }, status),
    el('div', { className: 'inv-actions' }, actions));
}

const ROWS = {
  startup: (item, isRunning) => inventoryRow(item, {
    title: item.name,
    sub: item.type === 'folder' ? 'Startmappen' : `Registreringsdatabasen (${item.scope})`,
    path: item.exe || item.command,
    status: isRunning(item.exe) && runningDot(),
    actions: withFocusKey(startupToggle(item), `startup:${item.id}`),
  }),
  tasks: (task, isRunning) => inventoryRow(task, {
    title: task.name,
    sub: task.path,
    path: task.exe || 'Intet program (intern Windows-handling)',
    status: isRunning(task.exe) && runningDot(),
    actions: withFocusKey(toggle(`Opgave: ${task.name}`, task.enabled,
      (button) => run('/api/action', { type: 'task', id: task.id, enable: !task.enabled }, button)), `task:${task.id}`),
  }),
  services: (service) => {
    const control = serviceControl(service, state.protectedServices.has(service.name.toLowerCase()));
    const locked = control[0].classList.contains('lock-note');
    const buttons = control.filter(Boolean).flatMap((node) => (node.matches('button') ? [node] : [...node.querySelectorAll('button')]));
    buttons.forEach((button, index) => withFocusKey(button, `service:${service.name}:${index}`));
    return inventoryRow(service, {
      title: service.display,
      sub: service.name,
      path: service.exe || '',
      // Segmentet viser opstartstypen. Teksten står kun, når den ellers ville mangle: låst, driver eller forsinket.
      status: [service.state === 'Running' && runningDot(), (locked || service.delayed) && el('span', { className: 'inv-mode' }, startModeLabel(service))],
      actions: control,
    });
  },
};

// Om en exe kører lige nu, ud fra Live-målingens grupper.
function runningCheck() {
  const running = new Set([...state.groups.values()].filter((group) => group.running && group.path).map((group) => group.path.toLowerCase()));
  return (exe) => Boolean(exe && running.has(exe.toLowerCase()));
}

// "kører nu"-pladsen i hver viste opstartspost og opgave, så et tick kan skifte den alene.
// Tjenesterne bruger deres egen tilstand og følger ikke målingen.
function watchRunning(items, rows, isRunning) {
  view.runSlots = view.invTab === 'services' ? [] : items.flatMap((item, index) => (item.exe
    ? [{ exe: item.exe, slot: rows[index].querySelector('.inv-state'), running: isRunning(item.exe) }]
    : []));
}

function renderInventory() {
  const inventory = state.inventory;
  if (!inventory) return;
  const lists = inventoryLists(inventory, nodes.showWindows.checked);
  for (const tab of nodes.invTabs) renderTabMeta(tab, lists[tab.dataset.inv], inventory[tab.dataset.inv]);
  renderHiddenDead(lists, inventory);
  const items = lists[view.invTab];
  // Samme rækker som sidst (fx efter "Opdatér"): intet at skrive.
  const listKey = JSON.stringify([view.invTab, items]);
  if (listKey === view.listKey) return;
  view.listKey = listKey;
  const isRunning = runningCheck();
  const rows = items.map((item) => ROWS[view.invTab](item, isRunning));
  watchRunning(items, rows, isRunning);
  nodes.inventory.dataset.kind = view.invTab;
  keepFocus(nodes.inventory, () => setChildren(nodes.inventory, rows.length ? rows : el('li', { className: 'empty' }, EMPTY_TEXT[view.invTab])));
}

function pickInventoryTab(tab) {
  view.invTab = tab.dataset.inv;
  nodes.inventoryPanel.setAttribute('aria-labelledby', tab.id);
  renderInventory();
}

// Et tick kan kun ændre "kører nu". Kun rækker, hvis program er startet eller lukket, skrives.
function onTickRunning() {
  if (!view.runSlots.length) return;
  const isRunning = runningCheck();
  for (const watched of view.runSlots) {
    const running = isRunning(watched.exe);
    if (running === watched.running) continue;
    watched.running = running;
    setChildren(watched.slot, running && runningDot());
  }
}

function render() {
  renderBoot();
  renderInventory();
}

// Hele tilstanden kan være skiftet (show, snapshot): glem nøglerne, så alt tegnes forfra.
// Den valgte opstart bevares, når opstartsdata er de samme.
function renderAll() {
  Object.assign(view, { bootNames: null, listKey: null, metaKeys: {} });
  render();
}

// ---------- Modulkontrakten (se docs/design.md) ----------

export function mount(panel, context) {
  state = context.state;
  panel.innerHTML = TEMPLATE;
  nodes = {
    boot: panel.querySelector('#boot'),
    history: panel.querySelector('#boot-history'),
    historyCount: panel.querySelector('#history-count'),
    historyBars: panel.querySelector('#history-bars'),
    historyLegend: panel.querySelector('#history-legend'),
    historyWorst: panel.querySelector('#history-worst'),
    invTabs: [...panel.querySelectorAll('[data-inv]')],
    showWindows: panel.querySelector('#show-windows'),
    hiddenDead: panel.querySelector('#hidden-dead'),
    inventoryPanel: panel.querySelector('#inventory'),
    inventory: panel.querySelector('#inventory-list'),
  };
  bindTablist(panel.querySelector('#inv-tabs'), pickInventoryTab);
  nodes.showWindows.addEventListener('change', renderInventory);
  panel.addEventListener('click', (event) => { view.pressedKey = event.target.closest('[data-focus-key]')?.dataset.focusKey ?? null; }, true);
}

export const show = renderAll;
export const hide = cancelConfirm;
export const onSnapshot = renderAll;
export const onInventory = render;
export const onBoot = renderBoot;
export const onTick = onTickRunning;
