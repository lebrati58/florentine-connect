// 4FLORENTINE — application résidents
import { T } from './i18n.js';
import { icon } from '../assets/ds/icons.js';
import {
  CATEGORIES, STATUSES, TRADES, OPEN_STATUSES, RESIDENT_STEPS, label, iconOf,
  AREAS, COMMON_AREAS, ENTRANCES, CATEGORY_AREA, MUNICIPAL_106, isParking, devicePlatform, VOTE_RULES, optionText,
  esc, $, $$, fmtDate, fmtDateTime, relTime, toast, errorKey, createApi,
} from '../assets/js/core.js';

/* ------------------------------------------------------------------ état */
const S = {
  lang: 'fr', session: null, apt: null, towers: [],
  tickets: null, ticketsError: null, announcements: null, annError: null,
  directory: null, dirError: null, dirTrade: '', dirQuery: '',
  reqTab: 'open', detail: null, detailError: null, photoUrls: {},
  shabbat: null, shabbatError: false, online: navigator.onLine,
  login: { entrance: null, error: '', busy: false },
  draft: null, sent: null, installEvt: null, unsub: null,
  votes: null, votesError: null, ballots: [], proxies: [], summaries: {}, picks: {},
  visits: null, visitsError: null, visitBookings: [], visitCounts: {}, visitPicks: {}, visitNotes: {},
};
let api;

const t = (k, vars = {}) => {
  let s = (T[S.lang] && T[S.lang][k]) ?? T.fr[k] ?? k;
  for (const [a, b] of Object.entries(vars)) s = s.replaceAll('{' + a + '}', b);
  return s;
};
const errMsg = (e) => t('err_' + errorKey(e));
const L = (list, key) => label(list, key, S.lang);

/* ------------------------------------------------------------------ langue */
function detectLang() {
  try { const saved = localStorage.getItem('fl-lang'); if (saved && T[saved]) return saved; } catch { /* stockage indisponible */ }
  const n = (navigator.language || 'fr').toLowerCase();
  return n.startsWith('he') || n.startsWith('iw') ? 'he' : n.startsWith('en') ? 'en' : 'fr';
}
function setLang(lang) {
  S.lang = T[lang] ? lang : 'fr';
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === 'he' ? 'rtl' : 'ltr';
  document.title = '4FLORENTINE · ' + t('pageTitle');
  try { localStorage.setItem('fl-lang', S.lang); } catch { /* ignore */ }
  render();
}
const langSwitch = () => `<div class="lang-switch" role="group" aria-label="${t('langLabel')}">
  ${[['fr', 'FR'], ['he', 'עב'], ['en', 'EN']].map(([k, v]) => `<button type="button" data-act="lang" data-lang="${k}" aria-pressed="${S.lang === k}" lang="${k}">${v}</button>`).join('')}
</div>`;

/* ------------------------------------------------------------------ routes */
function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  return { name: parts[0] || 'home', id: parts[1] ? Number(parts[1]) : null };
}
const go = (h) => { if (location.hash === h) render(); else location.hash = h; };

/* ------------------------------------------------------------------ données */
async function loadTickets() {
  try { S.tickets = await api.tickets(); S.ticketsError = null; } catch (e) { S.ticketsError = e; }
}
async function loadAnnouncements() {
  try { S.announcements = await api.announcements(); S.annError = null; } catch (e) { S.annError = e; }
}
async function loadDirectory() {
  try { S.directory = await api.directory(); S.dirError = null; } catch (e) { S.dirError = e; }
}
async function loadDetail(id) {
  S.detail = null; S.detailError = null; S.photoUrls = {};
  try {
    S.detail = await api.ticket(id);
    S.photoUrls = await api.photoUrls(S.detail.photos.map(p => p.path)).catch(() => ({}));
  } catch (e) { S.detailError = e; }
}
async function loadVotes() {
  try {
    const [v, b, p] = await Promise.all([api.votes(), api.myBallots(), api.myProxies()]);
    S.votes = v; S.ballots = b; S.proxies = p; S.votesError = null;
  } catch (e) { S.votesError = e; if (!S.votes) S.votes = []; }
}
async function loadSummary(id) {
  try { S.summaries[id] = await api.voteSummary(id); } catch { S.summaries[id] = { hidden: true }; }
}
async function loadVisits() {
  try {
    const [c, b] = await Promise.all([api.visitCampaigns(), api.myVisitBookings()]);
    S.visits = c; S.visitBookings = b; S.visitsError = null;
  } catch (e) { S.visitsError = e; if (!S.visits) S.visits = []; }
}
async function loadVisitCounts(id) {
  try { const rows = await api.visitSlotCounts(id); S.visitCounts[id] = Object.fromEntries(rows.map(r => [r.slot_id, r.booked])); }
  catch { S.visitCounts[id] = {}; }
}
async function loadAll() {
  await Promise.all([loadTickets(), loadAnnouncements(), loadDirectory(), loadVotes(), loadVisits(), api.towers().then(x => { S.towers = x; }).catch(() => {})]);
  render();
}
async function loadShabbat() {
  try {
    const r = await fetch('https://www.hebcal.com/shabbat?cfg=json&geonameid=293397&b=18&M=on', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const now = Date.now();
    const candles = data.items.filter(i => i.category === 'candles' && new Date(i.date).getTime() > now - 26 * 3600e3).sort((a, b) => new Date(a.date) - new Date(b.date));
    const candle = candles[0];
    if (!candle) throw new Error('no candles');
    const start = new Date(candle.date).getTime();
    const next = candles[1] ? new Date(candles[1].date).getTime() : start + 8 * 864e5;
    const win = data.items.filter(i => { const d = new Date(i.date).getTime(); return d >= start && d < next; });
    S.shabbat = { candle, havdalah: win.find(i => i.category === 'havdalah'), parasha: data.items.find(i => i.category === 'parashat') };
    S.shabbatError = false;
  } catch { S.shabbatError = true; }
  if (S.session) render();
}

/* ------------------------------------------------------------------ rendu */
function render() {
  const root = $('#app');
  if (!S.session || !S.apt) { root.innerHTML = viewLogin(); afterLogin(); return; }
  const r = route();
  let body;
  if (r.name === 'requests' && r.id) body = viewDetail();
  else if (r.name === 'requests') body = viewRequests();
  else if (r.name === 'new') body = S.sent ? viewSent() : viewNew();
  else if (r.name === 'directory') body = viewDirectory();
  else if (r.name === 'votes' && r.id) body = viewVoteDetail(r.id);
  else if (r.name === 'votes') body = viewVotes();
  else if (r.name === 'visits' && r.id) body = viewVisitDetail(r.id);
  else if (r.name === 'visits') body = viewVisits();
  else if (r.name === 'building') body = viewBuilding();
  else body = viewHome();
  const tab = r.name === 'new' ? 'new' : ['votes', 'visits'].includes(r.name) ? 'building' : ['requests', 'directory', 'building'].includes(r.name) ? r.name : 'home';
  root.innerHTML = `<div class="shell">
    ${topbar()}
    ${S.online ? '' : `<div class="offline-bar" role="status">${icon('alert', 'ic-sm')}<span>${t('offline')}</span></div>`}
    <main id="main">${body}</main>
    ${tabbar(tab)}
  </div>`;
  if (r.name === 'new' && !S.sent) bindNewForm();
}

function topbar() {
  return `<header class="topbar">
    <a class="brand" href="#/home" aria-label="4FLORENTINE"><img src="../assets/brand/emblem.webp" alt="" width="46" height="26"><span>4FLORENTINE</span></a>
    <button class="icon-btn" type="button" data-act="cycle-lang" aria-label="${t('language')}">${S.lang === 'he' ? 'עב' : S.lang.toUpperCase()}</button>
    <button class="icon-btn" type="button" data-act="account" aria-label="${t('account')}">${icon('user', 'ic-sm')}</button>
  </header>`;
}

function tabbar(active) {
  const item = (key, ic, txt, href) => `<a class="tab" href="${href}" ${active === key ? 'aria-current="page"' : ''}>${icon(ic)}<span>${txt}</span></a>`;
  return `<div class="tabbar"><nav aria-label="${t('navLabel')}">
    ${item('home', 'home', t('tabHome'), '#/home')}
    ${item('requests', 'inbox', t('tabRequests'), '#/requests')}
    <a class="tab fab" href="#/new" ${active === 'new' ? 'aria-current="page"' : ''}><span class="ic-wrap">${icon('plus')}</span><span>${t('tabReport')}</span></a>
    ${item('directory', 'book', t('tabDirectory'), '#/directory')}
    ${item('building', 'building', t('tabBuilding'), '#/building')}
  </nav></div>`;
}

/* ---------- connexion ---------- */
function viewLogin() {
  const L1 = S.login;
  return `<div class="login">
    <div class="login-top">${langSwitch()}</div>
    <main class="login-main">
      <img class="login-logo" src="../assets/brand/logo-512.webp" alt="4FLORENTINE" width="300" height="300">
      <h1>${t('loginTitle')}</h1>
      <p class="lead">${t('loginLead')}</p>
      <form id="loginForm" novalidate>
        <div class="field">
          <span class="label" id="entLbl">${t('chooseEntrance')}</span>
          <div class="entrance-pick" role="group" aria-labelledby="entLbl">
            ${[1, 2, 3, 4].map(tw => `<div class="ent-group">${ENTRANCES.filter(e => e.tower === tw).map(e => `<button type="button" data-act="pick-entrance" data-entrance="${e.id}" aria-pressed="${L1.entrance === e.id}" aria-label="${t('entranceN', { n: e.id })}"><b>${e.id}</b></button>`).join('')}<span>${t('towerN', { n: tw })}</span></div>`).join('')}
          </div>
        </div>
        <div class="field">
          <label for="aptInput">${t('aptNumber')}</label>
          <input class="input" id="aptInput" name="apt" inputmode="numeric" autocomplete="username" maxlength="5" pattern="[0-9]{1,4}[A-Za-z]?" required>
        </div>
        <div class="field">
          <label for="pinInput">${t('pin')}</label>
          <div class="pin-wrap">
            <input class="input" id="pinInput" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" pattern="[0-9]{6}" required>
            <button class="reveal" type="button" data-act="reveal-pin" aria-label="${t('showPin')}">${icon('eye')}</button>
          </div>
        </div>
        ${L1.error ? `<p class="form-error" role="alert">${esc(L1.error)}</p>` : ''}
        <button class="btn btn-gold btn-block" type="submit" ${L1.busy ? 'aria-busy="true" disabled' : ''} style="min-height:54px;font-size:var(--fs-md)">
          ${L1.busy ? `<span class="spinner"></span>${t('signingIn')}` : `${icon('lock', 'ic-sm')}${t('signIn')}`}
        </button>
      </form>
      <details><summary>${t('forgotPin')}</summary><p>${t('forgotPinText')}</p></details>
      <p class="fineprint">${icon('shield')}<span>${t('loginPrivacy')}</span></p>
    </main>
  </div>`;
}
function afterLogin() {
  const f = $('#loginForm'); if (!f) return;
  const apt = sessionStorage.getItem('fl-login-apt'); if (apt) f.apt.value = apt;
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const number = f.apt.value.trim(), pin = f.pin.value.trim();
    sessionStorage.setItem('fl-login-apt', number);
    if (!S.login.entrance) { S.login.error = t('chooseEntrance'); return render(); }
    if (!/^[0-9]{1,4}[A-Za-z]?$/.test(number)) { S.login.error = t('aptNumber') + ' : ' + t('required'); return render(); }
    if (!/^[0-9]{6}$/.test(pin)) { S.login.error = t('pinFormat'); return render(); }
    S.login.busy = true; S.login.error = ''; render();
    try {
      await api.signInApartment(S.login.entrance, number, pin);
      await onSignedIn();
    } catch (e) {
      S.login.error = errMsg(e);
    }
    S.login.busy = false; render();
  });
}
async function onSignedIn() {
  S.session = await api.session();
  S.apt = await api.myApartment();
  if (!S.apt) { await api.signOut(); S.session = null; S.login.error = t('err_no_apartment'); return; }
  sessionStorage.removeItem('fl-login-apt');
  if (!location.hash || location.hash === '#/') location.hash = '#/home';
  loadAll();
  if (!S.unsub && api.subscribeTickets) {
    S.unsub = api.subscribeTickets(async () => {
      await loadTickets();
      const r = route();
      if (r.name === 'requests' && r.id) await loadDetail(r.id);
      render();
    });
  }
}

/* ---------- accueil ---------- */
function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jerusalem' }).format(new Date()));
  return h < 5 ? t('night') : h < 12 ? t('morning') : h < 18 ? t('afternoon') : h < 22 ? t('evening') : t('night');
}
const frameSvg = `<svg class="hero-frame" viewBox="60 40 820 460" aria-hidden="true"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#fff0ac"/><stop offset=".35" stop-color="#c48b2c"/><stop offset=".65" stop-color="#ffdc79"/><stop offset="1" stop-color="#9b5d10"/></linearGradient></defs><path d="M95 270C88 133 205 58 330 94c69 20 95 76 151 80 61 5 96-59 177-51 115 11 174 93 158 192-14 93-94 152-197 135-72-12-92-53-158-53-68 0-92 49-173 48C173 444 101 381 95 270Z" fill="none" stroke="url(#g)" stroke-width="7"/></svg>`;

function shabbatBlock() {
  if (S.shabbatError) return `<div class="shabbat">${'<span class="flame">' + icon('candle') + '</span>'}<div class="s-title">${t('shabbat')}</div><div class="s-times"><span class="s-msg">${t('shabbatError')}</span></div></div>`;
  if (!S.shabbat) return `<div class="shabbat"><span class="flame">${icon('candle')}</span><div class="s-title">${t('shabbat')}</div><div class="s-times"><span class="s-msg">${t('loading')}</span></div></div>`;
  const { candle, havdalah, parasha } = S.shabbat;
  const tm = (d) => fmtDate(d, S.lang, { hour: '2-digit', minute: '2-digit', hour12: false });
  const started = Date.now() >= new Date(candle.date).getTime();
  const pName = parasha ? (S.lang === 'he' ? (parasha.hebrew || '').replace(/^פרשת\s*/, '') : (parasha.title || '').replace(/^Parashat /, '')) : '';
  return `<div class="shabbat">
    <span class="flame">${icon('candle')}</span>
    <div class="s-title">${started ? t('shabbatNow') : t('shabbatIn', { t: relTime(candle.date, S.lang) })}${pName ? `<small>${esc(t('parasha', { p: pName }))}</small>` : ''}</div>
    <div class="s-times"><span>${esc(fmtDate(candle.date, S.lang, { weekday: 'long', day: 'numeric', month: 'short' }))}<b>${tm(candle.date)}</b>${t('candles')}</span>${havdalah ? `<span>${esc(fmtDate(havdalah.date, S.lang, { weekday: 'long', day: 'numeric', month: 'short' }))}<b>${tm(havdalah.date)}</b>${t('havdalah')}</span>` : ''}</div>
    <div class="s-note">${t('shabbatSource')}</div>
  </div>`;
}

function viewHome() {
  const open = (S.tickets || []).filter(x => OPEN_STATUSES.includes(x.status));
  return `
  <section class="hero"><div class="hero-inner">
    ${frameSvg}
    <h1 class="greet">${greeting()}</h1>
    <div class="where"><span class="chip-dark">${icon('towers')}${t('entranceN', { n: S.apt.entrance })}</span><span class="chip-dark">${icon('home')}${t('aptShort', { n: esc(S.apt.number) })}</span>${S.apt.floor != null ? `<span class="chip-dark">${t('floorN', { n: S.apt.floor })}</span>` : ''}</div>
    ${shabbatBlock()}
  </div></section>
  <div class="cta-report"><button type="button" data-act="goto" data-href="#/new">
    <span class="bubble">${icon('camera', 'ic-lg')}</span>
    <span><strong>${t('report')}</strong><small>${t('reportLead')}</small></span>
    ${icon('chevron-right', 'flip-rtl')}
  </button></div>
  <div class="page"><div class="home-grid">
    <div>
      <section class="section">
        <div class="section-head"><h2>${t('myOpen')}</h2>${open.length ? `<button class="link-btn" data-act="goto" data-href="#/requests">${t('seeAll')}</button>` : ''}</div>
        ${listState(S.tickets, S.ticketsError, () => open.length
          ? `<div class="req-list">${open.slice(0, 3).map(reqCard).join('')}</div>`
          : emptyState('inbox', t('noOpen'), t('noOpenText')), 'tickets')}
      </section>
      ${homeVisits()}
      ${homeVotes()}
      <section class="section">
        <div class="section-head"><h2>${t('services')}</h2></div>
        <div class="services">
          <button class="service" data-act="goto" data-href="#/directory">${icon('book')}<span>${t('directory')}</span></button>
          <button class="service" data-act="goto" data-href="#/building">${icon('building')}<span>${t('buildingInfo')}</span></button>
          <button class="service danger" data-act="goto" data-href="#/building">${icon('phone')}<span>${t('emergency')}</span></button>
        </div>
      </section>
    </div>
    <section class="section">
      <div class="section-head"><h2>${t('announcements')}</h2></div>
      ${listState(S.announcements, S.annError, () => S.announcements.length
        ? S.announcements.slice(0, 6).map(noticeCard).join('')
        : emptyState('megaphone', t('noAnnouncements'), t('noAnnouncementsText')), 'ann')}
    </section>
  </div></div>`;
}

function listState(data, err, ok, kind) {
  if (err) return `<div class="banner banner-error" role="alert">${icon('alert', 'ic-sm')}<div>${errMsg(err)} <button class="link-btn" data-act="reload" data-kind="${kind}">${t('retry')}</button></div></div>`;
  if (!data) return `<div class="req-list"><div class="skel" style="height:86px"></div><div class="skel" style="height:86px"></div></div>`;
  return ok();
}
const emptyState = (ic, title, text, action = '') => `<div class="empty panel">${icon(ic)}<h3>${title}</h3><p>${text}</p>${action}</div>`;

function stepsBar(status) {
  if (status === 'cancelled') return `<div class="steps cancelled"><i></i><i></i><i></i><i></i></div>`;
  if (['resolved', 'closed'].includes(status)) return `<div class="steps done"><i></i><i></i><i></i><i></i></div>`;
  const idx = status === 'waiting' ? 2 : RESIDENT_STEPS.indexOf(status);
  return `<div class="steps">${RESIDENT_STEPS.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`;
}
function reqCard(x) {
  return `<button class="req" type="button" data-act="goto" data-href="#/requests/${x.id}">
    <span class="cat">${icon(iconOf(CATEGORIES, x.category))}</span>
    <span class="top"><span class="ref">${esc(x.ref)}</span><span class="badge st-${x.status}">${L(STATUSES, x.status)}</span></span>
    <h3>${esc(x.title)}</h3>
    <span class="meta">${x.area && x.area !== 'apartment' ? esc(L(AREAS, x.area)) + (x.entrance ? ' · ' + t('entranceN', { n: x.entrance }) : '') + ' · ' : ''}${t('updated', { t: relTime(x.updated_at, S.lang) })}</span>
    <span style="grid-column:2">${stepsBar(x.status)}</span>
  </button>`;
}
function annText(a) {
  const tr = a.translations?.[S.lang];
  return { title: tr?.title || a.title, body: tr?.body || a.body };
}
function noticeCard(a) {
  const { title, body } = annText(a);
  return `<article class="notice ${a.pinned ? 'pinned' : ''} ${a.category === 'urgent' ? 'urgent' : ''}">
    <div class="n-meta">${a.pinned ? icon('pin', 'ic-sm') : icon('megaphone', 'ic-sm')}<span>${esc(fmtDate(a.starts_at, S.lang, { day: 'numeric', month: 'long' }))}</span>${a.entrance ? `<span>${t('entranceN', { n: a.entrance })}</span>` : a.tower_id ? `<span>${t('towerN', { n: a.tower_id })}</span>` : ''}</div>
    <h3>${esc(title)}</h3><p>${esc(body)}</p>
  </article>`;
}

/* ---------- mes demandes ---------- */
function viewRequests() {
  const all = S.tickets || [];
  const open = all.filter(x => OPEN_STATUSES.includes(x.status));
  const done = all.filter(x => !OPEN_STATUSES.includes(x.status));
  const list = S.reqTab === 'open' ? open : done;
  return `<div class="page">
    <div class="page-head"><h1>${t('requests')}</h1></div>
    <div class="toolbar">
      <div class="seg" role="group">
        <button type="button" data-act="req-tab" data-tab="open" aria-pressed="${S.reqTab === 'open'}">${t('ongoing')} (${open.length})</button>
        <button type="button" data-act="req-tab" data-tab="done" aria-pressed="${S.reqTab === 'done'}">${t('finished')} (${done.length})</button>
      </div>
      <button class="btn btn-night btn-sm" data-act="goto" data-href="#/new">${icon('plus', 'ic-sm')}${t('newRequest')}</button>
    </div>
    ${listState(S.tickets, S.ticketsError, () => list.length
      ? `<div class="req-list">${list.map(reqCard).join('')}</div>`
      : S.reqTab === 'open' ? emptyState('inbox', t('noOpen'), t('noOpenText'), `<button class="btn btn-gold" data-act="goto" data-href="#/new">${icon('camera', 'ic-sm')}${t('report')}</button>`)
      : emptyState('check', t('noFinished'), t('noFinishedText')), 'tickets')}
  </div>`;
}

function viewDetail() {
  const r = route();
  if (S.detailError) return `<div class="page"><div class="detail-head"><button class="back" data-act="goto" data-href="#/requests">${icon('chevron-left', 'flip-rtl')}${t('back')}</button></div>${listState(null, S.detailError, () => '', 'detail')}</div>`;
  if (!S.detail || S.detail.ticket.id !== r.id) {
    loadDetail(r.id).then(render);
    return `<div class="page"><div class="detail-head"><div class="skel" style="height:28px;width:60%"></div></div><div class="skel" style="height:220px;margin-top:20px"></div></div>`;
  }
  const { ticket: x, events, photos } = S.detail;
  const doneStatus = ['resolved', 'closed'].includes(x.status);
  const idx = doneStatus ? 3 : x.status === 'waiting' ? 2 : RESIDENT_STEPS.indexOf(x.status);
  return `<div class="page">
    <div class="detail-head">
      <button class="back" data-act="goto" data-href="#/requests">${icon('chevron-left', 'flip-rtl')}${t('requests')}</button>
      <h1>${esc(x.title)}</h1>
      <div class="row"><span class="badge st-${x.status}">${L(STATUSES, x.status)}</span><span class="badge no-dot pr-normal">${esc(x.ref)}</span>${x.priority === 'urgent' ? `<span class="badge pr-urgent">${t('urgent')}</span>` : ''}</div>
    </div>
    ${x.status === 'cancelled' ? '' : `<section class="section" aria-label="${t('progress')}"><div class="tracker">
      ${RESIDENT_STEPS.map((s, i) => `<div class="stp ${i <= idx ? 'on' : ''}"><span class="bullet">${i <= idx ? icon('check') : ''}</span><span>${L(STATUSES, s)}</span></div>`).join('')}
    </div></section>`}
    <section class="section"><div class="section-head"><h2>${t('information')}</h2></div><div class="panel"><dl class="facts">
      <div><dt>${t('category')}</dt><dd>${L(CATEGORIES, x.category)}</dd></div>
      <div><dt>${t('created')}</dt><dd>${esc(fmtDateTime(x.created_at, S.lang))}</dd></div>
      <div><dt>${t('location')}</dt><dd>${x.area && x.area !== 'apartment' ? L(AREAS, x.area) : x.location === 'common' ? t('commonArea') : t('inMyApt')}</dd></div>
      <div><dt>${t('entrance')}</dt><dd>${x.entrance ? t('entranceN', { n: x.entrance }) : isParking(x.area) ? t('allTowers') : '—'}${x.floor != null ? ' / ' + t('floorN', { n: x.floor }) : ''}</dd></div>
      ${x.location_detail ? `<div class="wide"><dt>${t('locationDetail')}</dt><dd>${esc(x.location_detail)}</dd></div>` : ''}
      ${x.description ? `<div class="wide"><dt>${t('details')}</dt><dd class="text">${esc(x.description)}</dd></div>` : ''}
    </dl>
    <div style="margin-top:16px"><div class="label" style="font-size:var(--fs-xs);color:var(--ink-3);margin-bottom:8px">${t('photos')}</div>
      <div class="thumbs">${photos.map(p => S.photoUrls[p.path] ? `<a class="thumb" href="${esc(S.photoUrls[p.path])}" target="_blank" rel="noopener"><img src="${esc(S.photoUrls[p.path])}" alt="" loading="lazy"></a>` : `<span class="thumb skel"></span>`).join('')}
        ${OPEN_STATUSES.includes(x.status) && photos.length < 8 ? `<label class="add-photo" aria-label="${t('addMorePhotos')}">${icon('camera')}<input type="file" accept="image/*" hidden data-act-change="detail-photo" data-id="${x.id}"></label>` : ''}
      </div></div>
    </div></section>
    <section class="section"><div class="section-head"><h2>${t('history')}</h2></div>
      <ol class="timeline">${events.map(evRow).join('')}</ol>
      ${OPEN_STATUSES.includes(x.status) ? `<form class="comment-box" data-form="comment" data-id="${x.id}">
        <label class="sr-only" for="cmt">${t('comment')}</label>
        <textarea class="textarea" id="cmt" name="body" maxlength="2000" placeholder="${t('commentPh')}" required style="min-height:84px"></textarea>
        <div class="btn-row"><button class="btn btn-night" type="submit">${icon('send', 'ic-sm flip-rtl')}${t('sendComment')}</button>
        ${x.status === 'new' ? `<button class="btn btn-danger" type="button" data-act="cancel-ticket" data-id="${x.id}">${t('cancelRequest')}</button>` : ''}</div>
      </form>` : ''}
    </section>
  </div>`;
}
function evRow(e) {
  let title = '';
  if (e.kind === 'created') title = t('ev_created');
  else if (e.kind === 'status') title = t('ev_status', { v: L(STATUSES, e.to_value) });
  else if (e.kind === 'comment') title = e.actor_kind === 'staff' ? t('ev_comment_staff') : t('ev_comment_resident');
  else if (e.kind === 'photo') title = t('ev_photo');
  else return '';
  return `<li><span class="dot ${e.actor_kind === 'staff' ? '' : 'night'}"></span>
    <div class="t-title">${title}</div><div class="t-meta">${esc(fmtDateTime(e.created_at, S.lang))}</div>
    ${e.kind === 'comment' && e.body ? `<div class="t-body">${esc(e.body)}</div>` : ''}</li>`;
}

/* ---------- nouvelle demande ---------- */
function newDraft() { return { location: 'apartment', area: 'apartment', entrance: S.apt?.entrance || 1, floor: '', detail: '', category: '', title: '', description: '', urgent: false, files: [], errors: {}, busy: false }; }

/* Encadrés d'aide affichés selon la catégorie choisie */
function municipalBlock() {
  const pf = devicePlatform();
  const store = (os) => `<a class="btn ${pf === os ? 'btn-gold' : 'btn-line'} btn-sm" href="${MUNICIPAL_106[os]}" target="_blank" rel="noopener">${icon('smartphone', 'ic-sm')}${t(os === 'ios' ? 'store_ios' : 'store_android')}</a>`;
  const steps = pf === 'ios' ? 'muniStepsIos' : pf === 'android' ? 'muniStepsAndroid' : 'muniStepsAny';
  return `<div class="btn-row" style="margin-top:10px">${pf === 'android' ? store('android') + store('ios') : store('ios') + store('android')}</div>
    <ol class="guide-steps">${t(steps).split('|').map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <div class="btn-row"><a class="btn btn-line btn-sm" href="${MUNICIPAL_106.whatsapp}" target="_blank" rel="noopener">${icon('message', 'ic-sm')}WhatsApp 106+</a>
      <a class="btn btn-line btn-sm" href="${MUNICIPAL_106.web}" target="_blank" rel="noopener">${icon('globe', 'ic-sm')}${t('muniWeb')}</a>
      <a class="btn btn-line btn-sm" href="tel:${encodeURIComponent(MUNICIPAL_106.phone)}" dir="ltr">${icon('phone', 'ic-sm')}${MUNICIPAL_106.phone}</a></div>`;
}
function categoryGuide(cat) {
  if (cat === 'beggars') return `<div class="guide guide-city">${icon('hand')}<div><strong>${t('guideBeggarsTitle')}</strong><p>${t('guideBeggarsText')}</p>${municipalBlock()}<p class="hint">${t('guideStillReport')}</p></div></div>`;
  if (cat === 'noise_works') return `<div class="guide">${icon('hammer')}<div><strong>${t('guideWorksTitle')}</strong><p>${t('guideWorksText')}</p><details><summary>${t('guideWorksCity')}</summary>${municipalBlock()}</details></div></div>`;
  if (cat === 'odor') return `<div class="guide guide-danger">${icon('alert')}<div><strong>${t('guideGasTitle')}</strong><p>${t('guideGasText')}</p><a class="btn btn-danger btn-sm" href="tel:102">${icon('phone', 'ic-sm')}102</a></div></div>`;
  if (cat === 'alarm') return `<div class="guide guide-danger">${icon('alert')}<div><strong>${t('guideFireTitle')}</strong><p>${t('guideFireText')}</p><a class="btn btn-danger btn-sm" href="tel:102">${icon('phone', 'ic-sm')}102</a></div></div>`;
  if (cat === 'robotic_parking') return `<div class="guide">${icon('robot')}<div><strong>${L(AREAS, 'parking_1')}</strong><p>${t('guideRobotText')}</p></div></div>`;
  if (cat === 'parking_gate') return `<div class="guide">${icon('gate')}<div><strong>${L(AREAS, 'parking_2')}</strong><p>${t('guideGateText')}</p></div></div>`;
  return '';
}
function viewNew() {
  const d = S.draft || (S.draft = newDraft());
  const fixedArea = CATEGORY_AREA[d.category];
  const area = AREAS.find(a => a.key === d.area) || AREAS[0];
  return `<div class="page form-page">
    <div class="page-head"><h1>${t('newRequest')}</h1><p>${t('reportLead')}</p></div>
    <form id="newForm" novalidate>
      <div class="form-step"><h2><span class="n">1</span>${t('whatKind')}</h2>
        <div class="cat-grid" role="group">${CATEGORIES.filter(c => !c.hidden).map(c => `<button type="button" data-act="cat" data-cat="${c.key}" aria-pressed="${d.category === c.key}">${icon(c.icon)}<span>${c[S.lang]}</span></button>`).join('')}</div>
        ${d.errors.category ? `<p class="form-error" role="alert" style="margin-top:8px">${t('chooseCategory')}</p>` : ''}
        ${categoryGuide(d.category)}
      </div>
      <div class="form-step"><h2><span class="n">2</span>${t('where')}</h2>
        ${fixedArea ? `<div class="choice" aria-pressed="true" style="cursor:default">${icon('car')}<span>${L(AREAS, fixedArea)}<br><small style="color:var(--ink-3);font-weight:400">${t('sharedParking')}</small></span></div>` : `
        <div class="choice-2" role="group">
          <button type="button" class="choice" data-act="loc" data-loc="apartment" aria-pressed="${d.location === 'apartment'}">${icon('home')}<span>${t('inMyApt')}<br><small style="color:var(--ink-3);font-weight:400">${t('entranceN', { n: S.apt.entrance })}, ${t('aptShort', { n: esc(S.apt.number) })}</small></span></button>
          <button type="button" class="choice" data-act="loc" data-loc="common" aria-pressed="${d.location === 'common'}">${icon('building')}<span>${t('commonArea')}</span></button>
        </div>
        ${d.location === 'common' ? `
        <div class="area-grid" role="group" aria-label="${t('whichArea')}">${COMMON_AREAS.map(a => `<button type="button" data-act="area" data-area="${a.key}" aria-pressed="${d.area === a.key}">${icon(a.icon)}<span>${a[S.lang]}</span></button>`).join('')}</div>
        ${d.errors.area ? `<p class="form-error" role="alert" style="margin-top:8px">${t('chooseArea')}</p>` : ''}
        ${isParking(d.area) ? `<p class="hint" style="margin-top:8px">${t('sharedParking')}</p>` : d.area && d.area !== 'apartment' ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          <div class="field"><label for="fEntrance">${t('entrance')}</label><select class="select" id="fEntrance" name="entrance">${ENTRANCES.map(e => `<option value="${e.id}" ${Number(d.entrance) === e.id ? 'selected' : ''}>${t('entranceN', { n: e.id })}</option>`).join('')}</select></div>
          ${area.key === 'stairs' || area.key === 'other' ? `<div class="field"><label for="fFloor">${t('floor')}</label><input class="input" id="fFloor" name="floor" inputmode="numeric" value="${esc(d.floor)}" maxlength="3"></div>` : '<span></span>'}
        </div>` : ''}
        ${d.area && d.area !== 'apartment' ? `<div class="field" style="margin-top:4px"><label for="fDetail">${t('locationDetail')}</label><input class="input" id="fDetail" name="detail" maxlength="120" value="${esc(d.detail)}" placeholder="${t(isParking(d.area) ? 'locationDetailParkingPh' : 'locationDetailPh')}"></div>` : ''}` : ''}`}
      </div>
      <div class="form-step"><h2><span class="n">3</span>${t('details')}</h2>
        <div class="field"><label for="fTitle">${t('title')}</label><input class="input" id="fTitle" name="title" maxlength="120" value="${esc(d.title)}" placeholder="${t(d.category === 'noise_works' ? 'titleWorksPh' : 'titlePh')}" ${d.errors.title ? 'aria-invalid="true"' : ''} required>${d.errors.title ? `<span class="form-error">${t('required')}</span>` : ''}</div>
        <div class="field"><label for="fDesc">${t('details')}</label><textarea class="textarea" id="fDesc" name="description" maxlength="2000" placeholder="${t(d.category === 'noise_works' ? 'detailsWorksPh' : 'detailsPh')}">${esc(d.description)}</textarea></div>
        <label class="urgent-toggle"><input type="checkbox" name="urgent" ${d.urgent ? 'checked' : ''}><span><strong>${t('urgent')}</strong><small>${t('urgentHint')}</small></span></label>
      </div>
      <div class="form-step"><h2><span class="n">4</span>${t('photos')}</h2>
        <div class="thumbs">
          ${d.files.map((f, i) => `<span class="thumb"><img src="${f.url}" alt=""><button type="button" data-act="rm-photo" data-i="${i}" aria-label="${t('close')}">${icon('x', 'ic-sm')}</button></span>`).join('')}
          ${d.files.length < 4 ? `<label class="add-photo" aria-label="${t('addPhoto')}">${icon('camera')}<input type="file" accept="image/*" multiple hidden id="fPhotos"></label>` : ''}
        </div>
        <p class="hint" style="margin-top:8px">${t('photoHint')}</p>
      </div>
      ${d.error ? `<div class="banner banner-error" role="alert" style="margin-top:16px">${icon('alert', 'ic-sm')}<span>${esc(d.error)}</span></div>` : ''}
      <div class="sticky-submit"><button class="btn btn-gold btn-block" type="submit" style="min-height:54px" ${d.busy ? 'aria-busy="true" disabled' : ''}>${d.busy ? `<span class="spinner"></span>${t('sending')}` : `${icon('send', 'ic-sm flip-rtl')}${t('send')}`}</button></div>
    </form>
  </div>`;
}
function captureDraft() {
  const f = $('#newForm'); if (!f || !S.draft) return;
  const d = S.draft;
  d.title = f.title.value; d.description = f.description.value; d.urgent = f.urgent.checked;
  if (f.entrance) d.entrance = f.entrance.value;
  if (f.floor) d.floor = f.floor.value;
  if (f.detail) d.detail = f.detail.value;
}
function bindNewForm() {
  const f = $('#newForm'); if (!f) return;
  const photos = $('#fPhotos');
  if (photos) photos.addEventListener('change', () => {
    captureDraft();
    for (const file of Array.from(photos.files).slice(0, 4 - S.draft.files.length)) S.draft.files.push({ file, url: URL.createObjectURL(file) });
    render();
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); captureDraft();
    const d = S.draft; d.errors = {}; d.error = '';
    if (!d.category) d.errors.category = true;
    const area = CATEGORY_AREA[d.category] || (d.location === 'apartment' ? 'apartment' : d.area);
    if (d.location === 'common' && !CATEGORY_AREA[d.category] && (!area || area === 'apartment')) d.errors.area = true;
    if (d.title.trim().length < 3) d.errors.title = true;
    if (Object.keys(d.errors).length) { render(); return; }
    d.busy = true; render();
    const common = area !== 'apartment';
    const payload = {
      location: common ? 'common' : 'apartment', area, category: d.category, title: d.title.trim(),
      description: d.description.trim() || null, priority: d.urgent ? 'urgent' : 'normal',
      entrance: !common ? S.apt.entrance : isParking(area) ? null : Number(d.entrance),
      floor: common && d.floor !== '' && !isNaN(Number(d.floor)) ? Number(d.floor) : null,
      location_detail: common ? (d.detail.trim() || null) : null,
      apartment_id: S.apt.id,
    };
    try {
      const res = await api.createTicket(payload, d.files.map(x => x.file));
      d.files.forEach(x => URL.revokeObjectURL(x.url));
      S.sent = res; S.draft = null;
      await loadTickets();
    } catch (e) { d.error = errMsg(e); }
    d.busy = false; render(); window.scrollTo(0, 0);
  });
}
function viewSent() {
  const { ticket, photoErrors } = S.sent;
  return `<div class="page"><div class="sent">
    <span class="seal">${icon('check')}</span>
    <h1>${t('sentTitle')}</h1>
    <p>${esc(t('sentText', { ref: ticket.ref }))}</p>
    ${photoErrors ? `<div class="banner banner-warn">${icon('alert', 'ic-sm')}<span>${esc(t('photoPartial', { n: photoErrors }))}</span></div>` : ''}
    <div class="btn-row" style="justify-content:center;margin-top:8px">
      <button class="btn btn-gold" data-act="sent-track" data-id="${ticket.id}">${t('track')}</button>
      <button class="btn btn-line" data-act="sent-home">${t('backHome')}</button>
    </div>
  </div></div>`;
}

/* ---------- annuaire ---------- */
function stars(avg, n) {
  const full = Math.round(Number(avg) || 0);
  return `<span class="stars" aria-label="${Number(avg).toFixed(1)} / 5">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= full ? '' : 'off'}">${icon('star')}</span>`).join('')}</span><span>${t('recommendations', { n })}</span>`;
}
function viewDirectory() {
  const q = S.dirQuery.trim().toLowerCase();
  const data = (S.directory || []).filter(e => (!S.dirTrade || e.trade === S.dirTrade)
    && (!q || e.name.toLowerCase().includes(q) || L(TRADES, e.trade).toLowerCase().includes(q) || (e.notes || '').toLowerCase().includes(q) || (e.area || '').toLowerCase().includes(q)));
  const used = new Set((S.directory || []).map(e => e.trade));
  return `<div class="page">
    <div class="page-head"><h1>${t('dirTitle')}</h1><p>${t('dirLead')}</p></div>
    <div class="search" style="margin-top:14px">${icon('search')}<label class="sr-only" for="dirQ">${t('search')}</label><input class="input" id="dirQ" type="search" value="${esc(S.dirQuery)}" placeholder="${t('search')}" autocomplete="off"></div>
    <div class="chips" role="group">
      <button class="chip" data-act="trade" data-trade="" aria-pressed="${!S.dirTrade}">${t('all')}</button>
      ${TRADES.filter(x => used.has(x.key)).map(x => `<button class="chip" data-act="trade" data-trade="${x.key}" aria-pressed="${S.dirTrade === x.key}">${icon(x.icon)}${x[S.lang]}</button>`).join('')}
    </div>
    <div style="margin-top:10px"><button class="btn btn-night btn-block" data-act="entry-form">${icon('plus', 'ic-sm')}${t('addPro')}</button></div>
    <div id="dirResults">${listState(S.directory, S.dirError, () => data.length ? `<div class="pro-list">${data.map(proRow).join('')}</div>` : emptyState('search', t('noResults'), t('noResultsText')), 'dir')}</div>
  </div>`;
}
function proRow(e) {
  return `<article class="pro ${e.status === 'obsolete' ? 'obsolete' : ''}">
    <button class="p-main" data-act="entry" data-id="${e.id}">
      <h3>${esc(e.name)}</h3>
      <div class="p-meta"><span class="p-trade">${L(TRADES, e.trade)}</span>${Number(e.reco_count) ? stars(e.avg_rating, e.reco_count) : `<span>${t('noReco')}</span>`}
        ${e.status === 'obsolete' ? `<span class="badge st-cancelled">${t('obsolete')}</span>` : ''}${e.source === 'legacy' ? `<span class="badge no-dot st-closed">${t('legacy')}</span>` : ''}</div>
    </button>
    ${e.phone ? `<a class="call-btn" href="tel:${esc(e.phone.replace(/[^0-9+]/g, ''))}" aria-label="${t('call')} ${esc(e.name)}">${icon('phone')}</a>` : `<span class="call-btn off" title="${t('noPhone')}">${icon('phone')}</span>`}
  </article>`;
}

/* ---------- votes de la copropriété ---------- */
const aptFromLabel = (l) => { const m = /^E(\d+)-(.+)$/.exec(l || ''); return m ? `${t('entranceN', { n: m[1] })} · ${t('aptShort', { n: esc(m[2]) })}` : esc(l || ''); };
const voteText = (v) => ({ title: v.translations?.[S.lang]?.title || v.title, body: v.translations?.[S.lang]?.body || v.body });
const isOpen = (v) => v.status === 'open' && (!v.opens_at || new Date(v.opens_at) <= new Date()) && (!v.closes_at || new Date(v.closes_at) > new Date());
const myBallot = (voteId, apt = S.apt.id) => S.ballots.find(b => b.vote_id === voteId && b.apartment_id === apt);
const heldProxies = (voteId) => S.proxies.filter(p => p.direction === 'received' && p.status === 'active' && (!p.vote_id || p.vote_id === voteId) && (!p.valid_until || new Date(p.valid_until) > new Date()));

function homeVotes() {
  if (!S.votes) return '';
  const open = S.votes.filter(isOpen);
  const asks = S.proxies.filter(p => p.direction === 'received' && p.status === 'pending');
  if (!open.length && !asks.length) return '';
  return `<section class="section"><div class="section-head"><h2>${t('votes')}</h2><button class="link-btn" data-act="goto" data-href="#/votes">${t('seeAll')}</button></div>
    ${asks.length ? `<button class="vote-card ask" data-act="goto" data-href="#/votes">${icon('users')}<span><strong>${t('proxyAsks', { n: asks.length })}</strong><small>${t('proxyAsksHint')}</small></span>${icon('chevron-right', 'flip-rtl')}</button>` : ''}
    ${open.map(voteCard).join('')}</section>`;
}
function voteCard(v) {
  const b = myBallot(v.id), o = b && (v.vote_options || []).find(x => x.id === b.option_id);
  const { title } = voteText(v);
  return `<button class="vote-card" data-act="goto" data-href="#/votes/${v.id}">${icon('vote')}
    <span><strong>${esc(title)}</strong><small>${isOpen(v) ? (v.closes_at ? t('closesOn', { d: esc(fmtDateTime(v.closes_at, S.lang)) }) : t('voteOpen')) : t('voteClosedOn', { d: esc(fmtDate(v.closed_at || v.closes_at, S.lang, { day: 'numeric', month: 'long', year: 'numeric' })) })}</small></span>
    ${isOpen(v) ? (b ? `<span class="badge st-resolved">${t('voted')}</span>` : `<span class="badge st-progress st-in_progress">${t('toVote')}</span>`) : voteOutcomeBadge(v)}
  </button>`;
}
function voteOutcomeBadge(v) {
  const s = S.summaries[v.id];
  if (s === undefined) { loadSummary(v.id).then(render); return ''; }
  if (!s || s.hidden) return '';
  if (s.passed === true) return `<span class="badge st-resolved">${t('adopted')}</span>`;
  if (s.passed === false) return `<span class="badge st-cancelled">${t('notAdopted')}</span>`;
  return `<span class="badge st-closed">${t('results')}</span>`;
}
function proxyRow(p) {
  const who = aptFromLabel(p.other_label);
  const pv = p.vote_id && (S.votes || []).find(v => v.id === p.vote_id);
  const scope = p.vote_id ? esc(pv ? voteText(pv).title : (p.vote_title || '')) : (p.valid_until ? t('allVotesUntil', { d: esc(fmtDate(p.valid_until, S.lang, { day: 'numeric', month: 'long', year: 'numeric' })) }) : t('allVotes'));
  const st = { pending: p.direction === 'given' ? t('pp_pending_given') : t('pp_pending_received'), awaiting_approval: t('pp_awaiting'), active: t('pp_active'), rejected: t('pp_rejected') }[p.status];
  const badge = { pending: 'st-new', awaiting_approval: 'st-waiting', active: 'st-resolved', rejected: 'st-cancelled' }[p.status];
  const acts = p.direction === 'received' && p.status === 'pending'
    ? `<button class="btn btn-gold btn-sm" data-act="proxy-accept" data-id="${p.id}">${t('accept')}</button><button class="btn btn-line btn-sm" data-act="proxy-refuse" data-id="${p.id}">${t('refuse')}</button>`
    : p.direction === 'given' && p.status !== 'rejected' ? `<button class="btn btn-ghost btn-sm" data-act="proxy-revoke" data-id="${p.id}">${t('revoke')}</button>` : '';
  return `<div class="proxy-row"><div class="pr-main"><strong>${p.direction === 'given' ? t('givenTo', { apt: who }) : t('receivedFrom', { apt: who })}</strong>
      <small>${scope}</small>${p.rejected_reason ? `<small class="form-error" style="margin:2px 0 0">${esc(p.rejected_reason)}</small>` : ''}</div>
    <span class="badge ${badge}">${st}</span>${acts ? `<div class="btn-row" style="grid-column:1/-1">${acts}</div>` : ''}</div>`;
}
function viewVotes() {
  if (!S.votes) { loadVotes().then(render); return `<div class="page"><div class="skel" style="height:200px;margin-top:24px"></div></div>`; }
  const open = S.votes.filter(isOpen), closed = S.votes.filter(v => !isOpen(v) && v.status !== 'draft');
  return `<div class="page">
    <div class="page-head"><h1>${t('votes')}</h1><p>${t('votesLead')}</p></div>
    ${S.votesError ? listState(null, S.votesError, () => '', 'votes') : ''}
    <section class="section"><div class="section-head"><h2>${t('openVotes')}</h2></div>
      ${open.length ? open.map(voteCard).join('') : emptyState('vote', t('noOpenVotes'), t('noOpenVotesText'))}</section>
    <section class="section"><div class="section-head"><h2>${t('proxies')}</h2><button class="link-btn" data-act="proxy-form">${icon('plus', 'ic-sm')}${t('giveProxy')}</button></div>
      <p class="hint" style="margin:-4px 0 12px">${t('proxyHow')}</p>
      ${S.proxies.length ? `<div class="panel" style="padding:4px 16px">${S.proxies.map(proxyRow).join('')}</div>` : emptyState('users', t('noProxies'), t('noProxiesText'))}</section>
    ${closed.length ? `<section class="section"><div class="section-head"><h2>${t('closedVotes')}</h2></div>${closed.map(voteCard).join('')}</section>` : ''}
  </div>`;
}
function ballotForm(v, apartment, label, saved) {
  const opts = v.vote_options || [];
  const key = `${v.id}:${apartment || 'me'}`;
  const current = S.picks[key] ?? saved;
  return `<form class="ballot" data-form="ballot" data-vote="${v.id}" data-apt="${apartment || ''}">
    ${label ? `<div class="ballot-for">${label}</div>` : ''}
    <div class="ballot-opts" role="radiogroup">${opts.map(o => `<label class="ballot-opt k-${o.kind}"><input type="radio" name="opt" value="${o.id}" data-pick="${key}" ${current === o.id ? 'checked' : ''} required><span>${esc(optionText(o, S.lang))}</span></label>`).join('')}</div>
    <button class="btn btn-night btn-block" type="submit">${icon('check', 'ic-sm')}${saved ? t('changeVote') : t('castVote')}</button>
  </form>`;
}
function resultsBlock(v) {
  const s = S.summaries[v.id];
  if (s === undefined) { loadSummary(v.id).then(render); return `<div class="skel" style="height:120px"></div>`; }
  if (!s || s.hidden) return `<p class="hint">${t('resultsHidden')}</p>`;
  const total = Math.max(Number(s.cast_weight) || 0, 0.0001);
  return `<div class="panel">
    ${s.passed === true ? `<div class="outcome ok">${icon('check')}${t('adopted')}</div>` : s.passed === false ? `<div class="outcome ko">${icon('x')}${t('notAdopted')}</div>` : ''}
    ${s.options.map(o => `<div class="res-row"><span>${esc(optionText(o, S.lang))}</span><span class="bar"><i style="width:${(Number(o.weight) / total) * 100}%"></i></span><b>${o.count}</b></div>`).join('')}
    <p class="hint" style="margin:10px 0 0">${t('participation', { n: s.cast_count, m: s.eligible_count })} · ${L(VOTE_RULES, s.rule)}${s.weighted ? ' · ' + t('weightedNote') : ''}</p>
  </div>`;
}
function viewVoteDetail(id) {
  if (!S.votes) { loadVotes().then(render); return `<div class="page"><div class="skel" style="height:240px;margin-top:24px"></div></div>`; }
  const v = S.votes.find(x => x.id === id);
  if (!v) return `<div class="page">${emptyState('vote', t('noOpenVotes'), '')}</div>`;
  const { title, body } = voteText(v);
  const open = isOpen(v), mine = myBallot(v.id);
  const held = open && v.allow_proxies ? heldProxies(v.id) : [];
  return `<div class="page">
    <div class="detail-head"><button class="back" data-act="goto" data-href="#/votes">${icon('chevron-left', 'flip-rtl')}${t('votes')}</button>
      <h1>${esc(title)}</h1>
      <div class="row">${open ? `<span class="badge st-in_progress">${t('voteOpen')}</span>` : `<span class="badge st-closed">${t('voteClosed')}</span>`}
        ${v.secret ? `<span class="badge no-dot st-assigned">${t('secretNote')}</span>` : ''}</div></div>
    ${body ? `<div class="panel" style="white-space:pre-wrap;margin-top:12px">${esc(body)}</div>` : ''}
    <dl class="facts panel" style="margin-top:12px">
      <div><dt>${t('ruleLabel')}</dt><dd>${L(VOTE_RULES, v.rule)}${v.weighted ? `<br><small style="font-weight:400;color:var(--ink-3)">${t('weightedNote')}</small>` : ''}</dd></div>
      <div><dt>${open ? t('closesLabel') : t('voteClosed')}</dt><dd>${(open ? v.closes_at : (v.closed_at || v.closes_at)) ? esc(fmtDateTime(open ? v.closes_at : (v.closed_at || v.closes_at), S.lang)) : '—'}</dd></div>
    </dl>
    ${open ? `<section class="section"><div class="section-head"><h2>${t('myVote')}</h2></div>
      ${mine && mine.method !== 'direct' ? `<p class="hint">${t(mine.method === 'proxy' ? 'votedByProxy' : 'votedAtAssembly')}</p>` : ''}
      ${ballotForm(v, null, '', mine?.option_id)}</section>` : ''}
    ${held.length ? `<section class="section"><div class="section-head"><h2>${t('onBehalfOf')}</h2></div>
      ${held.map(p => ballotForm(v, p.other_apartment, t('voteFor', { apt: aptFromLabel(p.other_label) }), myBallot(v.id, p.other_apartment)?.option_id)).join('')}</section>` : ''}
    <section class="section"><div class="section-head"><h2>${t('results')}</h2></div>${resultsBlock(v)}</section>
  </div>`;
}
function proxySheet() {
  const open = (S.votes || []).filter(v => isOpen(v) && v.allow_proxies);
  openSheet(t('giveProxy'), `<form id="proxyForm" novalidate>
    <p class="hint" style="margin-top:0">${t('proxyHow')}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label for="pxE">${t('entrance')}</label><select class="select" id="pxE">${ENTRANCES.map(e => `<option value="${e.id}">${t('entranceN', { n: e.id })}</option>`).join('')}</select></div>
      <div class="field"><label for="pxN">${t('apartment')}</label><input class="input" id="pxN" inputmode="numeric" maxlength="5" required></div>
    </div>
    <div class="field"><span class="label">${t('proxyScope')}</span>
      <div class="seg" role="group" style="width:100%"><button type="button" data-px="vote" aria-pressed="${open.length ? 'true' : 'false'}" ${open.length ? '' : 'disabled'}>${t('proxyThisVote')}</button><button type="button" data-px="all" aria-pressed="${open.length ? 'false' : 'true'}">${t('proxyAllVotes')}</button></div></div>
    <div class="field" id="pxVoteRow" ${open.length ? '' : 'hidden'}><label for="pxV">${t('votes')}</label><select class="select" id="pxV">${open.map(v => `<option value="${v.id}">${esc(voteText(v).title)}</option>`).join('')}</select></div>
    <div class="field" id="pxUntilRow" ${open.length ? 'hidden' : ''}><label for="pxU">${t('proxyUntil')}</label><input class="input" type="date" id="pxU"></div>
    <p class="form-error" id="pxErr" role="alert"></p>
    <button class="btn btn-gold btn-block" type="submit">${icon('send', 'ic-sm flip-rtl')}${t('sendProxy')}</button></form>`, (ov) => {
    let mode = open.length ? 'vote' : 'all';
    $$('[data-px]', ov).forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.px; $$('[data-px]', ov).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      $('#pxVoteRow', ov).hidden = mode !== 'vote'; $('#pxUntilRow', ov).hidden = mode !== 'all';
    }));
    $('#proxyForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const err = $('#pxErr', ov); err.textContent = '';
      const n = $('#pxN', ov).value.trim();
      if (!/^[0-9]{1,4}[A-Za-z]?$/.test(n)) { err.textContent = t('apartment') + ' : ' + t('required'); return; }
      const until = $('#pxU', ov).value ? new Date($('#pxU', ov).value + 'T23:59:00').toISOString() : null;
      try {
        await api.grantProxy($('#pxE', ov).value, n, mode === 'vote' ? Number($('#pxV', ov).value) : null, mode === 'all' ? until : null);
        toast(t('proxySent')); closeSheet(); await loadVotes(); render();
      } catch (x) { err.textContent = errMsg(x); }
    });
  });
}

/* ---------- prise de rendez-vous ---------- */
const campText = (c) => ({ title: c.translations?.[S.lang]?.title || c.title, body: c.translations?.[S.lang]?.body || c.body });
const campOpen = (c) => c.status === 'open' && (!c.respond_until || new Date(c.respond_until) > new Date());
const myVisit = (id) => S.visitBookings.find(b => b.campaign_id === id);
const visitAnswered = (c) => { const b = myVisit(c.id); return !!b && (b.unavailable || !!b.slot_id); };
const slotDay = (x) => fmtDate(x.starts_at, S.lang, { weekday: 'long', day: 'numeric', month: 'long' });
const slotTime = (x) => `${fmtDate(x.starts_at, S.lang, { hour: '2-digit', minute: '2-digit', hour12: false })}–${fmtDate(x.ends_at, S.lang, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
const slotFull = (x) => `${slotDay(x)} · <bdi>${slotTime(x)}</bdi>`;

function homeVisits() {
  if (!S.visits) return '';
  const todo = S.visits.filter(c => campOpen(c) && !visitAnswered(c));
  const booked = S.visits.filter(c => c.status === 'open' && myVisit(c.id)?.slot_id && (c.visit_slots || []).some(x => x.id === myVisit(c.id).slot_id && new Date(x.ends_at) > new Date()));
  if (!todo.length && !booked.length) return '';
  return `<section class="section"><div class="section-head"><h2>${t('visits')}</h2><button class="link-btn" data-act="goto" data-href="#/visits">${t('seeAll')}</button></div>
    ${[...todo, ...booked].map(visitCard).join('')}</section>`;
}
function visitCard(c) {
  const b = myVisit(c.id), slot = b?.slot_id && (c.visit_slots || []).find(x => x.id === b.slot_id);
  const sub = slot ? t('yourSlot', { d: slotFull(slot) }) : campOpen(c) ? (c.respond_until ? t('respondBy', { d: esc(fmtDateTime(c.respond_until, S.lang)) }) : t('chooseSlot')) : t('visitClosed');
  const badge = slot ? `<span class="badge st-resolved">${t('visitChosen')}</span>` : b?.unavailable ? `<span class="badge st-waiting">${t('visitUnavailableShort')}</span>` : campOpen(c) ? `<span class="badge st-in_progress">${t('visitToChoose')}</span>` : '';
  return `<button class="vote-card${!slot && !b?.unavailable && campOpen(c) ? ' ask' : ''}" data-act="goto" data-href="#/visits/${c.id}">${icon('calendar')}
    <span><strong>${esc(campText(c).title)}</strong><small>${sub}</small></span>${badge}</button>`;
}
function viewVisits() {
  if (!S.visits) { loadVisits().then(render); return `<div class="page"><div class="skel" style="height:200px;margin-top:24px"></div></div>`; }
  const list = S.visits.filter(c => c.status !== 'cancelled');
  return `<div class="page">
    <div class="page-head"><h1>${t('visits')}</h1><p>${t('visitsLead')}</p></div>
    ${S.visitsError ? listState(null, S.visitsError, () => '', 'visits') : ''}
    <section class="section">${list.length ? list.map(visitCard).join('') : emptyState('calendar', t('noVisits'), t('noVisitsText'))}</section>
  </div>`;
}
function viewVisitDetail(id) {
  if (!S.visits) { loadVisits().then(render); return `<div class="page"><div class="skel" style="height:240px;margin-top:24px"></div></div>`; }
  const c = S.visits.find(x => x.id === id);
  if (!c) return `<div class="page">${emptyState('calendar', t('noVisits'), '')}</div>`;
  if (S.visitCounts[id] === undefined) { S.visitCounts[id] = null; loadVisitCounts(id).then(render); }
  const counts = S.visitCounts[id] || {};
  const { title, body } = campText(c);
  const open = campOpen(c), b = myVisit(id);
  const slots = (c.visit_slots || []).filter(x => new Date(x.ends_at) > new Date() || x.id === b?.slot_id);
  const saved = b ? (b.unavailable ? 'none' : b.slot_id || null) : null;
  const pick = S.visitPicks[id] ?? saved;
  const days = []; for (const x of slots) { const d = slotDay(x); let g = days.find(y => y.d === d); if (!g) days.push(g = { d, items: [] }); g.items.push(x); }
  const status = b?.slot_id ? `<div class="banner banner-ok" role="status">${icon('check', 'ic-sm')}<div>${t('yourSlot', { d: slotFull(slots.find(x => x.id === b.slot_id) || (c.visit_slots || []).find(x => x.id === b.slot_id)) })}${b.source === 'staff' ? `<br><small>${t('visitBookedByStaff')}</small>` : ''}</div></div>`
    : b?.unavailable ? `<div class="banner banner-warn" role="status">${icon('alert', 'ic-sm')}<div>${t('youSaidUnavailable')}</div></div>`
    : b ? `<div class="banner banner-warn" role="status">${icon('alert', 'ic-sm')}<div>${t('slotRemoved')}</div></div>` : '';
  return `<div class="page">
    <div class="detail-head"><button class="back" data-act="goto" data-href="#/visits">${icon('chevron-left', 'flip-rtl')}${t('visits')}</button>
      <h1>${esc(title)}</h1>
      <div class="row">${open ? (c.respond_until ? `<span class="badge st-in_progress">${t('respondBy', { d: esc(fmtDateTime(c.respond_until, S.lang)) })}</span>` : '') : `<span class="badge st-closed">${t('visitClosed')}</span>`}</div></div>
    ${body ? `<div class="panel" style="white-space:pre-wrap;margin-top:12px">${esc(body)}</div>` : ''}
    <div style="margin-top:12px">${status}</div>
    ${open ? `<form class="visit-form" data-form="visit" data-id="${id}">
      <section class="section"><div class="section-head"><h2>${t('chooseSlot')}</h2></div>
        ${days.map(g => `<div class="slot-day"><h3>${esc(g.d)}</h3><div class="slot-grid" role="radiogroup">${g.items.map(x => {
          const used = counts[x.id] || 0, left = x.capacity - used + (saved === x.id ? 1 : 0), full = left <= 0;
          return `<label class="slot${full ? ' full' : ''}"><input type="radio" name="slot" value="${x.id}" data-vpick="${id}" ${pick === x.id ? 'checked' : ''} ${full ? 'disabled' : ''}>
            <b><bdi>${slotTime(x)}</bdi></b><small>${saved === x.id ? t('visitChosen') : full ? t('slotFullLabel') : t('slotsLeft', { n: left })}</small></label>`; }).join('')}</div></div>`).join('')}
        <label class="slot slot-none"><input type="radio" name="slot" value="none" data-vpick="${id}" ${pick === 'none' ? 'checked' : ''}><b>${t('noSlotFits')}</b></label>
      </section>
      <div class="field"><label for="vNote">${t('visitNote')}</label><textarea class="textarea" id="vNote" name="note" maxlength="500" rows="2" placeholder="${t('visitNotePh')}" data-vnote="${id}">${esc(S.visitNotes[id] ?? b?.note ?? '')}</textarea></div>
      <button class="btn btn-gold btn-block" type="submit">${icon('check', 'ic-sm')}${b ? t('changeSlot') : t('confirmSlot')}</button>
      ${b ? `<button class="btn btn-ghost btn-block" type="button" style="margin-top:8px" data-act="visit-cancel" data-id="${id}">${t('visitCancel')}</button>` : ''}
    </form>` : ''}
  </div>`;
}

/* ---------- immeuble ---------- */
function viewBuilding() {
  const tw = S.towers.find(x => x.id === S.apt.tower_id) || {};
  const install = S.installEvt ? `<button class="btn btn-gold btn-sm" data-act="install">${icon('download', 'ic-sm')}${t('install')}</button>` : '';
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
  const emerg = [['100', 'police', 'shield'], ['101', 'mda', 'alert'], ['102', 'fire', 'alert'], ['103', 'iec', 'zap'], ['106', 'municipality', 'building']];
  return `<div class="page">
    <div class="page-head"><h1>${t('buildingTitle')}</h1></div>
    <div class="tower-card" style="margin-top:10px"><img src="../assets/brand/emblem.webp" alt="">
      <h2>${t('entranceN', { n: S.apt.entrance })}</h2>
      <p>${t('towerN', { n: S.apt.tower_id })} · ${t('aptShort', { n: esc(S.apt.number) })}${S.apt.floor != null ? ', ' + t('floorN', { n: S.apt.floor }) : ''}${tw.floors ? ', ' + t('floors', { n: tw.floors }) : ''}${tw.address ? '<br>' + esc(tw.address) : ''}</p>
    </div>
    ${tw.notes ? `<div class="panel" style="margin-top:12px;white-space:pre-wrap">${esc(tw.notes)}</div>` : ''}
    <section class="section"><div class="section-head"><h2>${t('shabbat')}</h2></div><div style="background:var(--night-900);border-radius:var(--r-md);padding:2px 12px 12px">${shabbatBlock()}</div></section>
    <section class="section"><div class="section-head"><h2>${t('copro')}</h2></div>
      <div class="info-list"><a class="info-row" href="#/visits">${icon('calendar')}<span class="grow">${t('visits')}<small>${t('visitsLead')}</small></span>${icon('chevron-right', 'flip-rtl')}</a>
        <a class="info-row" href="#/votes">${icon('vote')}<span class="grow">${t('votes')}<small>${t('votesLead')}</small></span>${icon('chevron-right', 'flip-rtl')}</a></div>
    </section>
    <section class="section"><div class="section-head"><h2>${t('emergencyNumbers')}</h2></div>
      <div class="info-list">${emerg.map(([n, k, ic]) => `<a class="info-row" href="tel:${n}">${icon(ic)}<span class="grow">${t(k)}</span><span class="num">${n}</span></a>`).join('')}</div>
    </section>
    <section class="section"><div class="section-head"><h2>${t('installApp')}</h2></div>
      <div class="panel"><p style="margin:0 0 10px;color:var(--ink-2)">${t('installText')}</p>${install}${isIos ? `<p class="hint">${t('iosInstall')}</p>` : ''}</div>
    </section>
    <section class="section"><div class="section-head"><h2>${t('account')}</h2></div>
      <div class="info-list">
        <button class="info-row" style="width:100%;border:0;background:none;cursor:pointer;text-align:start" data-act="account">${icon('key')}<span class="grow">${t('changePin')}<small>${t('sharedAccount')}</small></span>${icon('chevron-right', 'flip-rtl')}</button>
        <button class="info-row" style="width:100%;border:0;border-top:1px solid var(--line);background:none;cursor:pointer;text-align:start;color:var(--danger)" data-act="signout">${icon('logout')}<span class="grow">${t('signOut')}</span></button>
      </div>
    </section>
    <p class="hint" style="text-align:center;margin:28px 0 8px">4FLORENTINE v2</p>
  </div>`;
}

/* ------------------------------------------------------------------ feuilles */
function openSheet(title, html, onMount) {
  closeSheet();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet-grip"></div>
    <div class="sheet-head"><h2 id="sheetTitle">${title}</h2><button class="btn btn-ghost btn-icon" data-act="close-sheet" aria-label="${t('close')}">${icon('x')}</button></div>
    <div class="sheet-body">${html}</div></div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  document.body.append(ov);
  document.body.style.overflow = 'hidden';
  const first = ov.querySelector('input, textarea, select, button:not([data-act="close-sheet"])');
  setTimeout(() => (first || ov.querySelector('button'))?.focus(), 50);
  onMount?.(ov);
  return ov;
}
function closeSheet() { $$('.overlay').forEach(o => o.remove()); document.body.style.overflow = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

function accountSheet() {
  openSheet(t('account'), `
    <div class="panel" style="margin-bottom:16px"><strong>${t('entranceN', { n: S.apt.entrance })}, ${t('aptShort', { n: esc(S.apt.number) })}</strong><p class="hint" style="margin:4px 0 0">${t('sharedAccount')}</p></div>
    <div class="field"><span class="label">${t('language')}</span><div class="seg" role="group">${[['fr', 'Français'], ['he', 'עברית'], ['en', 'English']].map(([k, v]) => `<button type="button" data-act="lang" data-lang="${k}" aria-pressed="${S.lang === k}" lang="${k}">${v}</button>`).join('')}</div></div>
    <form id="pinForm" novalidate>
      <h3 style="font-size:var(--fs-md);margin:18px 0 10px">${t('changePin')}</h3>
      <div class="field"><label for="p1">${t('newPin')}</label><input class="input" id="p1" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="field"><label for="p2">${t('confirmPin')}</label><input class="input" id="p2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <p class="form-error" id="pinErr" role="alert"></p>
      <button class="btn btn-night btn-block" type="submit">${icon('key', 'ic-sm')}${t('changePin')}</button>
    </form>
    <button class="btn btn-danger btn-block" style="margin-top:12px" data-act="signout">${icon('logout', 'ic-sm')}${t('signOut')}</button>
  `, (ov) => {
    ov.querySelector('#pinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = ov.querySelector('#p1').value, b = ov.querySelector('#p2').value, err = ov.querySelector('#pinErr');
      if (!/^[0-9]{6}$/.test(a)) { err.textContent = t('pinFormat'); return; }
      if (a !== b) { err.textContent = t('pinMismatch'); return; }
      try { await api.changeSecret(a); toast(t('pinChanged')); closeSheet(); } catch (x) { err.textContent = errMsg(x); }
    });
  });
}

async function entrySheet(id) {
  const ov = openSheet(t('directory'), `<div class="skel" style="height:160px"></div>`);
  let data;
  try { data = await api.directoryEntry(id); } catch (e) { ov.querySelector('.sheet-body').innerHTML = `<div class="banner banner-error">${icon('alert', 'ic-sm')}${errMsg(e)}</div>`; return; }
  const { entry: e, recos, revisions } = data;
  ov.querySelector('#sheetTitle').textContent = e.name;
  ov.querySelector('.sheet-body').innerHTML = `
    <div class="p-meta" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:var(--fs-sm);color:var(--ink-3)"><span class="p-trade" style="color:var(--gold-700);font-weight:600">${L(TRADES, e.trade)}</span>${Number(e.reco_count) ? stars(e.avg_rating, e.reco_count) : ''}${e.status === 'obsolete' ? `<span class="badge st-cancelled">${t('obsolete')}</span>` : ''}</div>
    <dl class="facts panel" style="margin-top:14px">
      <div class="wide"><dt>${t('phone')}</dt><dd>${e.phone ? `<a href="tel:${esc(e.phone.replace(/[^0-9+]/g, ''))}">${esc(e.phone)}</a>` : `<span style="color:var(--ink-3);font-weight:400">${t('noPhone')}</span>`}</dd></div>
      ${e.area ? `<div><dt>${t('area')}</dt><dd>${esc(e.area)}</dd></div>` : ''}
      ${e.website ? `<div><dt>${t('website')}</dt><dd><a href="${esc(/^https?:/i.test(e.website) ? e.website : 'https://' + e.website)}" target="_blank" rel="noopener nofollow">${esc(e.website)}</a></dd></div>` : ''}
      ${e.notes ? `<div class="wide"><dt>${t('notes')}</dt><dd class="text">${esc(e.notes)}</dd></div>` : ''}
    </dl>
    <div class="btn-row" style="margin-top:14px">
      ${e.phone ? `<a class="btn btn-gold" href="tel:${esc(e.phone.replace(/[^0-9+]/g, ''))}">${icon('phone', 'ic-sm')}${t('call')}</a>` : ''}
      <button class="btn btn-night" data-act="recommend" data-id="${e.id}">${icon('star', 'ic-sm')}${t('recommend')}</button>
      <button class="btn btn-line" data-act="entry-form" data-id="${e.id}">${icon('edit', 'ic-sm')}${t('edit')}</button>
      <button class="btn btn-ghost" data-act="report-entry" data-id="${e.id}">${icon('flag', 'ic-sm')}${t('report2')}</button>
    </div>
    <h3 style="font-size:var(--fs-md);margin:22px 0 4px">${t('recommendations', { n: recos.length })}</h3>
    ${recos.length ? recos.map(r => `<div class="reco"><span class="stars">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= r.rating ? '' : 'off'}">${icon('star')}</span>`).join('')}</span>${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<small class="hint">${esc(relTime(r.created_at, S.lang))}</small></div>`).join('') : `<p class="hint">${t('noReco')}</p>`}
    <h3 style="font-size:var(--fs-md);margin:22px 0 4px">${t('versions')}</h3>
    ${revisions.map((v, i) => `<div class="rev"><div class="r-info"><strong>${t('version', { v: v.version })}</strong> <span class="hint">${t('ch_' + v.change_kind)}</span><small>${esc(fmtDateTime(v.created_at, S.lang))} — ${esc(v.snapshot.name)}${v.snapshot.phone ? ', ' + esc(v.snapshot.phone) : ''}</small></div>
      ${i > 0 ? `<button class="btn btn-line btn-sm" data-act="restore" data-id="${e.id}" data-v="${v.version}">${icon('restore', 'ic-sm')}${t('restore')}</button>` : ''}</div>`).join('')}
  `;
}

function entryFormSheet(id) {
  const e = id ? (S.directory || []).find(x => x.id === id) || {} : {};
  openSheet(id ? t('edit') : t('addPro'), `<form id="entryForm" novalidate>
    <div class="field"><label for="eTrade">${t('trade')}</label><select class="select" id="eTrade" name="trade">${TRADES.map(x => `<option value="${x.key}" ${e.trade === x.key ? 'selected' : ''}>${x[S.lang]}</option>`).join('')}</select></div>
    <div class="field"><label for="eName">${t('name')}</label><input class="input" id="eName" name="name" maxlength="80" required value="${esc(e.name || '')}"></div>
    <div class="field"><label for="ePhone">${t('phone')}</label><input class="input" id="ePhone" name="phone" type="tel" maxlength="20" value="${esc(e.phone || '')}" dir="ltr"></div>
    <label class="check" style="margin-bottom:16px"><input type="checkbox" name="consent" ${e.phone_public_ok ? 'checked' : ''}><span>${t('phoneConsent')}</span></label>
    <div class="field"><label for="eArea">${t('area')}</label><input class="input" id="eArea" name="area" maxlength="80" value="${esc(e.area || '')}"></div>
    <div class="field"><label for="eWeb">${t('website')}</label><input class="input" id="eWeb" name="website" maxlength="200" value="${esc(e.website || '')}" dir="ltr"></div>
    <div class="field"><label for="eNotes">${t('notes')}</label><textarea class="textarea" id="eNotes" name="notes" maxlength="600">${esc(e.notes || '')}</textarea></div>
    <p class="form-error" id="entryErr" role="alert"></p>
    <button class="btn btn-gold btn-block" type="submit">${icon('check', 'ic-sm')}${t('save')}</button>
  </form>`, (ov) => {
    const f = ov.querySelector('#entryForm');
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = ov.querySelector('#entryErr'); err.textContent = '';
      const phone = f.phone.value.trim();
      if (f.name.value.trim().length < 2) { err.textContent = t('name') + ' : ' + t('required'); return; }
      if (phone && !f.consent.checked) { err.textContent = t('phoneConsentNeeded'); return; }
      if (phone && !/^[0-9 +().-]{6,20}$/.test(phone)) { err.textContent = t('phone') + ' ?'; return; }
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await api.saveEntry({ ...(id ? { id } : {}), trade: f.trade.value, name: f.name.value.trim(), phone: phone || null, phone_public_ok: !!phone && f.consent.checked, area: f.area.value.trim() || null, website: f.website.value.trim() || null, notes: f.notes.value.trim() || null });
        toast(t('saved')); closeSheet(); await loadDirectory(); render();
      } catch (x) { err.textContent = errMsg(x); btn.disabled = false; }
    });
  });
}

function recommendSheet(id) {
  let rating = 0;
  openSheet(t('recommend'), `<form id="recoForm">
    <div class="field"><span class="label">${t('yourRating')}</span><div class="star-input" role="radiogroup">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-r="${i}" role="radio" aria-checked="false" aria-label="${i}/5">${icon('star')}</button>`).join('')}</div></div>
    <div class="field"><label for="rc">${t('yourComment')}</label><textarea class="textarea" id="rc" maxlength="500"></textarea></div>
    <p class="form-error" id="recoErr" role="alert"></p>
    <button class="btn btn-gold btn-block" type="submit">${t('publish')}</button></form>`, (ov) => {
    const btns = $$('[data-r]', ov);
    btns.forEach(b => b.addEventListener('click', () => { rating = Number(b.dataset.r); btns.forEach(x => { const on = Number(x.dataset.r) <= rating; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(Number(x.dataset.r) === rating)); }); }));
    ov.querySelector('#recoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!rating) { ov.querySelector('#recoErr').textContent = t('yourRating') + ' : ' + t('required'); return; }
      try { await api.recommend(id, rating, ov.querySelector('#rc').value.trim() || null); toast(t('thanks')); await loadDirectory(); entrySheet(id); render(); }
      catch (x) { ov.querySelector('#recoErr').textContent = errMsg(x); }
    });
  });
}

function reportSheet(id) {
  openSheet(t('report2'), `<form id="repForm">
    <div class="field"><label for="rr">${t('reportReason')}</label><select class="select" id="rr">${['obsolete', 'wrong_number', 'closed', 'abuse', 'other'].map(k => `<option value="${k}">${t('r_' + k)}</option>`).join('')}</select></div>
    <div class="field"><label for="rd">${t('reportDetails')}</label><textarea class="textarea" id="rd" maxlength="300"></textarea></div>
    <p class="form-error" id="repErr" role="alert"></p>
    <button class="btn btn-night btn-block" type="submit">${icon('flag', 'ic-sm')}${t('report2')}</button></form>`, (ov) => {
    ov.querySelector('#repForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api.reportEntry(id, ov.querySelector('#rr').value, ov.querySelector('#rd').value.trim() || null); toast(t('reported')); closeSheet(); await loadDirectory(); render(); }
      catch (x) { ov.querySelector('#repErr').textContent = errMsg(x); }
    });
  });
}

/* ------------------------------------------------------------------ événements */
const actions = {
  lang: (el) => { setLang(el.dataset.lang); if ($('.overlay')) accountSheet(); },
  'cycle-lang': () => setLang({ fr: 'he', he: 'en', en: 'fr' }[S.lang]),
  'pick-entrance': (el) => { const f = $('#loginForm'); const apt = f?.apt.value; S.login.entrance = Number(el.dataset.entrance); S.login.error = ''; render(); if (apt) $('#loginForm').apt.value = apt; $('#aptInput')?.focus(); },
  'reveal-pin': (el) => { const i = $('#pinInput'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.innerHTML = icon(show ? 'eye-off' : 'eye'); el.setAttribute('aria-label', show ? t('hidePin') : t('showPin')); },
  goto: (el) => { closeSheet(); go(el.dataset.href); },
  account: () => accountSheet(),
  signout: async () => { closeSheet(); S.unsub?.(); S.unsub = null; await api.signOut(); Object.assign(S, { session: null, apt: null, tickets: null, announcements: null, directory: null, detail: null, draft: null, sent: null }); location.hash = ''; render(); },
  'req-tab': (el) => { S.reqTab = el.dataset.tab; render(); },
  reload: async (el) => { const k = el.dataset.kind; if (k === 'tickets') { S.tickets = null; S.ticketsError = null; render(); await loadTickets(); } else if (k === 'ann') { S.announcements = null; S.annError = null; render(); await loadAnnouncements(); } else if (k === 'dir') { S.directory = null; S.dirError = null; render(); await loadDirectory(); } else if (k === 'votes') { await loadVotes(); } else if (k === 'visits') { await loadVisits(); } else { S.detail = null; S.detailError = null; } render(); },
  loc: (el) => { captureDraft(); S.draft.location = el.dataset.loc; S.draft.area = el.dataset.loc === 'apartment' ? 'apartment' : ''; render(); },
  area: (el) => { captureDraft(); S.draft.area = el.dataset.area; S.draft.errors.area = false; render(); },
  cat: (el) => {
    captureDraft(); const d = S.draft; d.category = el.dataset.cat; d.errors.category = false;
    if (CATEGORY_AREA[d.category]) { d.location = 'common'; d.area = CATEGORY_AREA[d.category]; }
    else if (['beggars'].includes(d.category) && d.location === 'apartment') { d.location = 'common'; d.area = 'outside'; }
    render();
  },
  'rm-photo': (el) => { captureDraft(); const [x] = S.draft.files.splice(Number(el.dataset.i), 1); URL.revokeObjectURL(x.url); render(); },
  'sent-track': (el) => { const id = el.dataset.id; S.sent = null; go('#/requests/' + id); },
  'sent-home': () => { S.sent = null; go('#/home'); },
  'cancel-ticket': async (el) => {
    if (!confirm(t('cancelConfirm'))) return;
    try { await api.cancelTicket(Number(el.dataset.id)); await loadDetail(Number(el.dataset.id)); await loadTickets(); render(); } catch (e) { toast(errMsg(e), 'error'); }
  },
  trade: (el) => { S.dirTrade = el.dataset.trade; render(); },
  entry: (el) => entrySheet(Number(el.dataset.id)),
  'entry-form': (el) => entryFormSheet(el.dataset.id ? Number(el.dataset.id) : null),
  recommend: (el) => recommendSheet(Number(el.dataset.id)),
  'report-entry': (el) => reportSheet(Number(el.dataset.id)),
  restore: async (el) => {
    try { await api.restoreVersion(Number(el.dataset.id), Number(el.dataset.v)); toast(t('restored', { v: el.dataset.v })); await loadDirectory(); entrySheet(Number(el.dataset.id)); render(); }
    catch (e) { toast(errMsg(e), 'error'); }
  },
  'close-sheet': () => closeSheet(),
  'proxy-form': () => proxySheet(),
  'visit-cancel': async (el) => { const id = Number(el.dataset.id); try { await api.cancelVisit(id); toast(t('visitCancelled')); delete S.visitPicks[id]; delete S.visitNotes[id]; delete S.visitCounts[id]; await loadVisits(); render(); } catch (e) { toast(errMsg(e), 'error'); } },
  'proxy-accept': async (el) => { try { await api.respondProxy(Number(el.dataset.id), true); toast(t('proxyAccepted')); await loadVotes(); render(); } catch (e) { toast(errMsg(e), 'error'); } },
  'proxy-refuse': async (el) => { try { await api.respondProxy(Number(el.dataset.id), false); toast(t('proxyRefused')); await loadVotes(); render(); } catch (e) { toast(errMsg(e), 'error'); } },
  'proxy-revoke': async (el) => { if (!confirm(t('revokeConfirm'))) return; try { await api.revokeProxy(Number(el.dataset.id)); toast(t('proxyRevoked')); await loadVotes(); render(); } catch (e) { toast(errMsg(e), 'error'); } },
  install: async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; render(); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  e.preventDefault();
  actions[el.dataset.act](el, e);
});
document.addEventListener('input', (e) => {
  if (e.target.dataset?.vnote) { S.visitNotes[e.target.dataset.vnote] = e.target.value; return; }
  if (e.target.id === 'dirQ') {
    S.dirQuery = e.target.value;
    const box = $('#dirResults');
    const html = new DOMParser().parseFromString(viewDirectory(), 'text/html').querySelector('#dirResults');
    if (box && html) box.innerHTML = html.innerHTML;
  }
});
document.addEventListener('change', async (e) => {
  if (e.target.dataset?.pick) { S.picks[e.target.dataset.pick] = Number(e.target.value); return; }
  if (e.target.dataset?.vpick) { S.visitPicks[e.target.dataset.vpick] = e.target.value === 'none' ? 'none' : Number(e.target.value); return; }
  if (e.target.dataset?.actChange === 'detail-photo' && e.target.files[0]) {
    const id = Number(e.target.dataset.id);
    try { await api.addPhoto(id, e.target.files[0]); await loadDetail(id); render(); } catch (x) { toast(errMsg(x), 'error'); }
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.dataset?.form === 'ballot') {
    e.preventDefault();
    const opt = f.querySelector('input[name=opt]:checked'); if (!opt) { toast(t('chooseOption'), 'error'); return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const vote = Number(f.dataset.vote);
    try { await api.castBallot(vote, Number(opt.value), f.dataset.apt ? Number(f.dataset.apt) : null); toast(t('voteSaved')); delete S.picks[`${vote}:${f.dataset.apt || 'me'}`]; delete S.summaries[vote]; await loadVotes(); render(); }
    catch (x) { toast(errMsg(x), 'error'); btn.disabled = false; }
    return;
  }
  if (f.dataset?.form === 'visit') {
    e.preventDefault();
    const pick = f.querySelector('input[name=slot]:checked'); if (!pick) { toast(t('chooseSlot'), 'error'); return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const id = Number(f.dataset.id);
    try { await api.bookVisit(id, pick.value === 'none' ? null : Number(pick.value), f.note.value.trim()); toast(t('visitSaved')); delete S.visitPicks[id]; delete S.visitNotes[id]; delete S.visitCounts[id]; await loadVisits(); render(); window.scrollTo(0, 0); }
    catch (x) { toast(errMsg(x), 'error'); btn.disabled = false; delete S.visitCounts[id]; if (errorKey(x) === 'slot_full') render(); }
    return;
  }
  if (f.dataset?.form === 'comment') {
    e.preventDefault();
    const body = f.body.value.trim(); if (!body) return;
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try { await api.comment(Number(f.dataset.id), body); await loadDetail(Number(f.dataset.id)); render(); }
    catch (x) { toast(errMsg(x), 'error'); btn.disabled = false; }
  }
});
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener('online', () => { S.online = true; if (S.session) loadAll(); else render(); });
window.addEventListener('offline', () => { S.online = false; render(); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.session) loadAll(); });

/* ------------------------------------------------------------------ démarrage */
async function boot() {
  S.lang = detectLang();
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === 'he' ? 'rtl' : 'ltr';
  document.title = '4FLORENTINE · ' + t('pageTitle');
  try { api = createApi('fl-resident-auth'); }
  catch { $('#app').innerHTML = `<div class="page"><div class="banner banner-error" style="margin-top:40px">${icon('alert', 'ic-sm')}${t('err_network')}</div></div>`; return; }
  loadShabbat();
  try {
    S.session = await api.session();
    if (S.session) await onSignedIn();
  } catch { S.session = null; }
  render();
  if ('serviceWorker' in navigator && !window.__FL_TEST_API__) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
