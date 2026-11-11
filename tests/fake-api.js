// TESTS UNIQUEMENT — backend simulé en mémoire (persisté dans localStorage) qui reproduit
// les règles serveur essentielles. Injecté par Playwright via window.__FL_TEST_API__.
// N'est chargé par aucune page publiée.
(function () {
  const KEY = 'fl-fake-db';
  const now = () => new Date().toISOString();
  const load = () => JSON.parse(localStorage.getItem(KEY) || 'null');
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  let db = load();
  if (!db) {
    db = {
      seq: 1, users: {
        'apt-e1-12': { id: 'u-a', pin: '482913', kind: 'apartment' },
        'apt-e3-30': { id: 'u-b', pin: '730155', kind: 'apartment' },
        'danny@test.local': { id: 'u-staff', pin: 'manager-pass', kind: 'staff' },
      },
      towers: [1, 2, 3, 4].map(id => ({ id, name: 'Tour ' + id, name_he: 'בניין ' + id, floors: null, address: null, notes: null })),
      staff: [{ user_id: 'u-staff', full_name: 'Danny', role: 'owner', active: true, created_at: now() }],
      apartments: [
        { id: 1, entrance: 1, tower_id: 1, number: '12', floor: 3, label: null, user_id: 'u-a', active: true, pin_set_at: now() },
        { id: 2, entrance: 3, tower_id: 2, number: '30', floor: 7, label: null, user_id: 'u-b', active: true, pin_set_at: now() },
      ],
      tickets: [], events: [], photos: [], vendors: [], interventions: [], announcements: [], votes: [], vote_options: [], ballots: [], proxies: [],
      directory: [], revisions: [], recos: [], reports: [],
    };
    for (const [trade, name] of [['plumbing', 'Shimon'], ['electricity', 'Moshe'], ['cleaning', 'Maryann Cleaning'], ['taxi', 'Sagi']]) {
      const e = { id: db.seq++, trade, name, phone: null, phone_public_ok: false, website: null, area: null, notes: null, status: 'active', source: 'legacy', version: 1, created_at: now(), updated_at: now() };
      db.directory.push(e); db.revisions.push({ id: db.seq++, entry_id: e.id, version: 1, change_kind: 'create', snapshot: { ...e }, created_at: now() });
    }
    save(db);
  }
  for (const k of ['votes', 'vote_options', 'ballots', 'proxies']) db[k] = db[k] || [];
  let session = JSON.parse(sessionStorage.getItem('fl-fake-session') || 'null');
  const setSession = (s) => { session = s; sessionStorage.setItem('fl-fake-session', JSON.stringify(s)); };
  const fail = (m) => { const e = new Error(m); throw e; };
  const delay = (v) => new Promise(r => setTimeout(() => r(v), 60));
  const uid = () => session?.user?.id;
  const isStaff = () => db.staff.some(s => s.user_id === uid() && s.active);
  const myApt = () => db.apartments.find(a => a.user_id === uid() && a.active);
  const ref = (id) => 'FL-' + String(id).padStart(5, '0');
  const inVote = (v, a) => !!a && a.active !== false && a.can_vote !== false && (!v.scope_tower || a.tower_id === v.scope_tower) && (!v.scope_entrance || a.entrance === v.scope_entrance);
  const ev = (ticket_id, kind, extra = {}) => db.events.push({ id: db.seq++, ticket_id, kind, actor_kind: isStaff() ? 'staff' : 'resident', is_public: true, created_at: now(), ...extra });
  const overview = (e) => { const r = db.recos.filter(x => x.entry_id === e.id); return { ...e, reco_count: r.length, avg_rating: r.length ? r.reduce((a, b) => a + b.rating, 0) / r.length : 0, open_reports: db.reports.filter(x => x.entry_id === e.id && !x.resolved_at).length }; };
  const revise = (e, kind) => db.revisions.push({ id: db.seq++, entry_id: e.id, version: e.version, change_kind: kind, snapshot: { trade: e.trade, name: e.name, phone: e.phone, phone_public_ok: e.phone_public_ok, website: e.website, area: e.area, notes: e.notes, status: e.status }, created_at: now() });
  const api = {
    sb: null,
    async session() { return session; },
    onAuth() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signInApartment(entrance, number, pin) {
      const u = db.users[`apt-e${entrance}-${String(number).toLowerCase()}`];
      if (!u || u.pin !== pin) fail('Invalid login credentials');
      setSession({ user: { id: u.id } }); return delay({});
    },
    async signInStaff(email, pw) { const u = db.users[email]; if (!u || u.pin !== pw) fail('Invalid login credentials'); setSession({ user: { id: u.id, email } }); return delay({}); },
    async signUpStaff() { fail('signups disabled in tests'); },
    async changeSecret() { return delay({}); },
    async signOut() { setSession(null); },
    async towers() { return delay(db.towers); },
    async myApartment() { const a = myApt(); return delay(a ? { id: a.id, entrance: a.entrance, tower_id: a.tower_id, number: a.number, floor: a.floor } : null); },
    async meStaff() { return delay(db.staff.find(s => s.user_id === uid()) || null); },
    async bootstrapOpen() { return delay(db.staff.length === 0); },
    async claimOwner() { fail('bootstrap_closed'); },
    async tickets() {
      db = load();
      const list = isStaff() ? db.tickets : db.tickets.filter(t => t.apartment_id === myApt()?.id);
      return delay([...list].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    },
    async ticket(id) {
      db = load();
      const t = db.tickets.find(x => x.id === id && (isStaff() || x.apartment_id === myApt()?.id)); if (!t) fail('not found');
      return delay({ ticket: t, events: db.events.filter(e => e.ticket_id === id && (isStaff() || e.is_public)), photos: db.photos.filter(p => p.ticket_id === id) });
    },
    async createTicket(p, files = []) {
      db = load();
      const a = myApt(); if (!a && !isStaff()) fail('not_member');
      const id = db.seq++;
      const t = { ...p, id, ref: ref(id), status: 'new', assignee_id: null, vendor_id: null, source: isStaff() ? 'staff' : 'resident', created_at: now(), updated_at: now(), resolved_at: null, closed_at: null };
      if (!isStaff()) { t.apartment_id = a.id; if (p.location === 'apartment') { t.entrance = a.entrance; t.floor = a.floor; t.area = 'apartment'; } }
      const towerOf = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 3, 6: 4 };
      if (['parking_1', 'parking_2'].includes(t.area) || ['robotic_parking', 'parking_gate'].includes(t.category)) { t.entrance = null; t.location = 'common'; t.area = t.area && t.area !== 'apartment' ? t.area : (t.category === 'robotic_parking' ? 'parking_1' : 'parking_2'); }
      t.tower_id = towerOf[t.entrance] || null;
      db.tickets.push(t); ev(id, 'created', { to_value: 'new', actor_kind: isStaff() ? 'staff' : 'resident' });
      for (const f of files) { const path = `${id}/${db.seq++}.jpg`; db.photos.push({ id: db.seq++, ticket_id: id, path, created_at: now(), _name: f.name }); ev(id, 'photo', { to_value: path }); }
      save(db); return delay({ ticket: t, photoErrors: 0 });
    },
    async addPhoto(id) { db = load(); const path = `${id}/${db.seq++}.jpg`; db.photos.push({ id: db.seq++, ticket_id: id, path, created_at: now() }); ev(id, 'photo', { to_value: path }); save(db); return delay({}); },
    async photoUrls(paths) { return Object.fromEntries(paths.map(p => [p, '../assets/brand/logo-512.webp'])); },
    async comment(id, body, internal) { db = load(); ev(id, internal ? 'note' : 'comment', { body, is_public: !internal }); save(db); return delay({}); },
    async cancelTicket(id) { db = load(); const t = db.tickets.find(x => x.id === id); if (t.status !== 'new') fail('cannot_cancel'); t.status = 'cancelled'; ev(id, 'status', { from_value: 'new', to_value: 'cancelled' }); save(db); return delay(); },
    async updateTicket(id, patch) {
      db = load(); if (!isStaff()) fail('forbidden');
      const t = db.tickets.find(x => x.id === id);
      if (patch.assignee_id && !t.assignee_id && (patch.status || t.status) === 'new') patch.status = 'assigned';
      for (const k of ['status', 'priority', 'assignee_id', 'vendor_id']) if (k in patch && patch[k] !== t[k]) {
        const name = (v) => k === 'assignee_id' ? db.staff.find(s => s.user_id === v)?.full_name : k === 'vendor_id' ? db.vendors.find(s => s.id === v)?.name : v;
        ev(id, k === 'assignee_id' ? 'assignee' : k === 'vendor_id' ? 'vendor' : k, { from_value: name(t[k]), to_value: name(patch[k]), is_public: k === 'status' });
      }
      Object.assign(t, patch, { updated_at: now() });
      if (['resolved', 'closed'].includes(t.status)) t.resolved_at ||= now(); else { t.resolved_at = null; t.closed_at = null; }
      if (t.status === 'closed') t.closed_at ||= now();
      save(db); return delay(t);
    },
    subscribeTickets() { return () => {}; },
    async announcements() { db = load(); const a = myApt(); return delay(db.announcements.filter(x => isStaff() || (x.published && (!x.tower_id || x.tower_id === a?.tower_id)))); },
    async saveAnnouncement(a) { db = load(); if (a.id) Object.assign(db.announcements.find(x => x.id === a.id), a); else db.announcements.unshift({ ...a, id: db.seq++, starts_at: a.starts_at || now(), created_at: now(), translations: a.translations || {} }); save(db); return delay({}); },
    async deleteAnnouncement(id) { db = load(); db.announcements = db.announcements.filter(x => x.id !== id); save(db); return delay(); },
    async directory() { db = load(); return delay(db.directory.filter(e => isStaff() || e.status !== 'hidden').map(overview)); },
    async directoryEntry(id) { db = load(); const e = db.directory.find(x => x.id === id); return delay({ entry: overview(e), recos: db.recos.filter(r => r.entry_id === id), revisions: db.revisions.filter(r => r.entry_id === id).sort((a, b) => b.version - a.version) }); },
    async saveEntry(entry) {
      db = load();
      if (entry.phone && !entry.phone_public_ok) fail('directory_phone_consent');
      let e;
      if (entry.id) { e = db.directory.find(x => x.id === entry.id); Object.assign(e, entry, { version: e.version + 1, updated_at: now() }); revise(e, 'edit'); }
      else { e = { ...entry, id: db.seq++, status: 'active', source: 'resident', version: 1, created_at: now(), updated_at: now() }; db.directory.push(e); revise(e, 'create'); }
      save(db); return delay(e);
    },
    async restoreVersion(id, v) { db = load(); const e = db.directory.find(x => x.id === id); const s = db.revisions.find(r => r.entry_id === id && r.version === v).snapshot; Object.assign(e, s, { version: e.version + 1 }); revise(e, 'restore'); save(db); return delay(); },
    async recommend(id, rating, comment) { db = load(); if (db.recos.some(r => r.entry_id === id && r.author === uid())) fail('duplicate key'); db.recos.push({ id: db.seq++, entry_id: id, author: uid(), rating, comment, created_at: now() }); save(db); return delay(); },
    async reportEntry(id, reason, details) { db = load(); db.reports.push({ id: db.seq++, entry_id: id, reason, details, reported_by: uid(), created_at: now(), resolved_at: null }); save(db); return delay(); },
    async directoryReports() { db = load(); return delay(db.reports.filter(r => !r.resolved_at)); },
    async resolveReport(id) { db = load(); db.reports.find(r => r.id === id).resolved_at = now(); save(db); return delay(); },
    async legacySuggestions() { return delay([]); },
    /* votes (simulation des règles serveur) */
    async votes() { db = load(); const a = myApt(); return delay(db.votes.filter(v => isStaff() || (v.status !== 'draft' && inVote(v, a))).map(v => ({ ...v, vote_options: db.vote_options.filter(o => o.vote_id === v.id).sort((x, y) => x.position - y.position) }))); },
    async voteSummary(id) {
      db = load(); const v = db.votes.find(x => x.id === id);
      if (!isStaff() && v.status === 'open' && !v.live_results) return delay({ hidden: true });
      const elig = db.apartments.filter(a => inVote(v, a)), w = (a) => v.weighted ? (a.vote_weight || 1) : 1;
      const bs = db.ballots.filter(b => b.vote_id === id);
      const options = db.vote_options.filter(o => o.vote_id === id).map(o => { const ob = bs.filter(b => b.option_id === o.id); return { ...o, count: ob.length, weight: ob.reduce((s, b) => s + w(db.apartments.find(a => a.id === b.apartment_id)), 0) }; });
      const ew = elig.reduce((s, a) => s + w(a), 0), yes = options.filter(o => o.kind === 'yes').reduce((s, o) => s + o.weight, 0), no = options.filter(o => o.kind === 'no').reduce((s, o) => s + o.weight, 0);
      const need = { majority_all: ew / 2, two_thirds_all: ew * 2 / 3, three_quarters_all: ew * 3 / 4 }[v.rule];
      const hasYes = options.some(o => o.kind === 'yes');
      return delay({ hidden: false, status: v.status, rule: v.rule, weighted: v.weighted, eligible_count: elig.length, eligible_weight: ew, cast_count: bs.length, cast_weight: bs.reduce((s, b) => s + w(db.apartments.find(a => a.id === b.apartment_id)), 0), yes_weight: yes, no_weight: no, threshold_weight: need ?? null, passed: hasYes ? (v.rule === 'majority_cast' ? yes > no : v.rule === 'majority_all' ? yes > need : yes >= need) : null, options });
    },
    async myBallots() { db = load(); const a = myApt(); return delay(db.ballots.filter(b => b.apartment_id === a?.id || db.proxies.some(p => p.id === b.proxy_id && p.holder_apartment === a?.id))); },
    async castBallot(vote, option, forApt) {
      db = load(); const me = myApt(); const v = db.votes.find(x => x.id === vote);
      if (v.status !== 'open') fail('vote_closed');
      const target = forApt || me.id; let method = 'direct', proxy = null;
      if (target !== me.id) {
        proxy = db.proxies.find(p => p.grantor_apartment === target && p.holder_apartment === me.id && p.status === 'active' && (!p.vote_id || p.vote_id === vote));
        if (!proxy) fail('no_proxy');
        if (db.ballots.some(b => b.vote_id === vote && b.apartment_id === target && b.method !== 'proxy')) fail('owner_already_voted');
        method = 'proxy';
      }
      db.ballots = db.ballots.filter(b => !(b.vote_id === vote && b.apartment_id === target));
      db.ballots.push({ id: db.seq++, vote_id: vote, apartment_id: target, option_id: option, method, proxy_id: proxy?.id || null, cast_at: now() });
      save(db); return delay(method);
    },
    async myProxies() {
      db = load(); const me = myApt(); const lab = (id) => { const a = db.apartments.find(x => x.id === id); return a ? `E${a.entrance}-${a.number}` : null; };
      return delay(db.proxies.filter(p => (p.grantor_apartment === me.id || p.holder_apartment === me.id) && ['pending', 'awaiting_approval', 'active', 'rejected'].includes(p.status)).map(p => {
        const given = p.grantor_apartment === me.id;
        return { ...p, direction: given ? 'given' : 'received', other_label: given ? lab(p.holder_apartment) : lab(p.grantor_apartment), other_apartment: given ? p.holder_apartment : p.grantor_apartment, vote_title: db.votes.find(v => v.id === p.vote_id)?.title };
      }));
    },
    async grantProxy(entrance, number, vote, validUntil) {
      db = load(); const me = myApt(); const h = db.apartments.find(a => a.entrance === Number(entrance) && a.number === String(number));
      if (!h) fail('holder_not_found'); if (h.id === me.id) fail('self_proxy');
      db.proxies.forEach(p => { if (p.grantor_apartment === me.id && (p.vote_id || 0) === (vote || 0) && ['pending', 'awaiting_approval', 'active'].includes(p.status)) p.status = 'revoked'; });
      const id = db.seq++; db.proxies.push({ id, grantor_apartment: me.id, holder_apartment: h.id, vote_id: vote, valid_until: validUntil, status: 'pending', source: 'app', created_at: now() }); save(db); return delay(id);
    },
    async respondProxy(id, accept) { db = load(); const p = db.proxies.find(x => x.id === id); if (p.holder_apartment !== myApt().id) fail('forbidden'); p.status = accept ? 'awaiting_approval' : 'rejected'; p.responded_at = now(); save(db); return delay(); },
    async revokeProxy(id) { db = load(); db.proxies.find(x => x.id === id).status = 'revoked'; save(db); return delay(); },
    async saveVote(vote, options) {
      db = load(); let v;
      if (vote.id) { v = db.votes.find(x => x.id === vote.id); Object.assign(v, vote); } else { v = { status: 'draft', translations: {}, allow_proxies: true, ...vote, id: db.seq++, created_at: now() }; db.votes.unshift(v); }
      if (options) { db.vote_options = db.vote_options.filter(o => o.vote_id !== v.id); options.forEach((o, i) => db.vote_options.push({ ...o, id: db.seq++, vote_id: v.id, position: i + 1 })); }
      save(db); return delay(v);
    },
    async setVoteStatus(id, status) { db = load(); const v = db.votes.find(x => x.id === id); v.status = status; if (status === 'closed') v.closed_at = now(); save(db); return delay(v); },
    async voteParticipation(id) { db = load(); const v = db.votes.find(x => x.id === id); return delay(db.apartments.filter(a => inVote(v, a)).map(a => { const b = db.ballots.find(x => x.vote_id === id && x.apartment_id === a.id); return { apartment_id: a.id, entrance: a.entrance, number: a.number, method: b?.method || null, cast_at: b?.cast_at || null, option_id: v.secret ? null : b?.option_id || null, holder_label: null }; })); },
    async proxies() { db = load(); return delay(db.proxies); },
    async approveProxy(id, approve, reason) { db = load(); const p = db.proxies.find(x => x.id === id); if (p.status !== 'awaiting_approval') fail('proxy_not_awaiting'); p.status = approve ? 'active' : 'rejected'; p.rejected_reason = approve ? null : reason; save(db); return delay(); },
    async staffRegisterProxy(g, h, name, vote, until, note) { db = load(); const id = db.seq++; db.proxies.push({ id, grantor_apartment: g, holder_apartment: h, holder_name: name, vote_id: vote, valid_until: until, status: 'active', source: 'paper', note, created_at: now() }); save(db); return delay(id); },
    async staffCastBallot(vote, option, apt) { db = load(); db.ballots = db.ballots.filter(b => !(b.vote_id === vote && b.apartment_id === apt)); db.ballots.push({ id: db.seq++, vote_id: vote, apartment_id: apt, option_id: option, method: 'assembly', cast_at: now() }); save(db); return delay(); },
    async staff() { db = load(); return delay(db.staff); },
    async updateStaff(id, p) { db = load(); Object.assign(db.staff.find(s => s.user_id === id), p); save(db); return delay(); },
    async apartments() { db = load(); return delay(db.apartments); },
    async addApartments(rows) { db = load(); const towerOf = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 3, 6: 4 }; for (const r of rows) { if (db.apartments.some(a => a.entrance === r.entrance && a.number === r.number)) continue; db.apartments.push({ ...r, tower_id: towerOf[r.entrance], id: db.seq++, active: true, user_id: null, pin_set_at: null }); } save(db); return delay(rows); },
    async updateApartment(id, p) { db = load(); Object.assign(db.apartments.find(a => a.id === id), p); save(db); return delay(); },
    async updateTower(id, p) { db = load(); Object.assign(db.towers.find(a => a.id === id), p); save(db); return delay(); },
    async vendors() { db = load(); return delay(db.vendors); },
    async saveVendor(v) { db = load(); if (v.id) Object.assign(db.vendors.find(x => x.id === v.id), v); else db.vendors.push({ ...v, id: db.seq++, active: true, created_at: now() }); save(db); return delay(); },
    async interventions(tid) { db = load(); return delay(db.interventions.filter(i => !tid || i.ticket_id === tid)); },
    async saveIntervention(iv) { db = load(); if (iv.id) Object.assign(db.interventions.find(x => x.id === iv.id), iv); else { db.interventions.push({ ...iv, id: db.seq++, created_at: now() }); ev(iv.ticket_id, 'intervention', { to_value: iv.status, is_public: false, body: db.vendors.find(v => v.id === iv.vendor_id)?.name }); } save(db); return delay(); },
    async adminCall(action, p) {
      db = load();
      if (action === 'apartment_set_pin') { const a = db.apartments.find(x => x.id === p.apartment_id); const pin = '' + (100000 + Math.floor(Math.random() * 899999)); const k = `apt-e${a.entrance}-${a.number}`; db.users[k] = { id: a.user_id || 'u-' + db.seq++, pin, kind: 'apartment' }; a.user_id = db.users[k].id; a.pin_set_at = now(); save(db); return delay({ pin, entrance: a.entrance, tower_id: a.tower_id, number: a.number }); }
      if (action === 'apartment_disable') { const a = db.apartments.find(x => x.id === p.apartment_id); a.pin_set_at = null; save(db); return delay({ ok: true }); }
      if (action === 'staff_create') { const id = 'u-' + db.seq++; db.users[p.email] = { id, pin: 'Temp-' + id, kind: 'staff' }; db.staff.push({ user_id: id, full_name: p.full_name, role: p.role, active: true, created_at: now() }); save(db); return delay({ email: p.email, temporary_password: 'Temp-' + id }); }
      fail('unknown_action');
    },
  };
  window.__FL_TEST_API__ = api;
})();
