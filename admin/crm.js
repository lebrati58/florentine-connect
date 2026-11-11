// 4FLORENTINE — CRM de gestion de la résidence (interface 100 % hébreu, RTL)
import { icon } from '../assets/ds/icons.js';
import { CONFIG } from '../assets/js/config.js';
import {
  CATEGORIES, STATUSES, PRIORITIES, TRADES, OPEN_STATUSES, label, iconOf,
  AREAS, COMMON_AREAS, ENTRANCES, CATEGORY_AREA, isParking, towerOfEntrance, entrancesOfTower,
  esc, $, $$, fmtDate, fmtDateTime, relTime, toast, errorKey, createApi,
} from '../assets/js/core.js';

const he = (list, key) => label(list, key, 'he');
const ROLES = { owner: 'בעלים', manager: 'מנהל/ת', technician: 'טכנאי/ת', viewer: 'צפייה בלבד' };
const ERR = {
  bad_credentials: 'אימייל או סיסמה שגויים.', rate_limited: 'יותר מדי ניסיונות. נסו שוב בעוד מספר דקות.',
  network: 'אין חיבור לשרת. בדקו את הרשת ונסו שוב.', session: 'פג תוקף ההתחברות. התחברו מחדש.',
  forbidden: 'אין לך הרשאה לפעולה זו.', duplicate: 'הרשומה כבר קיימת.', phone_consent: 'יש לאשר הסכמה לפרסום המספר.',
  cannot_cancel: 'לא ניתן לבטל.', unknown: 'אירעה שגיאה. נסו שוב.',
};
const errMsg = (e) => {
  const m = String(e?.message || e || '');
  if (/apartment_not_found/.test(m)) return 'הדירה לא נמצאה.';
  if (/bootstrap_closed/.test(m)) return 'ההגדרה הראשונית כבר בוצעה.';
  if (/Function not found|404|FunctionsFetchError|Failed to send a request/i.test(m)) return 'פונקציית השרת admin-api אינה זמינה עדיין (טרם נפרסה).';
  return ERR[errorKey(e)] || ERR.unknown;
};
const initials = (n) => (n || '?').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('');

/* ------------------------------------------------------------------ état */
const C = {
  session: null, me: null, bootstrap: false, authError: '', authBusy: false, authMode: 'login',
  data: { tickets: null, staff: [], apartments: [], towers: [], vendors: [], interventions: [], announcements: [], directory: [], reports: [], legacy: null },
  errors: {}, lastSync: null, live: false,
  page: 'dashboard', view: 'table', drawer: null, drawerData: null, photoUrls: {},
  f: { status: 'open', priority: '', place: '', area: '', category: '', assignee: '', q: '' },
  aptTower: '', aptQ: '', dirQ: '', dirStatus: '',
};
let api, unsub;
const can = {
  edit: () => ['owner', 'manager', 'technician'].includes(C.me?.role),
  manage: () => ['owner', 'manager'].includes(C.me?.role),
  owner: () => C.me?.role === 'owner',
};

const PAGES = [
  { group: 'תפעול' },
  { key: 'dashboard', icon: 'chart', label: 'לוח בקרה' },
  { key: 'tickets', icon: 'inbox', label: 'פניות ותקלות', count: () => (C.data.tickets || []).filter(t => OPEN_STATUSES.includes(t.status)).length, alert: () => (C.data.tickets || []).some(t => t.priority === 'urgent' && OPEN_STATUSES.includes(t.status)) },
  { key: 'vendors', icon: 'truck', label: 'ספקים והתערבויות' },
  { group: 'נכס וקהילה' },
  { key: 'buildings', icon: 'towers', label: 'בניינים ודירות' },
  { key: 'announcements', icon: 'megaphone', label: 'הודעות לדיירים' },
  { key: 'directory', icon: 'book', label: 'ספר בעלי מקצוע', count: () => C.data.reports.length || 0 },
  { group: 'ניהול' },
  { key: 'team', icon: 'users', label: 'צוות והרשאות' },
];

/* ------------------------------------------------------------------ données */
async function loadAll() {
  const jobs = {
    tickets: () => api.tickets({ limit: 2000 }), staff: () => api.staff(), apartments: () => api.apartments(),
    towers: () => api.towers(), vendors: () => api.vendors(), interventions: () => api.interventions(),
    announcements: () => api.announcements(), directory: () => api.directory(), reports: () => api.directoryReports(),
  };
  const res = await Promise.allSettled(Object.values(jobs).map(f => f()));
  Object.keys(jobs).forEach((k, i) => {
    if (res[i].status === 'fulfilled') { C.data[k] = res[i].value; delete C.errors[k]; }
    else { C.errors[k] = res[i].reason; if (k === 'tickets' && !C.data.tickets) C.data.tickets = []; }
  });
  api.legacySuggestions().then(x => { C.data.legacy = x; }).catch(() => {});
  C.lastSync = new Date();
  render();
}
async function refreshDrawer() {
  if (!C.drawer) return;
  try {
    const [d, iv] = await Promise.all([api.ticket(C.drawer), api.interventions(C.drawer)]);
    C.drawerData = { ...d, interventions: iv };
    C.photoUrls = await api.photoUrls(d.photos.map(p => p.path)).catch(() => ({}));
  } catch (e) { C.drawerData = { error: e }; }
  renderDrawer();
}
const staffName = (id) => C.data.staff.find(s => s.user_id === id)?.full_name;
const aptOf = (id) => C.data.apartments.find(a => a.id === id);
const aptLabel = (a) => a ? `כניסה ${a.entrance} · דירה ${a.number}` : '—';
const placeLabel = (t) => {
  const area = t.area && t.area !== 'apartment' ? he(AREAS, t.area) : t.location === 'common' ? 'שטח משותף' : 'בתוך הדירה';
  return isParking(t.area) ? area : `${t.entrance ? `כניסה ${t.entrance} · ` : ''}${area}`;
};
const placeKey = (t) => isParking(t.area) ? 'parking' : t.entrance ? 'e' + t.entrance : '';
const VISIBLE_CATS = CATEGORIES.filter(c => !c.hidden);

/* ------------------------------------------------------------------ authentification */
function viewAuth() {
  const boot = C.authMode === 'bootstrap';
  const needClaim = C.session && !C.me;
  return `<div class="auth">
    <section class="auth-art">
      <img src="../assets/brand/logo-512.webp" alt="4FLORENTINE" width="360" height="360">
      <div><h2>ניהול ארבעת הבניינים במקום אחד.</h2><p>פניות דיירים, תחזוקה, ספקים, הודעות וספר בעלי המקצוע — מחוברים בזמן אמת לאפליקציית הדיירים.</p></div>
    </section>
    <section class="auth-form"><div class="auth-card">
      ${needClaim ? (C.bootstrap ? `
        <h1>הגדרה ראשונית</h1><p class="sub">אין עדיין משתמשי צוות. החשבון שלך יהפוך לבעלים של המערכת.</p>
        <form id="claimForm"><div class="field"><label for="cName">שם מלא</label><input class="input" id="cName" required minlength="2" maxlength="80"></div>
        ${C.authError ? `<p class="form-error" role="alert">${esc(C.authError)}</p>` : ''}
        <button class="btn btn-gold btn-block" type="submit">${icon('key', 'ic-sm')}הפעלת חשבון הבעלים</button></form>
        <button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="logout">התנתקות</button>` : `
        <h1>אין הרשאת צוות</h1><p class="sub">החשבון ${esc(C.session.user.email || '')} אינו רשום כחבר צוות פעיל. בקשו מבעלי המערכת להוסיף אתכם.</p>
        <button class="btn btn-night btn-block" data-act="logout">${icon('logout', 'ic-sm')}התנתקות</button>`) : `
      <h1>${boot ? 'יצירת חשבון ראשון' : 'כניסת צוות'}</h1>
      <p class="sub">${boot ? 'החשבון הראשון שייווצר יקבל הרשאות בעלים.' : 'גישה למנהלים ולאנשי תחזוקה מורשים בלבד.'}</p>
      <form id="staffLogin" novalidate>
        <div class="field"><label for="sEmail">אימייל</label><input class="input" id="sEmail" type="email" autocomplete="username" dir="ltr" required></div>
        <div class="field"><label for="sPass">סיסמה</label><input class="input" id="sPass" type="password" autocomplete="${boot ? 'new-password' : 'current-password'}" dir="ltr" required minlength="8"></div>
        ${C.authError ? `<p class="form-error" role="alert">${esc(C.authError)}</p>` : ''}
        <button class="btn btn-gold btn-block" type="submit" ${C.authBusy ? 'disabled aria-busy="true"' : ''}>${C.authBusy ? '<span class="spinner"></span>' : icon('lock', 'ic-sm')}${boot ? 'יצירת חשבון' : 'כניסה'}</button>
      </form>
      ${C.bootstrap ? `<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="auth-mode">${boot ? 'יש לי כבר חשבון' : 'הגדרה ראשונית של המערכת'}</button>` : ''}
      <p class="hint" style="margin-top:22px">חשבונות הדיירים (כניסה + דירה + קוד) אינם מעניקים גישה למערכת זו.</p>`}
    </div></section>
  </div>`;
}
function bindAuth() {
  $('#staffLogin')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#sEmail').value.trim(), pw = $('#sPass').value;
    if (!email || pw.length < 8) { C.authError = 'יש להזין אימייל וסיסמה (8 תווים לפחות).'; return render(); }
    C.authBusy = true; C.authError = ''; render();
    try {
      if (C.authMode === 'bootstrap') {
        const r = await api.signUpStaff(email, pw);
        if (!r.session) { C.authError = 'נשלח אליך אימייל אימות. אשרו אותו ואז היכנסו כאן.'; C.authMode = 'login'; }
      } else await api.signInStaff(email, pw);
      await afterAuth();
    } catch (x) { C.authError = errMsg(x); }
    C.authBusy = false; render();
  });
  $('#claimForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.claimOwner($('#cName').value.trim()); await afterAuth(); } catch (x) { C.authError = errMsg(x); }
    render();
  });
}
async function afterAuth() {
  C.session = await api.session();
  if (!C.session) return;
  C.me = await api.meStaff().catch(() => null);
  if (!C.me) { C.bootstrap = await api.bootstrapOpen().catch(() => false); return; }
  if (!C.me.active) { C.me = null; return; }
  await loadAll();
  if (!unsub && api.subscribeTickets) {
    unsub = api.subscribeTickets(async () => {
      try { C.data.tickets = await api.tickets({ limit: 2000 }); C.lastSync = new Date(); } catch { /* ignore */ }
      if (C.drawer) refreshDrawer();
      render();
    });
    C.live = true;
  }
}

/* ------------------------------------------------------------------ coquille */
function render() {
  const root = $('#root');
  if (!C.session || !C.me) { root.innerHTML = viewAuth(); bindAuth(); return; }
  const scrollY = window.scrollY;
  const active = document.activeElement?.id;
  root.innerHTML = `<div class="crm" id="crm">
    <aside class="side" aria-label="ניווט ראשי">
      <div class="side-brand"><img src="../assets/brand/emblem.webp" alt=""><div><b>4FLORENTINE</b><small>מערכת ניהול המתחם</small></div></div>
      <nav>${PAGES.map(p => p.group ? `<div class="nav-group">${p.group}</div>` : `<a class="nav-item" href="#${p.key}" ${C.page === p.key ? 'aria-current="page"' : ''}>${icon(p.icon)}<span>${p.label}</span>${p.count && p.count() ? `<span class="count ${p.alert && p.alert() ? 'alert' : ''}">${p.count()}</span>` : ''}</a>`).join('')}
        <div class="nav-group">קישורים</div>
        <a class="nav-item" href="../app/" target="_blank" rel="noopener">${icon('link')}<span>אפליקציית הדיירים</span></a>
      </nav>
      <div class="side-user"><span class="avatar">${esc(initials(C.me.full_name))}</span><div class="who"><b>${esc(C.me.full_name)}</b><small>${ROLES[C.me.role]}</small></div><button data-act="my-pass" title="שינוי סיסמה" aria-label="שינוי סיסמה">${icon('key')}</button><button data-act="logout" title="התנתקות" aria-label="התנתקות">${icon('logout')}</button></div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="btn btn-ghost btn-icon burger" data-act="nav" aria-label="תפריט">${icon('menu')}</button>
        <div class="gsearch" role="search">${icon('search', 'ic-sm')}<input id="gq" type="search" placeholder="חיפוש פנייה, דירה, ספק, בעל מקצוע…" autocomplete="off" aria-label="חיפוש גלובלי"><kbd>Ctrl K</kbd><div class="gresults" id="gres" hidden></div></div>
        <span class="live ${C.live ? '' : 'off'}"><i></i><span>${C.live ? 'מחובר בזמן אמת' : 'מצב לא מקוון'}${C.lastSync ? ` · ${fmtDate(C.lastSync, 'he', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}</span></span>
        ${can.edit() ? `<button class="btn btn-gold btn-sm new-btn" data-act="new-ticket">${icon('plus', 'ic-sm')}<span>פנייה חדשה</span></button>` : ''}
      </header>
      <main class="content" id="content">${pageHtml()}</main>
    </div>
  </div>`;
  bindPage();
  window.scrollTo(0, scrollY);
  if (active && document.getElementById(active) && active !== 'gq') { const el = document.getElementById(active); el.focus(); if (el.setSelectionRange && el.type !== 'number') el.setSelectionRange(el.value.length, el.value.length); }
  if (C.drawer) renderDrawer();
}
function pageHtml() {
  switch (C.page) {
    case 'tickets': return pageTickets();
    case 'vendors': return pageVendors();
    case 'buildings': return pageBuildings();
    case 'announcements': return pageAnnouncements();
    case 'directory': return pageDirectory();
    case 'team': return pageTeam();
    default: return pageDashboard();
  }
}
const errBanner = (k) => C.errors[k] ? `<div class="banner banner-error" style="margin-bottom:12px">${icon('alert', 'ic-sm')}<span>טעינת הנתונים נכשלה: ${esc(errMsg(C.errors[k]))} <button class="link-btn" data-act="reload">ניסיון חוזר</button></span></div>` : '';
const readOnly = () => can.edit() ? '' : `<div class="banner banner-info ro-note">${icon('eye', 'ic-sm')}<span>הרשאת צפייה בלבד: לא ניתן לבצע שינויים.</span></div>`;
const empty = (ic, title, text, action = '') => `<div class="empty">${icon(ic)}<h3>${title}</h3><p>${text}</p>${action}</div>`;

/* ------------------------------------------------------------------ tableau de bord */
function pageDashboard() {
  const T = C.data.tickets || [];
  const open = T.filter(t => OPEN_STATUSES.includes(t.status));
  const urgent = open.filter(t => t.priority === 'urgent');
  const unassigned = open.filter(t => !t.assignee_id && !t.vendor_id);
  const week = T.filter(t => Date.now() - new Date(t.created_at) < 7 * 864e5);
  const solved = T.filter(t => t.resolved_at);
  const avgH = solved.length ? solved.reduce((s, t) => s + (new Date(t.resolved_at) - new Date(t.created_at)), 0) / solved.length / 36e5 : null;
  const apts = C.data.apartments, linked = apts.filter(a => a.pin_set_at).length;
  const avgTxt = avgH == null ? '—' : avgH < 48 ? `${Math.round(avgH)} ש׳` : `${(avgH / 24).toFixed(1)} ימים`;
  const kpi = (lbl, val, sub, ic, hot, go) => `<${go ? `button type="button" data-act="kpi" data-go='${go}'` : 'div'} class="kpi ${hot ? 'hot' : ''}"><span class="k-label">${icon(ic)}${lbl}</span><span class="k-val">${val}</span><span class="k-sub">${sub}</span></${go ? 'button' : 'div'}>`;
  return `${errBanner('tickets')}
  <div class="page-title"><div><h1>לוח בקרה</h1><p>תמונת מצב חיה של ארבעת הבניינים.</p></div>
    <button class="btn btn-line btn-sm" data-act="reload">${icon('refresh', 'ic-sm')}רענון</button></div>
  <div class="kpis">
    ${kpi('פניות פתוחות', open.length, `${T.length} בסה״כ`, 'inbox', false, '{"status":"open"}')}
    ${kpi('דחופות פתוחות', urgent.length, urgent.length ? 'דורשות טיפול מיידי' : 'אין דחופות', 'alert', urgent.length > 0, '{"status":"open","priority":"urgent"}')}
    ${kpi('ללא שיבוץ', unassigned.length, 'ללא אחראי או ספק', 'user', false, '{"status":"open","assignee":"none"}')}
    ${kpi('נפתחו השבוע', week.length, '7 הימים האחרונים', 'calendar', false, '')}
    ${kpi('זמן טיפול ממוצע', avgTxt, `${solved.length} פניות שטופלו`, 'clock', false, '')}
    ${kpi('דירות מחוברות', apts.length ? `${linked}<small style="font-size:1rem;color:var(--ink-3)">/${apts.length}</small>` : '0', apts.length ? 'קוד כניסה הונפק' : 'טרם הוגדרו דירות', 'key', false, '')}
  </div>
  <div class="grid-3">
    <div class="stack">
      <section class="card"><div class="card-h"><h2>${icon('chart')}פניות ב-30 הימים האחרונים</h2><div class="legend"><span><i style="background:var(--night-700)"></i>נפתחו</span><span><i style="background:var(--gold-500)"></i>טופלו</span></div></div>
        <div class="card-b">${T.length ? trendChart(T) : empty('chart', 'אין עדיין נתונים', 'הגרף יתמלא עם הפניות הראשונות של הדיירים.')}</div></section>
      <section class="card"><div class="card-h"><h2>${icon('alert')}דורש טיפול</h2><button class="link-btn" data-act="kpi" data-go='{"status":"open"}'>לכל הפניות</button></div>
        ${attention(open)}</section>
    </div>
    <div class="stack">
      <section class="card"><div class="card-h"><h2>${icon('filter')}לפי סטטוס</h2></div><div class="card-b">${hbars(STATUSES.filter(s => s.key !== 'cancelled').map(s => [he(STATUSES, s.key), T.filter(t => t.status === s.key).length, `var(--st-${s.key === 'in_progress' ? 'progress' : s.key})`]))}</div></section>
      <section class="card"><div class="card-h"><h2>${icon('towers')}פניות פתוחות לפי כניסה</h2></div><div class="card-b">${hbars([...ENTRANCES.map(e => [`כניסה ${e.id}`, open.filter(t => t.entrance === e.id).length, 'var(--night-700)']), ['חניונים', open.filter(t => isParking(t.area)).length, 'var(--gold-600)']])}</div></section>
      <section class="card"><div class="card-h"><h2>${icon('pin')}מוקדים חוזרים (90 יום)</h2></div><div class="card-b">${hotspots(T)}</div></section>
      <section class="card"><div class="card-h"><h2>${icon('wrench')}לפי קטגוריה</h2></div><div class="card-b">${T.length ? hbars(CATEGORIES.map(c => [c.he, T.filter(t => t.category === c.key).length, 'var(--gold-600)']).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 6)) : '<p class="muted" style="margin:0">אין נתונים.</p>'}</div></section>
    </div>
  </div>
  <p class="data-note">${icon('info', 'ic-sm')}כל הנתונים נטענים ישירות ממסד הנתונים של המתחם. לא מוצגים נתוני דוגמה.</p>`;
}
function hotspots(T) {
  const since = Date.now() - 90 * 864e5, counts = {};
  T.filter(t => new Date(t.created_at) > since && t.area && t.area !== 'apartment').forEach(t => {
    const k = `${placeLabel(t)} — ${he(CATEGORIES, t.category)}`; counts[k] = (counts[k] || 0) + 1;
  });
  const rows = Object.entries(counts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return rows.length ? hbars(rows.map(([k, n]) => [k, n, 'var(--pr-high)'])) : '<p class="muted" style="margin:0">אין עדיין תקלות שחוזרות באותו מקום.</p>';
}
function attention(open) {
  const list = [...open].sort((a, b) => (a.priority === 'urgent' ? -1 : 0) - (b.priority === 'urgent' ? -1 : 0) || (a.assignee_id ? 1 : 0) - (b.assignee_id ? 1 : 0) || new Date(a.created_at) - new Date(b.created_at)).slice(0, 6);
  if (!list.length) return `<div class="card-b">${empty('check', 'אין פניות פתוחות', 'כל הפניות טופלו. פניות חדשות מהדיירים יופיעו כאן מיד.')}</div>`;
  return `<div class="tbl-wrap"><table class="tbl responsive"><tbody>${list.map(ticketRow).join('')}</tbody></table></div>`;
}
function trendChart(T) {
  const days = 30, W = 640, H = 170, pad = 22, bw = (W - pad) / days;
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1);
  const bucket = (d) => Math.floor((new Date(d) - start) / 864e5);
  const opened = Array(days).fill(0), solved = Array(days).fill(0);
  T.forEach(t => { const i = bucket(t.created_at); if (i >= 0 && i < days) opened[i]++; if (t.resolved_at) { const j = bucket(t.resolved_at); if (j >= 0 && j < days) solved[j]++; } });
  const max = Math.max(1, ...opened, ...solved), y = (v) => H - 18 - (v / max) * (H - 30);
  let bars = '';
  for (let i = 0; i < days; i++) {
    const x = pad + i * bw;
    bars += `<rect x="${x + 1}" y="${y(opened[i])}" width="${bw / 2 - 1.5}" height="${H - 18 - y(opened[i])}" rx="2" fill="var(--night-700)"><title>${fmtDate(start.getTime() + i * 864e5, 'he')}: ${opened[i]} נפתחו</title></rect>`;
    bars += `<rect x="${x + bw / 2}" y="${y(solved[i])}" width="${bw / 2 - 1.5}" height="${H - 18 - y(solved[i])}" rx="2" fill="var(--gold-500)"><title>${fmtDate(start.getTime() + i * 864e5, 'he')}: ${solved[i]} טופלו</title></rect>`;
  }
  const ticks = [0, Math.round(max / 2), max].map(v => `<text x="0" y="${y(v) + 4}">${v}</text><line x1="${pad}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#EFEBE1"/>`).join('');
  const labels = [0, 10, 20, 29].map(i => `<text x="${pad + i * bw}" y="${H - 2}">${fmtDate(start.getTime() + i * 864e5, 'he', { day: 'numeric', month: 'numeric' })}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" direction="ltr" role="img" aria-label="פניות שנפתחו וטופלו ב-30 הימים האחרונים">${ticks}${bars}${labels}</svg>`;
}
function hbars(rows) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<div class="hbars">${rows.map(([l, v, c]) => `<div class="hbar"><span>${esc(l)}</span><span class="bar"><span style="width:${(v / max) * 100}%;background:${c}"></span></span><b>${v}</b></div>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ demandes */
function filteredTickets() {
  const f = C.f, q = f.q.trim().toLowerCase();
  return (C.data.tickets || []).filter(t =>
    (f.status === 'all' || (f.status === 'open' ? OPEN_STATUSES.includes(t.status) : t.status === f.status))
    && (!f.priority || t.priority === f.priority) && (!f.place || placeKey(t) === f.place)
    && (!f.area || (t.area || (t.location === 'common' ? '' : 'apartment')) === f.area)
    && (!f.category || t.category === f.category)
    && (!f.assignee || (f.assignee === 'none' ? !t.assignee_id : t.assignee_id === f.assignee))
    && (!q || [t.ref, t.title, t.description, t.location_detail, aptOf(t.apartment_id)?.number].some(v => String(v || '').toLowerCase().includes(q))));
}
function ticketRow(t) {
  const a = aptOf(t.apartment_id);
  return `<tr class="clickable ${C.drawer === t.id ? 'sel' : ''}" data-act="open-ticket" data-id="${t.id}">
    <td><span class="ref">${esc(t.ref)}</span></td>
    <td><div class="ttl">${esc(t.title)}</div><div class="sub">${he(CATEGORIES, t.category)}${t.location_detail ? ' · ' + esc(t.location_detail) : ''}</div></td>
    <td data-hide-m>${esc(placeLabel(t))}${t.floor != null ? `<div class="sub">קומה ${t.floor}</div>` : ''}</td>
    <td data-hide-m>${a ? `דירה ${esc(a.number)}` : '<span class="muted">—</span>'}</td>
    <td><span class="badge pr-${t.priority}">${he(PRIORITIES, t.priority)}</span></td>
    <td><span class="badge st-${t.status}">${he(STATUSES, t.status)}</span></td>
    <td data-hide-m>${t.assignee_id ? `<span class="mini-avatar"><i>${esc(initials(staffName(t.assignee_id)))}</i>${esc(staffName(t.assignee_id) || '')}</span>` : '<span class="muted">לא שובץ</span>'}</td>
    <td data-hide-m><span class="sub" title="${esc(fmtDateTime(t.created_at, 'he'))}">${esc(relTime(t.created_at, 'he'))}</span></td>
  </tr>`;
}
function pageTickets() {
  const all = C.data.tickets || [];
  const list = filteredTickets();
  const cnt = (s) => s === 'all' ? all.length : s === 'open' ? all.filter(t => OPEN_STATUSES.includes(t.status)).length : all.filter(t => t.status === s).length;
  const chips = [['open', 'פתוחות'], ['new', 'חדשות'], ['in_progress', 'בטיפול'], ['waiting', 'בהמתנה'], ['resolved', 'טופלו'], ['closed', 'נסגרו'], ['all', 'הכול']];
  return `${errBanner('tickets')}${readOnly()}
  <div class="page-title"><div><h1>פניות ותקלות</h1><p>מעקב מלא מפתיחת הפנייה ועד סגירתה, כולל היסטוריה, תמונות וספקים.</p></div>
    <div class="seg" role="group" aria-label="תצוגה"><button data-act="view" data-v="table" aria-pressed="${C.view === 'table'}">${icon('list', 'ic-sm')}</button><button data-act="view" data-v="kanban" aria-pressed="${C.view === 'kanban'}" aria-label="קנבן">${icon('kanban', 'ic-sm')}</button></div></div>
  <section class="card">
    <div class="toolbar">
      <div class="fchips">${chips.map(([k, l]) => `<button class="fchip" data-act="f-status" data-v="${k}" aria-pressed="${C.f.status === k}">${l}<span class="n">${cnt(k)}</span></button>`).join('')}</div>
    </div>
    <div class="toolbar">
      <div class="search-in">${icon('search')}<input class="input" id="tq" type="search" placeholder="מספר פנייה, כותרת, דירה…" value="${esc(C.f.q)}" aria-label="חיפוש פניות"></div>
      <select class="select" data-f="priority" aria-label="דחיפות"><option value="">כל הדחיפויות</option>${PRIORITIES.map(p => `<option value="${p.key}" ${C.f.priority === p.key ? 'selected' : ''}>${p.he}</option>`).join('')}</select>
      <select class="select" data-f="place" aria-label="כניסה"><option value="">כל הכניסות</option>${ENTRANCES.map(e => `<option value="e${e.id}" ${C.f.place === 'e' + e.id ? 'selected' : ''}>כניסה ${e.id}</option>`).join('')}<option value="parking" ${C.f.place === 'parking' ? 'selected' : ''}>חניונים</option></select>
      <select class="select" data-f="area" aria-label="אזור"><option value="">כל האזורים</option>${AREAS.map(a => `<option value="${a.key}" ${C.f.area === a.key ? 'selected' : ''}>${a.he}</option>`).join('')}</select>
      <select class="select" data-f="category" aria-label="קטגוריה"><option value="">כל הקטגוריות</option>${VISIBLE_CATS.map(c => `<option value="${c.key}" ${C.f.category === c.key ? 'selected' : ''}>${c.he}</option>`).join('')}</select>
      <select class="select" data-f="assignee" aria-label="אחראי"><option value="">כל האחראים</option><option value="none" ${C.f.assignee === 'none' ? 'selected' : ''}>לא שובץ</option>${C.data.staff.map(s => `<option value="${s.user_id}" ${C.f.assignee === s.user_id ? 'selected' : ''}>${esc(s.full_name)}</option>`).join('')}</select>
      <span class="spacer"></span><span class="muted">${list.length} תוצאות</span>
      ${(C.f.priority || C.f.place || C.f.area || C.f.category || C.f.assignee || C.f.q) ? `<button class="btn btn-ghost btn-sm" data-act="f-clear">${icon('x', 'ic-sm')}ניקוי</button>` : ''}
    </div>
    ${C.view === 'kanban' ? kanban(list) : list.length ? `<div class="tbl-wrap"><table class="tbl responsive"><thead><tr><th>מס׳</th><th>פנייה</th><th data-hide-m>מיקום</th><th data-hide-m>דירה מדווחת</th><th>דחיפות</th><th>סטטוס</th><th data-hide-m>אחראי</th><th data-hide-m>נפתחה</th></tr></thead><tbody>${list.map(ticketRow).join('')}</tbody></table></div>`
      : `<div class="card-b">${empty('inbox', all.length ? 'אין פניות התואמות לסינון' : 'עדיין אין פניות', all.length ? 'שנו את הסינון או נקו אותו.' : 'פניות שהדיירים שולחים מהאפליקציה יופיעו כאן בזמן אמת.')}</div>`}
  </section>`;
}
function kanban(list) {
  const cols = ['new', 'assigned', 'in_progress', 'waiting', 'resolved'];
  return `<div class="kanban">${cols.map(s => {
    const items = list.filter(t => t.status === s);
    return `<div class="kcol" data-drop="${s}"><div class="kcol-h"><span class="badge st-${s}">${he(STATUSES, s)}</span><span class="muted">${items.length}</span></div>
      <div class="kcol-b">${items.map(t => `<article class="kcard ${t.priority === 'urgent' ? 'urgent' : ''}" draggable="${can.edit()}" data-drag="${t.id}" data-act="open-ticket" data-id="${t.id}" tabindex="0">
        <div class="row"><span class="ref">${esc(t.ref)}</span><span class="badge pr-${t.priority}">${he(PRIORITIES, t.priority)}</span></div>
        <div class="ttl">${esc(t.title)}</div>
        <div class="row"><span>${icon(iconOf(CATEGORIES, t.category), 'ic-sm')}</span><span>${esc(placeLabel(t))}</span><span>${t.assignee_id ? `<span class="mini-avatar"><i>${esc(initials(staffName(t.assignee_id)))}</i></span>` : ''}</span></div>
      </article>`).join('') || '<p class="muted" style="text-align:center;font-size:12px;padding:16px 0">אין פניות</p>'}</div></div>`;
  }).join('')}</div>`;
}

/* ---------- tiroir de détail d'une demande ---------- */
function openTicket(id) { C.drawer = id; C.drawerData = null; renderDrawer(); refreshDrawer(); }
function closeDrawer() { C.drawer = null; C.drawerData = null; $$('.drawer, .drawer-ov').forEach(x => x.remove()); $$('tr.sel').forEach(x => x.classList.remove('sel')); }
function renderDrawer() {
  $$('.drawer, .drawer-ov').forEach(x => x.remove());
  if (!C.drawer) return;
  const ov = document.createElement('div'); ov.className = 'drawer-ov'; ov.addEventListener('click', closeDrawer);
  const dr = document.createElement('aside'); dr.className = 'drawer'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true'); dr.setAttribute('aria-label', 'פרטי פנייה');
  const d = C.drawerData;
  if (!d) dr.innerHTML = `<div class="drawer-h"><div class="skel" style="height:24px;width:40%"></div><div class="skel" style="height:30px;margin-top:12px"></div></div><div class="drawer-b"><div class="skel" style="height:140px"></div><div class="skel" style="height:220px"></div></div>`;
  else if (d.error) dr.innerHTML = `<div class="drawer-h"><button class="btn btn-ghost btn-icon" data-act="close-drawer" aria-label="סגירה">${icon('x')}</button></div><div class="drawer-b"><div class="banner banner-error">${icon('alert', 'ic-sm')}${esc(errMsg(d.error))}</div></div>`;
  else {
    const t = d.ticket, a = aptOf(t.apartment_id), ro = can.edit() ? '' : 'disabled';
    dr.innerHTML = `<div class="drawer-h">
      <div class="top-row"><div style="display:flex;gap:8px;align-items:center"><span class="badge no-dot pr-normal">${esc(t.ref)}</span><span class="badge st-${t.status}">${he(STATUSES, t.status)}</span>${t.source === 'resident' ? '<span class="badge no-dot st-closed">נפתחה ע״י דייר</span>' : ''}</div>
      <button class="btn btn-ghost btn-icon" data-act="close-drawer" aria-label="סגירה">${icon('x')}</button></div>
      <h2>${esc(t.title)}</h2>
    </div>
    <div class="drawer-b">
      <div class="props">
        <div class="field"><label for="dStatus">סטטוס</label><select class="select" id="dStatus" data-upd="status" ${ro}>${STATUSES.map(s => `<option value="${s.key}" ${t.status === s.key ? 'selected' : ''}>${s.he}</option>`).join('')}</select></div>
        <div class="field"><label for="dPrio">דחיפות</label><select class="select" id="dPrio" data-upd="priority" ${ro}>${PRIORITIES.map(s => `<option value="${s.key}" ${t.priority === s.key ? 'selected' : ''}>${s.he}</option>`).join('')}</select></div>
        <div class="field"><label for="dAss">אחראי</label><select class="select" id="dAss" data-upd="assignee_id" ${ro}><option value="">לא שובץ</option>${C.data.staff.filter(s => s.active && s.role !== 'viewer').map(s => `<option value="${s.user_id}" ${t.assignee_id === s.user_id ? 'selected' : ''}>${esc(s.full_name)}</option>`).join('')}</select></div>
        <div class="field"><label for="dVen">ספק</label><select class="select" id="dVen" data-upd="vendor_id" ${ro}><option value="">ללא ספק</option>${C.data.vendors.filter(v => v.active || v.id === t.vendor_id).map(v => `<option value="${v.id}" ${t.vendor_id === v.id ? 'selected' : ''}>${esc(v.name)} · ${esc(v.trade)}</option>`).join('')}</select></div>
        <div class="field"><label for="dDue">יעד לטיפול</label><input class="input" type="date" id="dDue" data-upd="due_at" value="${t.due_at ? t.due_at.slice(0, 10) : ''}" ${ro}></div>
        <div class="field"><label for="dCat">קטגוריה</label><select class="select" id="dCat" data-upd="category" ${ro}>${CATEGORIES.filter(c => !c.hidden || c.key === t.category).map(c => `<option value="${c.key}" ${t.category === c.key ? 'selected' : ''}>${c.he}</option>`).join('')}</select></div>
        <div class="field"><label for="dArea">אזור</label><select class="select" id="dArea" data-upd="area" ${ro}>${AREAS.map(a => `<option value="${a.key}" ${(t.area || '') === a.key ? 'selected' : ''}>${a.he}</option>`).join('')}</select></div>
        <div class="field"><label for="dEnt">כניסה</label><select class="select" id="dEnt" data-upd="entrance" ${ro}><option value="">— (חניון / כללי)</option>${ENTRANCES.map(e => `<option value="${e.id}" ${t.entrance === e.id ? 'selected' : ''}>כניסה ${e.id} · בניין ${e.tower}</option>`).join('')}</select></div>
      </div>
      <dl class="kv">
        <div><dt>מיקום</dt><dd>${esc(placeLabel(t))}${t.floor != null ? ` · קומה ${t.floor}` : ''}</dd></div>
        <div><dt>בניין</dt><dd>${t.tower_id ? `בניין ${t.tower_id}` : 'משותף לכל המתחם'}</dd></div>
        <div><dt>דירה מדווחת</dt><dd>${a ? `${esc(aptLabel(a))}${a.label ? ` · ${esc(a.label)}` : ''}` : '—'}</dd></div>
        <div><dt>נפתחה</dt><dd>${esc(fmtDateTime(t.created_at, 'he'))}</dd></div>
        <div><dt>עודכנה</dt><dd>${esc(relTime(t.updated_at, 'he'))}</dd></div>
        <div><dt>טופלה</dt><dd>${t.resolved_at ? esc(fmtDateTime(t.resolved_at, 'he')) : '—'}</dd></div>
      </dl>
      ${t.location_detail ? `<div class="panel"><b>מיקום מדויק:</b> ${esc(t.location_detail)}</div>` : ''}
      <section class="card"><div class="card-h"><h2>${icon('message')}תיאור</h2></div><div class="card-b" style="white-space:pre-wrap">${t.description ? esc(t.description) : '<span class="muted">לא נמסר תיאור.</span>'}</div></section>
      <section class="card"><div class="card-h"><h2>${icon('image')}תמונות (${d.photos.length})</h2>${can.edit() ? `<label class="btn btn-line btn-sm">${icon('camera', 'ic-sm')}הוספה<input type="file" accept="image/*" hidden id="dPhoto"></label>` : ''}</div>
        <div class="card-b">${d.photos.length ? `<div class="thumbs">${d.photos.map(p => C.photoUrls[p.path] ? `<a class="thumb" href="${esc(C.photoUrls[p.path])}" target="_blank" rel="noopener" style="width:96px;height:96px"><img src="${esc(C.photoUrls[p.path])}" alt="" loading="lazy"></a>` : '<span class="thumb skel" style="width:96px;height:96px"></span>').join('')}</div>` : '<span class="muted">אין תמונות.</span>'}</div></section>
      <section class="card"><div class="card-h"><h2>${icon('truck')}התערבויות ספקים</h2>${can.edit() ? `<button class="btn btn-line btn-sm" data-act="new-iv">${icon('plus', 'ic-sm')}התערבות</button>` : ''}</div>
        <div class="card-b">${d.interventions.length ? d.interventions.map(iv => `<div class="iv"><div><b>${esc(C.data.vendors.find(v => v.id === iv.vendor_id)?.name || 'ספק')}</b><div class="sub muted">${iv.scheduled_at ? 'מתוכנן ' + esc(fmtDateTime(iv.scheduled_at, 'he')) : 'ללא מועד'}${iv.cost != null ? ` · ₪${Number(iv.cost).toLocaleString('he-IL')}` : ''}${iv.notes ? ' · ' + esc(iv.notes) : ''}</div></div>
          ${can.edit() ? `<select class="select" style="width:auto;min-height:34px;height:34px;padding-top:0;padding-bottom:0" data-iv="${iv.id}" aria-label="סטטוס התערבות">${[['planned', 'מתוכנן'], ['done', 'בוצע'], ['cancelled', 'בוטל']].map(([k, l]) => `<option value="${k}" ${iv.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<span class="badge">${iv.status}</span>`}</div>`).join('') : '<span class="muted">לא תועדו התערבויות.</span>'}</div></section>
      <section class="card"><div class="card-h"><h2>${icon('history')}היסטוריה</h2></div><div class="card-b">
        <ol class="timeline">${d.events.map(eventRow).join('')}</ol>
        ${can.edit() ? `<form id="noteForm" style="margin-top:8px">
          <div class="note-tabs seg" role="group"><button type="button" data-act="note-kind" data-k="comment" aria-pressed="true">הודעה לדייר</button><button type="button" data-act="note-kind" data-k="note" aria-pressed="false">הערה פנימית</button></div>
          <textarea class="textarea" name="body" maxlength="2000" required placeholder="ההודעה תוצג לדייר באפליקציה…" style="min-height:80px"></textarea>
          <input type="hidden" name="kind" value="comment">
          <button class="btn btn-night btn-sm" type="submit" style="margin-top:8px">${icon('send', 'ic-sm flip-rtl')}שליחה</button></form>` : ''}
      </div></section>
    </div>`;
  }
  document.body.append(ov, dr);
  bindDrawer(dr);
}
function eventRow(e) {
  const who = e.actor_kind === 'resident' ? 'דייר' : e.actor_kind === 'staff' ? (staffName(e.actor_id) || 'צוות') : 'מערכת';
  let txt;
  switch (e.kind) {
    case 'created': txt = 'הפנייה נפתחה'; break;
    case 'status': txt = `סטטוס: ${he(STATUSES, e.from_value)} ← ${he(STATUSES, e.to_value)}`; break;
    case 'priority': txt = `דחיפות: ${he(PRIORITIES, e.from_value)} ← ${he(PRIORITIES, e.to_value)}`; break;
    case 'assignee': txt = `אחראי: ${esc(e.to_value || 'הוסר')}`; break;
    case 'vendor': txt = `ספק: ${esc(e.to_value || 'הוסר')}`; break;
    case 'comment': txt = e.actor_kind === 'resident' ? 'הודעה מהדייר' : 'הודעה לדייר'; break;
    case 'note': txt = 'הערה פנימית'; break;
    case 'photo': txt = 'נוספה תמונה'; break;
    case 'intervention': txt = `התערבות ספק${e.body ? ' — ' + esc(e.body) : ''}: ${{ planned: 'מתוכננת', done: 'בוצעה', cancelled: 'בוטלה' }[e.to_value] || ''}`; break;
    default: txt = e.kind;
  }
  return `<li><span class="dot ${e.actor_kind === 'resident' ? 'night' : ''}"></span><div class="t-title">${txt}${e.is_public ? '' : ' <span class="badge no-dot st-waiting" style="height:20px">פנימי</span>'}</div>
    <div class="t-meta">${who} · ${esc(fmtDateTime(e.created_at, 'he'))}</div>
    ${(e.kind === 'comment' || e.kind === 'note') && e.body ? `<div class="t-body ${e.kind === 'note' ? 'internal' : ''}">${esc(e.body)}</div>` : ''}</li>`;
}
function bindDrawer(dr) {
  $$('[data-upd]', dr).forEach(el => el.addEventListener('change', async () => {
    const k = el.dataset.upd; let v = el.value || null;
    if ((k === 'vendor_id' || k === 'entrance') && v) v = Number(v);
    if (k === 'due_at' && v) v = new Date(v + 'T12:00:00').toISOString();
    try { await api.updateTicket(C.drawer, { [k]: v }); toast('השינוי נשמר'); C.data.tickets = await api.tickets({ limit: 2000 }); await refreshDrawer(); render(); }
    catch (e) { toast(errMsg(e), 'error'); refreshDrawer(); }
  }));
  $$('[data-iv]', dr).forEach(el => el.addEventListener('change', async () => {
    try { await api.saveIntervention({ id: Number(el.dataset.iv), status: el.value, completed_at: el.value === 'done' ? new Date().toISOString() : null }); toast('ההתערבות עודכנה'); refreshDrawer(); }
    catch (e) { toast(errMsg(e), 'error'); }
  }));
  $('#dPhoto', dr)?.addEventListener('change', async (e) => {
    try { await api.addPhoto(C.drawer, e.target.files[0]); toast('התמונה נוספה'); refreshDrawer(); } catch (x) { toast(errMsg(x), 'error'); }
  });
  $('#noteForm', dr)?.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; const body = f.body.value.trim(); if (!body) return;
    try { await api.comment(C.drawer, body, f.kind.value === 'note'); toast(f.kind.value === 'note' ? 'ההערה נשמרה' : 'ההודעה נשלחה לדייר'); refreshDrawer(); }
    catch (x) { toast(errMsg(x), 'error'); }
  });
}

/* ------------------------------------------------------------------ fournisseurs */
function pageVendors() {
  const V = C.data.vendors, I = C.data.interventions;
  const upcoming = I.filter(i => i.status === 'planned').sort((a, b) => new Date(a.scheduled_at || 8e15) - new Date(b.scheduled_at || 8e15));
  return `${errBanner('vendors')}${readOnly()}
  <div class="page-title"><div><h1>ספקים והתערבויות</h1><p>אנשי המקצוע של המתחם, עלויות וביקורים מתוכננים.</p></div>${can.edit() ? `<button class="btn btn-gold" data-act="vendor-form">${icon('plus', 'ic-sm')}ספק חדש</button>` : ''}</div>
  <div class="grid-3">
    <section class="card"><div class="card-h"><h2>${icon('truck')}ספקים (${V.length})</h2></div>
      ${V.length ? `<div class="tbl-wrap"><table class="tbl responsive"><thead><tr><th>ספק</th><th>תחום</th><th data-hide-m>איש קשר</th><th>טלפון</th><th data-hide-m>פניות פתוחות</th><th></th></tr></thead><tbody>
        ${V.map(v => `<tr><td><div class="ttl">${esc(v.name)}</div>${v.active ? '' : '<span class="badge st-cancelled">לא פעיל</span>'}</td><td>${esc(v.trade)}</td><td data-hide-m>${esc(v.contact_name || '—')}</td>
          <td>${v.phone ? `<a href="tel:${esc(v.phone)}" dir="ltr">${esc(v.phone)}</a>` : '—'}</td><td data-hide-m>${(C.data.tickets || []).filter(t => t.vendor_id === v.id && OPEN_STATUSES.includes(t.status)).length}</td>
          <td>${can.edit() ? `<button class="btn btn-ghost btn-sm" data-act="vendor-form" data-id="${v.id}">${icon('edit', 'ic-sm')}עריכה</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card-b">${empty('truck', 'עדיין אין ספקים', 'הוסיפו את ספקי המעליות, האינסטלציה, החשמל והניקיון כדי לשבץ אותם לפניות.', can.edit() ? `<button class="btn btn-night" data-act="vendor-form">${icon('plus', 'ic-sm')}ספק חדש</button>` : '')}</div>`}
    </section>
    <section class="card"><div class="card-h"><h2>${icon('calendar')}ביקורים מתוכננים</h2></div><div class="card-b">
      ${upcoming.length ? upcoming.map(i => { const t = (C.data.tickets || []).find(x => x.id === i.ticket_id); return `<div class="iv"><div><b>${esc(V.find(v => v.id === i.vendor_id)?.name || 'ספק')}</b><div class="sub muted">${i.scheduled_at ? esc(fmtDateTime(i.scheduled_at, 'he')) : 'ללא מועד'} · ${t ? esc(t.ref + ' ' + t.title) : ''}</div></div>${t ? `<button class="btn btn-ghost btn-sm" data-act="open-ticket" data-id="${t.id}">פתיחה</button>` : ''}</div>`; }).join('') : '<p class="muted" style="margin:0">אין ביקורים מתוכננים. תכננו התערבות מתוך פנייה.</p>'}
    </div></section>
  </div>`;
}

/* ------------------------------------------------------------------ bâtiments */
function pageBuildings() {
  const A = C.data.apartments, T = C.data.tickets || [];
  const q = C.aptQ.trim().toLowerCase();
  const list = A.filter(a => (!C.aptTower || a.entrance === Number(C.aptTower)) && (!q || String(a.number).includes(q) || (a.label || '').toLowerCase().includes(q)));
  return `${errBanner('apartments')}
  <div class="page-title"><div><h1>בניינים ודירות</h1><p>ארבעה בניינים, שש כניסות: 1-2, 3, 4-5, 6. ניהול הדירות וקודי הכניסה של הדיירים.</p></div>${can.manage() ? `<button class="btn btn-gold" data-act="apt-bulk">${icon('plus', 'ic-sm')}הוספת דירות</button>` : ''}</div>
  <div class="towers">${[1, 2, 3, 4].map(n => { const tw = C.data.towers.find(x => x.id === n) || {}; const ta = A.filter(a => a.tower_id === n); return `<article class="tower">
    <h3>בניין ${n}</h3><span style="color:var(--gold-300);font-size:13px;font-weight:600">${entrancesOfTower(n).length > 1 ? 'כניסות' : 'כניסה'} ${entrancesOfTower(n).join(' + ')}</span><span style="color:#9FB0C7;font-size:12.5px">${tw.floors ? `${tw.floors} קומות` : 'מספר קומות לא הוגדר'}${tw.address ? ' · ' + esc(tw.address) : ''}</span>
    <div class="stats"><div><b>${ta.length}</b><small>דירות</small></div><div><b>${ta.filter(a => a.pin_set_at).length}</b><small>מחוברות</small></div><div><b>${T.filter(t => t.tower_id === n && OPEN_STATUSES.includes(t.status)).length}</b><small>פניות פתוחות</small></div></div>
    ${can.manage() ? `<button class="btn btn-line btn-sm" data-act="tower-form" data-id="${n}">${icon('edit', 'ic-sm')}פרטי הבניין</button>` : ''}
  </article>`; }).join('')}</div>
  <section class="card">
    <div class="toolbar"><div class="search-in">${icon('search')}<input class="input" id="aq" type="search" placeholder="מספר דירה או שם משפחה" value="${esc(C.aptQ)}" aria-label="חיפוש דירה"></div>
      <select class="select" id="aTower" aria-label="כניסה"><option value="">כל הכניסות</option>${ENTRANCES.map(e => `<option value="${e.id}" ${String(C.aptTower) === String(e.id) ? 'selected' : ''}>כניסה ${e.id} · בניין ${e.tower}</option>`).join('')}</select>
      <span class="spacer"></span><span class="muted">${list.length} דירות</span></div>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl responsive"><thead><tr><th>דירה</th><th data-hide-m>קומה</th><th data-hide-m>משפחה / הערה</th><th>גישה לאפליקציה</th><th data-hide-m>פניות</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr><td><div class="ttl">${esc(aptLabel(a))}</div><div class="sub">בניין ${a.tower_id}</div></td><td data-hide-m>${a.floor ?? '—'}</td><td data-hide-m>${esc(a.label || '—')}</td>
        <td>${!a.active ? '<span class="badge st-cancelled">מושבתת</span>' : a.pin_set_at ? `<span class="badge st-resolved">פעילה</span><div class="sub">קוד הונפק ${esc(relTime(a.pin_set_at, 'he'))}</div>` : '<span class="badge st-waiting">ללא קוד</span>'}</td>
        <td data-hide-m>${T.filter(t => t.apartment_id === a.id).length}</td>
        <td style="white-space:nowrap">${can.manage() ? `<button class="btn btn-night btn-sm" data-act="set-pin" data-id="${a.id}">${icon('key', 'ic-sm')}${a.pin_set_at ? 'קוד חדש' : 'הנפקת קוד'}</button> <button class="btn btn-ghost btn-sm" data-act="apt-form" data-id="${a.id}" aria-label="עריכה">${icon('edit', 'ic-sm')}</button>${a.pin_set_at ? ` <button class="btn btn-ghost btn-sm" data-act="apt-disable" data-id="${a.id}" title="ניתוק הגישה">${icon('lock', 'ic-sm')}</button>` : ''}` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="card-b">${empty('home', A.length ? 'לא נמצאו דירות' : 'טרם הוגדרו דירות', A.length ? 'שנו את החיפוש.' : 'הוסיפו את הדירות לפי כניסה (אפשר בטווחים), ולאחר מכן הנפיקו קוד לכל דירה.', can.manage() && !A.length ? `<button class="btn btn-night" data-act="apt-bulk">${icon('plus', 'ic-sm')}הוספת דירות</button>` : '')}</div>`}
  </section>
  <p class="data-note">${icon('shield', 'ic-sm')}הקודים נוצרים בשרת, מוצגים פעם אחת בלבד ואינם נשמרים כטקסט גלוי. קוד חדש מנתק את כל החיבורים הקיימים של הדירה.</p>`;
}

/* ------------------------------------------------------------------ annonces */
const ANN_CAT = { info: 'מידע', works: 'עבודות', meeting: 'אספה', urgent: 'דחוף', event: 'אירוע' };
function pageAnnouncements() {
  const A = C.data.announcements;
  return `${errBanner('announcements')}
  <div class="page-title"><div><h1>הודעות לדיירים</h1><p>ההודעות מופיעות מיד בעמוד הבית של אפליקציית הדיירים, בעברית, צרפתית ואנגלית.</p></div>${can.manage() ? `<button class="btn btn-gold" data-act="ann-form">${icon('plus', 'ic-sm')}הודעה חדשה</button>` : ''}</div>
  <section class="card">${A.length ? A.map(a => {
    const expired = a.expires_at && new Date(a.expires_at) < new Date();
    return `<div class="notice-row"><div><h3>${a.pinned ? icon('pin', 'ic-sm') : ''} ${esc(a.title)}</h3><p>${esc(a.body)}</p>
      <div class="meta"><span class="badge ${a.category === 'urgent' ? 'pr-urgent' : 'pr-normal'}">${ANN_CAT[a.category]}</span><span class="badge no-dot st-closed">${a.entrance ? 'כניסה ' + a.entrance : a.tower_id ? 'בניין ' + a.tower_id : 'כל הבניינים'}</span>
      ${!a.published ? '<span class="badge st-waiting">טיוטה</span>' : expired ? '<span class="badge st-cancelled">פג תוקף</span>' : '<span class="badge st-resolved">מפורסמת</span>'}
      ${Object.keys(a.translations || {}).map(l => `<span class="badge no-dot st-new">${l.toUpperCase()}</span>`).join('')}
      <span class="muted" style="font-size:12px">${esc(fmtDateTime(a.starts_at, 'he'))}</span></div></div>
      ${can.manage() ? `<div style="display:flex;gap:6px;align-items:start"><button class="btn btn-ghost btn-sm" data-act="ann-form" data-id="${a.id}">${icon('edit', 'ic-sm')}עריכה</button><button class="btn btn-ghost btn-sm" data-act="ann-del" data-id="${a.id}" aria-label="מחיקה">${icon('x', 'ic-sm')}</button></div>` : ''}</div>`;
  }).join('') : `<div class="card-b">${empty('megaphone', 'עדיין אין הודעות', 'פרסמו עדכון על עבודות, הפסקות מים, אספות דיירים או אירועים.', can.manage() ? `<button class="btn btn-night" data-act="ann-form">${icon('plus', 'ic-sm')}הודעה חדשה</button>` : '')}</div>`}</section>`;
}

/* ------------------------------------------------------------------ annuaire */
function pageDirectory() {
  const D = C.data.directory, R = C.data.reports, q = C.dirQ.trim().toLowerCase();
  const list = D.filter(e => (!C.dirStatus || e.status === C.dirStatus) && (!q || e.name.toLowerCase().includes(q) || he(TRADES, e.trade).includes(q)));
  return `${errBanner('directory')}
  <div class="page-title"><div><h1>ספר בעלי מקצוע</h1><p>ספר שיתופי שהדיירים מנהלים. הצוות מפקח: הסתרת תוכן פוגעני, טיפול בדיווחים ושחזור גרסאות.</p></div></div>
  ${R.length ? `<section class="card" style="margin-bottom:16px;border-color:#EBD7A6"><div class="card-h"><h2>${icon('flag')}דיווחים פתוחים (${R.length})</h2></div>
    <div class="tbl-wrap"><table class="tbl responsive"><tbody>${R.map(r => { const e = D.find(x => x.id === r.entry_id); return `<tr><td><div class="ttl">${esc(e?.name || '#' + r.entry_id)}</div><div class="sub">${{ obsolete: 'לא עדכני', wrong_number: 'מספר שגוי', closed: 'העסק נסגר', abuse: 'תוכן פוגעני', other: 'אחר' }[r.reason]}${r.details ? ' · ' + esc(r.details) : ''}</div></td><td data-hide-m class="sub">${esc(relTime(r.created_at, 'he'))}</td>
      <td style="white-space:nowrap">${e ? `<button class="btn btn-ghost btn-sm" data-act="dir-entry" data-id="${e.id}">צפייה</button>` : ''}${can.edit() ? `<button class="btn btn-line btn-sm" data-act="resolve-report" data-id="${r.id}">${icon('check', 'ic-sm')}טופל</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></section>` : ''}
  <section class="card">
    <div class="toolbar"><div class="search-in">${icon('search')}<input class="input" id="dq" type="search" placeholder="שם או תחום" value="${esc(C.dirQ)}" aria-label="חיפוש בעל מקצוע"></div>
      <select class="select" id="dStatusF" aria-label="סטטוס"><option value="">כל הסטטוסים</option><option value="active" ${C.dirStatus === 'active' ? 'selected' : ''}>פעיל</option><option value="obsolete" ${C.dirStatus === 'obsolete' ? 'selected' : ''}>לא עדכני</option><option value="hidden" ${C.dirStatus === 'hidden' ? 'selected' : ''}>מוסתר</option></select>
      <span class="spacer"></span><span class="muted">${list.length} רשומות</span></div>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl responsive"><thead><tr><th>שם</th><th>תחום</th><th data-hide-m>טלפון</th><th data-hide-m>המלצות</th><th data-hide-m>גרסה</th><th>סטטוס</th><th></th></tr></thead><tbody>
      ${list.map(e => `<tr class="clickable" data-act="dir-entry" data-id="${e.id}"><td><div class="ttl">${esc(e.name)}</div>${e.source === 'legacy' ? '<div class="sub">מספר הטלפונים הקודם</div>' : ''}</td><td>${he(TRADES, e.trade)}</td>
        <td data-hide-m dir="ltr" style="text-align:end">${esc(e.phone || '—')}</td><td data-hide-m>${Number(e.reco_count) ? `${Number(e.avg_rating).toFixed(1)} ★ (${e.reco_count})` : '—'}</td><td data-hide-m>v${e.version}</td>
        <td><span class="badge ${e.status === 'active' ? 'st-resolved' : e.status === 'hidden' ? 'pr-urgent' : 'st-cancelled'}">${{ active: 'פעיל', obsolete: 'לא עדכני', hidden: 'מוסתר' }[e.status]}</span></td>
        <td>${Number(e.open_reports) ? `<span class="badge pr-high">${e.open_reports} דיווחים</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="card-b">${empty('book', 'אין רשומות', 'הדיירים מוסיפים בעלי מקצוע מתוך האפליקציה.')}</div>`}
  </section>
  ${C.data.legacy && C.data.legacy.length ? `<section class="card" style="margin-top:16px"><div class="card-h"><h2>${icon('history')}הצעות מהאתר הקודם (${C.data.legacy.length})</h2></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>סוג</th><th>תחום</th><th>שם</th><th>טלפון</th><th>פרטים</th></tr></thead><tbody>${C.data.legacy.map(s => `<tr><td>${s.action === 'edit' ? 'תיקון' : 'הוספה'}</td><td>${esc(s.category || '')}</td><td>${esc(s.professional_name || '')}${s.existing_name ? `<div class="sub">${esc(s.existing_name)}</div>` : ''}</td><td dir="ltr">${esc(s.phone || '')}</td><td>${esc(s.details || '')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}
async function dirEntrySheet(id) {
  const ov = sheet('בעל מקצוע', '<div class="skel" style="height:160px"></div>');
  let d; try { d = await api.directoryEntry(id); } catch (e) { $('.sheet-body', ov).innerHTML = `<div class="banner banner-error">${esc(errMsg(e))}</div>`; return; }
  const e = d.entry;
  $('#sheetTitle', ov).textContent = e.name;
  $('.sheet-body', ov).innerHTML = `
    <dl class="kv" style="grid-template-columns:repeat(2,1fr)"><div><dt>תחום</dt><dd>${he(TRADES, e.trade)}</dd></div><div><dt>טלפון</dt><dd dir="ltr" style="text-align:end">${esc(e.phone || '—')}</dd></div>
      <div><dt>המלצות</dt><dd>${Number(e.reco_count) ? `${Number(e.avg_rating).toFixed(1)} ★ (${e.reco_count})` : '—'}</dd></div><div><dt>סטטוס</dt><dd>${{ active: 'פעיל', obsolete: 'לא עדכני', hidden: 'מוסתר' }[e.status]}</dd></div></dl>
    ${e.notes ? `<p style="white-space:pre-wrap">${esc(e.notes)}</p>` : ''}
    ${can.edit() ? `<div class="btn-row" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
      ${e.status !== 'hidden' ? `<button class="btn btn-danger btn-sm" data-act="dir-status" data-id="${e.id}" data-s="hidden">${icon('eye-off', 'ic-sm')}הסתרה</button>` : `<button class="btn btn-line btn-sm" data-act="dir-status" data-id="${e.id}" data-s="active">${icon('eye', 'ic-sm')}החזרה לפרסום</button>`}
      ${e.status === 'obsolete' ? `<button class="btn btn-line btn-sm" data-act="dir-status" data-id="${e.id}" data-s="active">${icon('check', 'ic-sm')}סימון כעדכני</button>` : e.status === 'active' ? `<button class="btn btn-line btn-sm" data-act="dir-status" data-id="${e.id}" data-s="obsolete">סימון כלא עדכני</button>` : ''}</div>` : ''}
    <h3 style="font-size:14px;margin:16px 0 6px">היסטוריית גרסאות</h3>
    ${d.revisions.map((v, i) => `<div class="iv"><div><b>גרסה ${v.version}</b> <span class="muted">${{ create: 'יצירה', edit: 'עריכה', restore: 'שחזור', status: 'שינוי סטטוס' }[v.change_kind]}</span>
      <div class="sub muted">${esc(fmtDateTime(v.created_at, 'he'))}${v.apartment_id ? ` · ${esc(aptLabel(aptOf(v.apartment_id)))}` : ''} — ${esc(v.snapshot.name)}${v.snapshot.phone ? ', ' + esc(v.snapshot.phone) : ''}</div></div>
      ${i > 0 && can.edit() ? `<button class="btn btn-line btn-sm" data-act="dir-restore" data-id="${e.id}" data-v="${v.version}">${icon('restore', 'ic-sm')}שחזור</button>` : ''}</div>`).join('')}
    <h3 style="font-size:14px;margin:16px 0 6px">המלצות</h3>
    ${d.recos.length ? d.recos.map(r => `<div class="iv"><div><b>${'★'.repeat(r.rating)}</b><div class="sub muted">${esc(r.comment || '')}</div></div><span class="muted">${esc(relTime(r.created_at, 'he'))}</span></div>`).join('') : '<p class="muted">אין המלצות.</p>'}`;
}

/* ------------------------------------------------------------------ équipe */
function pageTeam() {
  const S = C.data.staff;
  return `${errBanner('staff')}
  <div class="page-title"><div><h1>צוות והרשאות</h1><p>חשבונות נפרדים לכל איש צוות, עם תפקיד שמגדיר מה מותר לו.</p></div>${can.owner() ? `<button class="btn btn-gold" data-act="staff-form">${icon('plus', 'ic-sm')}איש צוות חדש</button>` : ''}</div>
  <div class="grid-3">
    <section class="card"><div class="tbl-wrap"><table class="tbl responsive"><thead><tr><th>שם</th><th>תפקיד</th><th data-hide-m>פניות פתוחות</th><th>מצב</th></tr></thead><tbody>
      ${S.map(s => `<tr><td><span class="mini-avatar"><i>${esc(initials(s.full_name))}</i><b>${esc(s.full_name)}</b></span>${s.user_id === C.me.user_id ? ' <span class="muted">(את/ה)</span>' : ''}</td>
        <td>${can.owner() && s.user_id !== C.me.user_id ? `<select class="select" style="min-height:34px;height:34px;padding-top:0;padding-bottom:0;width:auto" data-role="${s.user_id}" aria-label="תפקיד">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${s.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ROLES[s.role]}</td>
        <td data-hide-m>${(C.data.tickets || []).filter(t => t.assignee_id === s.user_id && OPEN_STATUSES.includes(t.status)).length}</td>
        <td>${can.owner() && s.user_id !== C.me.user_id ? `<button class="btn btn-sm ${s.active ? 'btn-line' : 'btn-night'}" data-act="staff-active" data-id="${s.user_id}" data-v="${!s.active}">${s.active ? 'פעיל — השבתה' : 'מושבת — הפעלה'}</button>` : `<span class="badge ${s.active ? 'st-resolved' : 'st-cancelled'}">${s.active ? 'פעיל' : 'מושבת'}</span>`}</td></tr>`).join('')}
    </tbody></table></div></section>
    <section class="card"><div class="card-h"><h2>${icon('shield')}מה כל תפקיד רשאי</h2></div><div class="card-b" style="display:grid;gap:12px;font-size:13px">
      <div><b>בעלים</b><div class="muted">הכול, כולל ניהול הצוות וההרשאות.</div></div>
      <div><b>מנהל/ת</b><div class="muted">פניות, דירות וקודי כניסה, הודעות, ספקים, פיקוח על ספר בעלי המקצוע.</div></div>
      <div><b>טכנאי/ת</b><div class="muted">טיפול בפניות, ספקים והתערבויות. ללא גישה לקודים ולהודעות.</div></div>
      <div><b>צפייה בלבד</b><div class="muted">צפייה בכל הנתונים ללא אפשרות שינוי.</div></div>
    </div></section>
  </div>`;
}

/* ------------------------------------------------------------------ fenêtres */
function sheet(title, html, onMount) {
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet-grip"></div><div class="sheet-head"><h2 id="sheetTitle">${title}</h2><button class="btn btn-ghost btn-icon" data-act="close-sheet" aria-label="סגירה">${icon('x')}</button></div><div class="sheet-body">${html}</div></div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  document.body.append(ov);
  setTimeout(() => ov.querySelector('input, select, textarea')?.focus(), 50);
  onMount?.(ov);
  return ov;
}
const closeSheet = () => $$('.overlay').forEach(o => o.remove());
const formErr = (ov, m) => { const p = $('.form-error', ov); if (p) p.textContent = m; };

function newTicketSheet() {
  sheet('פנייה חדשה (ע״י הצוות)', `<form id="ntForm">
    <div class="props" style="margin-bottom:14px">
      <div class="field"><label for="ntArea">אזור</label><select class="select" id="ntArea" name="area">${AREAS.map(a => `<option value="${a.key}" ${a.key === 'lobby' ? 'selected' : ''}>${a.he}</option>`).join('')}</select></div>
      <div class="field"><label for="ntTower">כניסה</label><select class="select" id="ntTower" name="tower">${ENTRANCES.map(e => `<option value="${e.id}">כניסה ${e.id} · בניין ${e.tower}</option>`).join('')}</select></div>
      <div class="field"><label for="ntApt">דירה (לא חובה)</label><select class="select" id="ntApt" name="apt"><option value="">—</option></select></div>
      <div class="field"><label for="ntFloor">קומה</label><input class="input" id="ntFloor" name="floor" inputmode="numeric"></div>
      <div class="field"><label for="ntCat">קטגוריה</label><select class="select" id="ntCat" name="category">${VISIBLE_CATS.map(c => `<option value="${c.key}">${c.he}</option>`).join('')}</select></div>
      <div class="field"><label for="ntPrio">דחיפות</label><select class="select" id="ntPrio" name="priority">${PRIORITIES.map(p => `<option value="${p.key}" ${p.key === 'normal' ? 'selected' : ''}>${p.he}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="ntTitle">כותרת</label><input class="input" id="ntTitle" name="title" required minlength="3" maxlength="120"></div>
    <div class="field"><label for="ntDetail">מיקום מדויק</label><input class="input" id="ntDetail" name="detail" maxlength="120"></div>
    <div class="field"><label for="ntDesc">תיאור</label><textarea class="textarea" id="ntDesc" name="description" maxlength="2000"></textarea></div>
    <div class="field"><label for="ntAss">אחראי</label><select class="select" id="ntAss" name="assignee"><option value="">לא שובץ</option>${C.data.staff.filter(s => s.active && s.role !== 'viewer').map(s => `<option value="${s.user_id}">${esc(s.full_name)}</option>`).join('')}</select></div>
    <p class="form-error" role="alert"></p>
    <button class="btn btn-gold btn-block" type="submit">${icon('plus', 'ic-sm')}יצירת הפנייה</button></form>`, (ov) => {
    const f = $('#ntForm', ov);
    const fillApts = () => { f.apt.innerHTML = '<option value="">—</option>' + C.data.apartments.filter(a => a.entrance === Number(f.tower.value)).map(a => `<option value="${a.id}">דירה ${esc(a.number)}</option>`).join(''); };
    const syncArea = () => { const fixed = CATEGORY_AREA[f.category.value]; if (fixed) f.area.value = fixed; f.tower.disabled = isParking(f.area.value); };
    f.tower.addEventListener('change', fillApts); fillApts();
    f.category.addEventListener('change', syncArea); f.area.addEventListener('change', syncArea); syncArea();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (f.title.value.trim().length < 3) return formErr(ov, 'יש להזין כותרת (3 תווים לפחות).');
      try {
        const { ticket } = await api.createTicket({ entrance: isParking(f.area.value) ? null : Number(f.tower.value), area: f.area.value, location: f.area.value === 'apartment' ? 'apartment' : 'common', apartment_id: f.apt.value ? Number(f.apt.value) : null, floor: f.floor.value !== '' && !isNaN(Number(f.floor.value)) ? Number(f.floor.value) : null, category: f.category.value, priority: f.priority.value, title: f.title.value.trim(), location_detail: f.detail.value.trim() || null, description: f.description.value.trim() || null, assignee_id: f.assignee.value || null });
        toast(`הפנייה ${ticket.ref} נוצרה`); closeSheet(); C.data.tickets = await api.tickets({ limit: 2000 }); C.page = 'tickets'; location.hash = 'tickets'; render(); openTicket(ticket.id);
      } catch (x) { formErr(ov, errMsg(x)); }
    });
  });
}
function vendorSheet(id) {
  const v = id ? C.data.vendors.find(x => x.id === id) : {};
  sheet(id ? 'עריכת ספק' : 'ספק חדש', `<form id="vForm">
    <div class="field"><label for="vName">שם הספק</label><input class="input" id="vName" name="name" required maxlength="120" value="${esc(v.name || '')}"></div>
    <div class="props" style="margin-bottom:14px">
      <div class="field"><label for="vTrade">תחום</label><input class="input" id="vTrade" name="trade" list="trades" required maxlength="60" value="${esc(v.trade || '')}"><datalist id="trades">${['מעליות', 'אינסטלציה', 'חשמל', 'ניקיון', 'מיזוג אוויר', 'מערכות כיבוי אש', 'שערים וחניה', 'גינון', 'הדברה', 'אינטרקום'].map(x => `<option value="${x}">`).join('')}</datalist></div>
      <div class="field"><label for="vContact">איש קשר</label><input class="input" id="vContact" name="contact" maxlength="80" value="${esc(v.contact_name || '')}"></div>
      <div class="field"><label for="vPhone">טלפון</label><input class="input" id="vPhone" name="phone" type="tel" dir="ltr" maxlength="20" value="${esc(v.phone || '')}"></div>
      <div class="field"><label for="vEmail">אימייל</label><input class="input" id="vEmail" name="email" type="email" dir="ltr" maxlength="120" value="${esc(v.email || '')}"></div>
    </div>
    <div class="field"><label for="vNotes">הערות (חוזה, זמינות, תנאים)</label><textarea class="textarea" id="vNotes" name="notes" maxlength="2000">${esc(v.notes || '')}</textarea></div>
    ${id ? `<label class="check" style="margin-bottom:14px"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}><span>ספק פעיל</span></label>` : ''}
    <p class="form-error" role="alert"></p><button class="btn btn-gold btn-block" type="submit">שמירה</button></form>`, (ov) => {
    $('#vForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      if (f.name.value.trim().length < 2 || f.trade.value.trim().length < 2) return formErr(ov, 'יש להזין שם ותחום.');
      try { await api.saveVendor({ ...(id ? { id, active: f.active.checked } : {}), name: f.name.value.trim(), trade: f.trade.value.trim(), contact_name: f.contact.value.trim() || null, phone: f.phone.value.trim() || null, email: f.email.value.trim() || null, notes: f.notes.value.trim() || null }); toast('הספק נשמר'); closeSheet(); C.data.vendors = await api.vendors(); render(); }
      catch (x) { formErr(ov, errMsg(x)); }
    });
  });
}
function interventionSheet() {
  sheet('התערבות ספק', `<form id="ivForm">
    <div class="field"><label for="ivV">ספק</label><select class="select" id="ivV" name="vendor" required>${C.data.vendors.filter(v => v.active).map(v => `<option value="${v.id}">${esc(v.name)} · ${esc(v.trade)}</option>`).join('') || '<option value="">אין ספקים — הוסיפו ספק תחילה</option>'}</select></div>
    <div class="props" style="margin-bottom:14px"><div class="field"><label for="ivD">מועד</label><input class="input" type="datetime-local" id="ivD" name="when"></div><div class="field"><label for="ivC">עלות (₪)</label><input class="input" type="number" min="0" step="1" id="ivC" name="cost"></div></div>
    <div class="field"><label for="ivN">הערות</label><textarea class="textarea" id="ivN" name="notes" maxlength="2000"></textarea></div>
    <p class="form-error" role="alert"></p><button class="btn btn-gold btn-block" type="submit">שמירה</button></form>`, (ov) => {
    $('#ivForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      if (!f.vendor.value) return formErr(ov, 'יש לבחור ספק.');
      try { await api.saveIntervention({ ticket_id: C.drawer, vendor_id: Number(f.vendor.value), status: 'planned', scheduled_at: f.when.value ? new Date(f.when.value).toISOString() : null, cost: f.cost.value ? Number(f.cost.value) : null, notes: f.notes.value.trim() || null }); toast('ההתערבות נשמרה'); closeSheet(); C.data.interventions = await api.interventions(); refreshDrawer(); }
      catch (x) { formErr(ov, errMsg(x)); }
    });
  });
}
function bulkAptSheet() {
  sheet('הוספת דירות', `<form id="baForm"><p class="muted" style="margin-top:0">הוסיפו טווח של מספרי דירות לכניסה. דירות קיימות לא ישוכפלו.</p>
    <div class="props" style="margin-bottom:14px">
      <div class="field"><label for="baT">כניסה</label><select class="select" id="baT" name="tower">${ENTRANCES.map(e => `<option value="${e.id}">כניסה ${e.id} · בניין ${e.tower}</option>`).join('')}</select></div>
      <div class="field"><label for="baF">קומה (לא חובה)</label><input class="input" id="baF" name="floor" inputmode="numeric"></div>
      <div class="field"><label for="baA">ממספר</label><input class="input" id="baA" name="from" inputmode="numeric" required></div>
      <div class="field"><label for="baB">עד מספר</label><input class="input" id="baB" name="to" inputmode="numeric" required></div>
    </div><p class="form-error" role="alert"></p><button class="btn btn-gold btn-block" type="submit">הוספה</button></form>`, (ov) => {
    $('#baForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const a = Number(f.from.value), b = Number(f.to.value), tw = Number(f.tower.value);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b - a > 120) return formErr(ov, 'טווח לא תקין (עד 120 דירות בכל פעם).');
      const existing = new Set(C.data.apartments.filter(x => x.entrance === tw).map(x => String(x.number)));
      const rows = []; for (let n = a; n <= b; n++) if (!existing.has(String(n))) rows.push({ entrance: tw, number: String(n), floor: f.floor.value !== '' ? Number(f.floor.value) : null });
      if (!rows.length) return formErr(ov, 'כל הדירות בטווח כבר קיימות.');
      try { await api.addApartments(rows); toast(`${rows.length} דירות נוספו`); closeSheet(); C.data.apartments = await api.apartments(); render(); }
      catch (x) { formErr(ov, errMsg(x)); }
    });
  });
}
function aptSheet(id) {
  const a = aptOf(id);
  sheet(esc(aptLabel(a)), `<form id="apForm">
    <div class="props" style="margin-bottom:14px"><div class="field"><label for="apF">קומה</label><input class="input" id="apF" name="floor" inputmode="numeric" value="${a.floor ?? ''}"></div>
    <div class="field"><label for="apL">משפחה / הערה פנימית</label><input class="input" id="apL" name="label" maxlength="80" value="${esc(a.label || '')}"></div></div>
    <label class="check" style="margin-bottom:14px"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}><span>דירה פעילה</span></label>
    <p class="hint">הערה זו גלויה לצוות בלבד.</p><p class="form-error" role="alert"></p><button class="btn btn-gold btn-block" type="submit">שמירה</button></form>`, (ov) => {
    $('#apForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      try { await api.updateApartment(id, { floor: f.floor.value !== '' ? Number(f.floor.value) : null, label: f.label.value.trim() || null, active: f.active.checked }); toast('הדירה עודכנה'); closeSheet(); C.data.apartments = await api.apartments(); render(); }
      catch (x) { formErr(ov, errMsg(x)); }
    });
  });
}
function towerSheet(id) {
  const tw = C.data.towers.find(x => x.id === id) || {};
  sheet(`בניין ${id}`, `<form id="twForm"><div class="props" style="margin-bottom:14px"><div class="field"><label for="twF">מספר קומות</label><input class="input" id="twF" name="floors" inputmode="numeric" value="${tw.floors ?? ''}"></div>
    <div class="field"><label for="twA">כתובת</label><input class="input" id="twA" name="address" maxlength="160" value="${esc(tw.address || '')}"></div></div>
    <div class="field"><label for="twN">מידע לדיירים (מוצג באפליקציה)</label><textarea class="textarea" id="twN" name="notes" maxlength="2000" placeholder="קוד חניון, שעות ועד, מיקום חדר אשפה…">${esc(tw.notes || '')}</textarea></div>
    <p class="form-error" role="alert"></p><button class="btn btn-gold btn-block" type="submit">שמירה</button></form>`, (ov) => {
    $('#twForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      try { await api.updateTower(id, { floors: f.floors.value ? Number(f.floors.value) : null, address: f.address.value.trim() || null, notes: f.notes.value.trim() || null }); toast('פרטי הבניין נשמרו'); closeSheet(); C.data.towers = await api.towers(); render(); }
      catch (x) { formErr(ov, errMsg(x)); }
    });
  });
}
async function setPin(id) {
  const a = aptOf(id);
  if (a.pin_set_at && !confirm(`להנפיק קוד חדש לכניסה ${a.entrance}, דירה ${a.number}? הקוד הקודם יבוטל וכל המכשירים המחוברים ינותקו.`)) return;
  const ov = sheet('קוד כניסה לדירה', '<div class="pin-reveal"><div class="spinner"></div></div>');
  try {
    const r = await api.adminCall('apartment_set_pin', { apartment_id: id });
    const msg = `שלום, קוד הכניסה לאפליקציית 4FLORENTINE עבור כניסה ${r.entrance}, דירה ${r.number}: ${r.pin}\n${CONFIG.residentUrl}`;
    $('.sheet-body', ov).innerHTML = `<div class="pin-reveal"><p class="muted" style="margin:0">כניסה ${r.entrance} · דירה ${esc(r.number)}</p><div class="pin">${esc(r.pin)}</div>
      <div class="banner banner-warn">${icon('alert', 'ic-sm')}<span>הקוד מוצג פעם אחת בלבד ואינו נשמר. מסרו אותו לדייר באופן אישי.</span></div>
      <button class="btn btn-night" data-act="copy" data-text="${esc(msg)}">${icon('copy', 'ic-sm')}העתקת הודעה לדייר</button></div>`;
    C.data.apartments = await api.apartments(); render();
  } catch (x) { $('.sheet-body', ov).innerHTML = `<div class="banner banner-error">${icon('alert', 'ic-sm')}<span>${esc(errMsg(x))}</span></div>`; }
}
function annSheet(id) {
  const a = id ? C.data.announcements.find(x => x.id === id) : { category: 'info', published: true, translations: {} };
  const tr = a.translations || {};
  sheet(id ? 'עריכת הודעה' : 'הודעה חדשה', `<form id="anForm">
    <div class="seg lang-tabs" role="group">${[['he', 'עברית'], ['fr', 'Français'], ['en', 'English']].map(([k, l], i) => `<button type="button" data-act="ann-lang" data-l="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
    ${['he', 'fr', 'en'].map(l => `<div data-pane="${l}" ${l !== 'he' ? 'hidden' : ''} ${l !== 'he' ? 'dir="ltr"' : ''}>
      <div class="field"><label for="anT${l}">${{ he: 'כותרת', fr: 'כותרת בצרפתית (לא חובה)', en: 'כותרת באנגלית (לא חובה)' }[l]}</label><input class="input" id="anT${l}" name="title_${l}" maxlength="140" value="${esc(l === 'he' ? a.title || '' : tr[l]?.title || '')}"></div>
      <div class="field"><label for="anB${l}">${{ he: 'תוכן', fr: 'תוכן בצרפתית', en: 'תוכן באנגלית' }[l]}</label><textarea class="textarea" id="anB${l}" name="body_${l}" maxlength="5000" style="min-height:130px">${esc(l === 'he' ? a.body || '' : tr[l]?.body || '')}</textarea></div></div>`).join('')}
    <div class="props" style="margin-bottom:14px">
      <div class="field"><label for="anC">סוג</label><select class="select" id="anC" name="category">${Object.entries(ANN_CAT).map(([k, l]) => `<option value="${k}" ${a.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="anTw">קהל יעד</label><select class="select" id="anTw" name="tower"><option value="">כל המתחם</option><optgroup label="בניין">${[1, 2, 3, 4].map(n => `<option value="t${n}" ${!a.entrance && a.tower_id === n ? 'selected' : ''}>בניין ${n} (כניסות ${entrancesOfTower(n).join(', ')})</option>`).join('')}</optgroup><optgroup label="כניסה">${ENTRANCES.map(e => `<option value="e${e.id}" ${a.entrance === e.id ? 'selected' : ''}>כניסה ${e.id}</option>`).join('')}</optgroup></select></div>
      <div class="field"><label for="anE">תאריך תפוגה</label><input class="input" type="date" id="anE" name="expires" value="${a.expires_at ? a.expires_at.slice(0, 10) : ''}"></div>
    </div>
    <label class="check" style="margin-bottom:8px"><input type="checkbox" name="pinned" ${a.pinned ? 'checked' : ''}><span>הצמדה לראש הרשימה</span></label>
    <label class="check" style="margin-bottom:14px"><input type="checkbox" name="published" ${a.published ? 'checked' : ''}><span>פרסום מיידי (אחרת נשמר כטיוטה)</span></label>
    <p class="form-error" role="alert"></p><button class="btn btn-gold btn-block" type="submit">${icon('send', 'ic-sm flip-rtl')}שמירה</button></form>`, (ov) => {
    $('#anForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      if (f.title_he.value.trim().length < 2 || f.body_he.value.trim().length < 2) return formErr(ov, 'יש להזין כותרת ותוכן בעברית.');
      const translations = {};
      for (const l of ['fr', 'en']) if (f['title_' + l].value.trim() && f['body_' + l].value.trim()) translations[l] = { title: f['title_' + l].value.trim(), body: f['body_' + l].value.trim() };
      try {
        await api.saveAnnouncement({ ...(id ? { id } : {}), title: f.title_he.value.trim(), body: f.body_he.value.trim(), translations, category: f.category.value, tower_id: f.tower.value.startsWith('t') ? Number(f.tower.value.slice(1)) : f.tower.value.startsWith('e') ? towerOfEntrance(f.tower.value.slice(1)) : null, entrance: f.tower.value.startsWith('e') ? Number(f.tower.value.slice(1)) : null, pinned: f.pinned.checked, published: f.published.checked, expires_at: f.expires.value ? new Date(f.expires.value + 'T23:59:00').toISOString() : null });
        toast(f.published.checked ? 'ההודעה פורסמה' : 'הטיוטה נשמרה'); closeSheet(); C.data.announcements = await api.announcements(); render();
      } catch (x) { formErr(ov, errMsg(x)); }
    });
  });
}
function staffSheet() {
  sheet('איש צוות חדש', `<form id="stForm">
    <div class="field"><label for="stN">שם מלא</label><input class="input" id="stN" name="name" required maxlength="80"></div>
    <div class="field"><label for="stE">אימייל</label><input class="input" id="stE" name="email" type="email" dir="ltr" required></div>
    <div class="field"><label for="stR">תפקיד</label><select class="select" id="stR" name="role">${Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="owner">בעלים</option></select></div>
    <p class="hint">תיווצר סיסמה זמנית שתוצג פעם אחת. מסרו אותה לאיש הצוות; בכניסה הראשונה ישנה אותה דרך סמל המפתח שליד שמו.</p>
    <p class="form-error" role="alert"></p><button class="btn btn-gold btn-block" type="submit">יצירת חשבון</button></form>`, (ov) => {
    $('#stForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      try {
        const r = await api.adminCall('staff_create', { full_name: f.name.value.trim(), email: f.email.value.trim(), role: f.role.value });
        $('.sheet-body', ov).innerHTML = `<div class="pin-reveal"><p style="margin:0">${esc(r.email)}</p><div class="pin" style="font-size:1.3rem;letter-spacing:.05em">${esc(r.temporary_password)}</div><div class="banner banner-warn">${icon('alert', 'ic-sm')}<span>הסיסמה הזמנית מוצגת פעם אחת בלבד.</span></div><button class="btn btn-night" data-act="copy" data-text="${esc(r.temporary_password)}">${icon('copy', 'ic-sm')}העתקה</button></div>`;
        C.data.staff = await api.staff(); render();
      } catch (x) { formErr(ov, errMsg(x)); }
    });
  });
}

/* ------------------------------------------------------------------ recherche globale */
function globalSearch(q) {
  const box = $('#gres'); if (!box) return;
  q = q.trim().toLowerCase();
  if (q.length < 1) { box.hidden = true; return; }
  const T = (C.data.tickets || []).filter(t => [t.ref, t.title, t.description].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 6);
  const A = C.data.apartments.filter(a => `${a.entrance}-${a.number}`.includes(q) || String(a.number) === q || (a.label || '').toLowerCase().includes(q)).slice(0, 5);
  const V = C.data.vendors.filter(v => [v.name, v.trade, v.contact_name].some(x => String(x || '').toLowerCase().includes(q))).slice(0, 4);
  const D = C.data.directory.filter(e => e.name.toLowerCase().includes(q) || he(TRADES, e.trade).includes(q)).slice(0, 4);
  const grp = (title, items) => items.length ? `<div class="grp">${title}</div>${items.join('')}` : '';
  const html = grp('פניות', T.map(t => `<button data-act="g-ticket" data-id="${t.id}">${icon(iconOf(CATEGORIES, t.category), 'ic-sm')}<span>${esc(t.title)}</span><small>${esc(t.ref)}</small></button>`))
    + grp('דירות', A.map(a => `<button data-act="g-apt" data-id="${a.id}">${icon('home', 'ic-sm')}<span>${esc(aptLabel(a))}${a.label ? ' · ' + esc(a.label) : ''}</span></button>`))
    + grp('ספקים', V.map(v => `<button data-act="g-page" data-p="vendors">${icon('truck', 'ic-sm')}<span>${esc(v.name)}</span><small>${esc(v.trade)}</small></button>`))
    + grp('בעלי מקצוע', D.map(e => `<button data-act="dir-entry" data-id="${e.id}">${icon('book', 'ic-sm')}<span>${esc(e.name)}</span><small>${he(TRADES, e.trade)}</small></button>`));
  box.innerHTML = html || '<div class="grp">אין תוצאות</div>';
  box.hidden = false;
}

/* ------------------------------------------------------------------ événements */
function bindPage() {
  $('#gq')?.addEventListener('input', (e) => globalSearch(e.target.value));
  $('#gq')?.addEventListener('blur', () => setTimeout(() => { const b = $('#gres'); if (b) b.hidden = true; }, 200));
  $('#tq')?.addEventListener('input', (e) => { C.f.q = e.target.value; render(); });
  $$('[data-f]').forEach(s => s.addEventListener('change', () => { C.f[s.dataset.f] = s.value; render(); }));
  $('#aq')?.addEventListener('input', (e) => { C.aptQ = e.target.value; render(); });
  $('#aTower')?.addEventListener('change', (e) => { C.aptTower = e.target.value; render(); });
  $('#dq')?.addEventListener('input', (e) => { C.dirQ = e.target.value; render(); });
  $('#dStatusF')?.addEventListener('change', (e) => { C.dirStatus = e.target.value; render(); });
  $$('[data-role]').forEach(s => s.addEventListener('change', async () => {
    try { await api.updateStaff(s.dataset.role, { role: s.value }); toast('התפקיד עודכן'); C.data.staff = await api.staff(); render(); } catch (x) { toast(errMsg(x), 'error'); }
  }));
  // Glisser-déposer du kanban
  $$('[data-drag]').forEach(card => {
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', card.dataset.drag); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  $$('[data-drop]').forEach(col => {
    col.addEventListener('dragover', (e) => { if (can.edit()) { e.preventDefault(); col.classList.add('over'); } });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('over');
      const id = Number(e.dataTransfer.getData('text/plain')), status = col.dataset.drop;
      const t = (C.data.tickets || []).find(x => x.id === id); if (!t || t.status === status) return;
      t.status = status; render();
      try { await api.updateTicket(id, { status }); toast(`סטטוס עודכן: ${he(STATUSES, status)}`); C.data.tickets = await api.tickets({ limit: 2000 }); render(); }
      catch (x) { toast(errMsg(x), 'error'); C.data.tickets = await api.tickets({ limit: 2000 }); render(); }
    });
  });
}
const actions = {
  logout: async () => { unsub?.(); unsub = null; await api.signOut(); Object.assign(C, { session: null, me: null, drawer: null, live: false }); closeDrawer(); render(); },
  'auth-mode': () => { C.authMode = C.authMode === 'login' ? 'bootstrap' : 'login'; C.authError = ''; render(); },
  nav: () => $('#crm')?.classList.toggle('nav-open'),
  reload: () => loadAll(),
  kpi: (el) => { const g = el.dataset.go ? JSON.parse(el.dataset.go) : {}; C.f = { status: 'open', priority: '', place: '', area: '', category: '', assignee: '', q: '', ...g }; location.hash = 'tickets'; },
  view: (el) => { C.view = el.dataset.v; try { localStorage.setItem('fl-crm-view', C.view); } catch { /* ignore */ } render(); },
  'f-status': (el) => { C.f.status = el.dataset.v; render(); },
  'f-clear': () => { C.f = { ...C.f, priority: '', place: '', area: '', category: '', assignee: '', q: '' }; render(); },
  'open-ticket': (el) => openTicket(Number(el.dataset.id)),
  'close-drawer': () => closeDrawer(),
  'close-sheet': () => closeSheet(),
  'new-ticket': () => newTicketSheet(),
  'new-iv': () => interventionSheet(),
  'note-kind': (el) => { const f = $('#noteForm'); f.kind.value = el.dataset.k; $$('[data-act="note-kind"]', f).forEach(b => b.setAttribute('aria-pressed', String(b === el))); f.body.placeholder = el.dataset.k === 'note' ? 'גלוי לצוות בלבד…' : 'ההודעה תוצג לדייר באפליקציה…'; },
  'vendor-form': (el) => vendorSheet(el.dataset.id ? Number(el.dataset.id) : null),
  'apt-bulk': () => bulkAptSheet(),
  'apt-form': (el) => aptSheet(Number(el.dataset.id)),
  'tower-form': (el) => towerSheet(Number(el.dataset.id)),
  'set-pin': (el) => setPin(Number(el.dataset.id)),
  'apt-disable': async (el) => {
    const a = aptOf(Number(el.dataset.id));
    if (!confirm(`לנתק את הגישה של כניסה ${a.entrance}, דירה ${a.number}? הדיירים יידרשו לקוד חדש.`)) return;
    try { await api.adminCall('apartment_disable', { apartment_id: a.id }); toast('הגישה נותקה'); C.data.apartments = await api.apartments(); render(); } catch (x) { toast(errMsg(x), 'error'); }
  },
  copy: async (el) => { try { await navigator.clipboard.writeText(el.dataset.text); toast('הועתק'); } catch { toast('לא ניתן להעתיק אוטומטית', 'error'); } },
  'ann-form': (el) => annSheet(el.dataset.id ? Number(el.dataset.id) : null),
  'ann-lang': (el) => { const f = el.closest('form'); $$('[data-act="ann-lang"]', f).forEach(b => b.setAttribute('aria-pressed', String(b === el))); $$('[data-pane]', f).forEach(p => { p.hidden = p.dataset.pane !== el.dataset.l; }); },
  'ann-del': async (el) => { if (!confirm('למחוק את ההודעה?')) return; try { await api.deleteAnnouncement(Number(el.dataset.id)); toast('ההודעה נמחקה'); C.data.announcements = await api.announcements(); render(); } catch (x) { toast(errMsg(x), 'error'); } },
  'dir-entry': (el) => dirEntrySheet(Number(el.dataset.id)),
  'dir-status': async (el) => { try { await api.saveEntry({ id: Number(el.dataset.id), status: el.dataset.s }); toast('הסטטוס עודכן'); C.data.directory = await api.directory(); render(); dirEntrySheet(Number(el.dataset.id)); } catch (x) { toast(errMsg(x), 'error'); } },
  'dir-restore': async (el) => { try { await api.restoreVersion(Number(el.dataset.id), Number(el.dataset.v)); toast(`גרסה ${el.dataset.v} שוחזרה`); C.data.directory = await api.directory(); render(); dirEntrySheet(Number(el.dataset.id)); } catch (x) { toast(errMsg(x), 'error'); } },
  'resolve-report': async (el) => { try { await api.resolveReport(Number(el.dataset.id)); toast('הדיווח סומן כמטופל'); C.data.reports = await api.directoryReports(); render(); } catch (x) { toast(errMsg(x), 'error'); } },
  'staff-form': () => staffSheet(),
  'my-pass': () => sheet('שינוי סיסמה', `<form id="pwForm">
    <div class="field"><label for="pw1">סיסמה חדשה (10 תווים לפחות)</label><input class="input" id="pw1" type="password" dir="ltr" autocomplete="new-password" minlength="10" required></div>
    <div class="field"><label for="pw2">אימות הסיסמה</label><input class="input" id="pw2" type="password" dir="ltr" autocomplete="new-password" required></div>
    <p class="form-error" role="alert"></p><button class="btn btn-gold btn-block" type="submit">${icon('key', 'ic-sm')}שמירה</button></form>`, (ov) => {
    $('#pwForm', ov).addEventListener('submit', async (e) => {
      e.preventDefault(); const a = $('#pw1', ov).value, b = $('#pw2', ov).value;
      if (a.length < 10) return formErr(ov, 'הסיסמה חייבת להכיל 10 תווים לפחות.');
      if (a !== b) return formErr(ov, 'הסיסמאות אינן תואמות.');
      try { await api.changeSecret(a); toast('הסיסמה שונתה'); closeSheet(); } catch (x) { formErr(ov, errMsg(x)); }
    });
  }),
  'staff-active': async (el) => { try { await api.updateStaff(el.dataset.id, { active: el.dataset.v === 'true' }); C.data.staff = await api.staff(); render(); } catch (x) { toast(errMsg(x), 'error'); } },
  'g-ticket': (el) => { location.hash = 'tickets'; openTicket(Number(el.dataset.id)); },
  'g-apt': (el) => { const a = aptOf(Number(el.dataset.id)); C.aptTower = String(a.entrance); C.aptQ = String(a.number); location.hash = 'buildings'; render(); },
  'g-page': (el) => { location.hash = el.dataset.p; },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  if (el.tagName === 'TR' && e.target.closest('a, button:not([data-act="open-ticket"]):not([data-act="dir-entry"])')) return;
  e.preventDefault();
  actions[el.dataset.act](el, e);
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#gq')?.focus(); }
  if (e.key === 'Escape') { if ($('.overlay')) closeSheet(); else if (C.drawer) closeDrawer(); }
  if (e.key === 'Enter' && e.target.matches?.('.kcard')) openTicket(Number(e.target.dataset.id));
});
window.addEventListener('hashchange', () => {
  const p = location.hash.slice(1);
  C.page = PAGES.some(x => x.key === p) ? p : 'dashboard';
  $('#crm')?.classList.remove('nav-open');
  if (C.me) { render(); window.scrollTo(0, 0); }
});
window.addEventListener('online', () => { if (C.me) loadAll(); });

/* ------------------------------------------------------------------ démarrage */
(async function boot() {
  try { C.view = localStorage.getItem('fl-crm-view') || 'table'; } catch { /* ignore */ }
  const p = location.hash.slice(1); C.page = PAGES.some(x => x.key === p) ? p : 'dashboard';
  try { api = createApi('fl-crm-auth'); }
  catch { $('#root').innerHTML = `<div style="padding:40px" dir="rtl"><div class="banner banner-error">${icon('alert', 'ic-sm')}לא ניתן לטעון את רכיבי המערכת. בדקו את החיבור לאינטרנט.</div></div>`; return; }
  try { C.bootstrap = await api.bootstrapOpen(); } catch { C.bootstrap = false; }
  try { C.session = await api.session(); if (C.session) await afterAuth(); } catch { C.session = null; }
  render();
})();
