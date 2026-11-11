// 4FLORENTINE — noyau partagé : client Supabase, couche d'accès aux données, référentiels.
import { CONFIG } from './config.js';

/* ---------- Référentiels (clés stables, libellés traduits) ---------- */
export const CATEGORIES = [
  { key: 'plumbing',        icon: 'droplet',  fr: 'Fuite / eau',               he: 'נזילה / מים',            en: 'Leak / water' },
  { key: 'elevator',        icon: 'elevator', fr: 'Ascenseur',                 he: 'מעלית',                 en: 'Elevator' },
  { key: 'robotic_parking', icon: 'robot',    fr: 'Parking robotisé (-1)',     he: 'חניון רובוטי (‎-1)', en: 'Robotic parking (-1)' },
  { key: 'parking_gate',    icon: 'gate',     fr: 'Barrière du parking (-2)',  he: 'מחסום החניון (‎-2)', en: 'Parking barrier (-2)' },
  { key: 'alarm',           icon: 'bell',     fr: 'Alarme / bruit',            he: 'אזעקה / רעש',            en: 'Alarm / noise' },
  { key: 'odor',            icon: 'odor',     fr: 'Odeurs',                    he: 'ריחות',                  en: 'Odors' },
  { key: 'noise_works',     icon: 'hammer',   fr: 'Travaux hors horaires',     he: 'עבודות בשעות אסורות',     en: 'Works at forbidden hours' },
  { key: 'beggars',         icon: 'hand',     fr: 'Mendicité',                 he: 'קבצנות',                 en: 'Begging' },
  { key: 'electricity',     icon: 'zap',      fr: 'Électricité',               he: 'חשמל',                   en: 'Electricity' },
  { key: 'cleaning',        icon: 'sparkles', fr: 'Propreté',                  he: 'ניקיון',                  en: 'Cleaning' },
  { key: 'security',        icon: 'shield',   fr: 'Portes / sécurité',         he: 'דלתות / ביטחון',          en: 'Doors / security' },
  { key: 'intercom',        icon: 'intercom', fr: 'Interphone',                he: 'אינטרקום',                en: 'Intercom' },
  { key: 'ac',              icon: 'wind',     fr: 'Climatisation',             he: 'מיזוג אוויר',             en: 'Air conditioning' },
  { key: 'pests',           icon: 'bug',      fr: 'Nuisibles',                 he: 'מזיקים',                 en: 'Pests' },
  { key: 'other',           icon: 'dots',     fr: 'Autre',                     he: 'אחר',                    en: 'Other' },
  // anciennes clés, conservées pour l'affichage des tickets existants
  { key: 'parking',         icon: 'car',      fr: 'Parking',                   he: 'חניה',                   en: 'Parking', hidden: true },
  { key: 'common_areas',    icon: 'building', fr: 'Parties communes',          he: 'שטחים משותפים',           en: 'Common areas', hidden: true },
];

/* Zones de la résidence. Les parkings sont communs aux 4 tours. */
export const AREAS = [
  { key: 'apartment', icon: 'home',     fr: 'Appartement',              he: 'בתוך הדירה',      en: 'Apartment' },
  { key: 'lobby',     icon: 'building', fr: 'Lobby',                    he: 'לובי',           en: 'Lobby',                perEntrance: true },
  { key: 'parking_1', icon: 'car',      fr: 'Parking -1',               he: 'חניון ‎-1',  en: 'Parking -1' },
  { key: 'parking_2', icon: 'car',      fr: 'Parking -2',               he: 'חניון ‎-2',  en: 'Parking -2' },
  { key: 'stairs',    icon: 'stairs',   fr: 'Escaliers / paliers',      he: 'חדר מדרגות',     en: 'Stairs / landings',    perEntrance: true },
  { key: 'garbage',   icon: 'trash',    fr: 'Local poubelles',          he: 'חדר אשפה',       en: 'Garbage room',         perEntrance: true },
  { key: 'roof',      icon: 'roof',     fr: 'Toit',                     he: 'גג',             en: 'Roof',                 perEntrance: true },
  { key: 'outside',   icon: 'pin',      fr: 'Abords de l’immeuble',     he: 'מחוץ לבניין',     en: 'Outside the building', perEntrance: true },
  { key: 'other',     icon: 'dots',     fr: 'Autre endroit',            he: 'מקום אחר',        en: 'Somewhere else' },
];
export const COMMON_AREAS = AREAS.filter(a => a.key !== 'apartment');
export const isParking = (area) => area === 'parking_1' || area === 'parking_2';
/* Catégories qui fixent la zone d'elles-mêmes */
export const CATEGORY_AREA = { robotic_parking: 'parking_1', parking_gate: 'parking_2' };

/* 6 entrées réparties en 4 tours : 1-2 → tour 1 · 3 → tour 2 · 4-5 → tour 3 · 6 → tour 4 */
export const ENTRANCES = [
  { id: 1, tower: 1 }, { id: 2, tower: 1 }, { id: 3, tower: 2 },
  { id: 4, tower: 3 }, { id: 5, tower: 3 }, { id: 6, tower: 4 },
];
export const towerOfEntrance = (e) => (ENTRANCES.find(x => x.id === Number(e)) || {}).tower || null;
export const entrancesOfTower = (t) => ENTRANCES.filter(x => x.tower === Number(t)).map(x => x.id);

/* Centre municipal 106+ de Tel-Aviv-Yafo (source : tel-aviv.gov.il/Contact/Pages/106.aspx) */
export const MUNICIPAL_106 = {
  android: 'https://play.google.com/store/apps/details?id=gov.telaviv.hazardreports106',
  ios: 'https://apps.apple.com/app/id1139774362',
  whatsapp: 'https://wa.me/972521208239',
  web: 'https://www5.tel-aviv.gov.il/TlvForms/106plus/',
  phone: '*9106',
};
export const devicePlatform = () => {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
};

export const STATUSES = [
  { key: 'new',         fr: 'Reçue',         he: 'חדשה',        en: 'Received' },
  { key: 'assigned',    fr: 'Prise en charge', he: 'שובצה',      en: 'Assigned' },
  { key: 'in_progress', fr: 'En cours',      he: 'בטיפול',      en: 'In progress' },
  { key: 'waiting',     fr: 'En attente',    he: 'בהמתנה',      en: 'On hold' },
  { key: 'resolved',    fr: 'Résolue',       he: 'טופלה',       en: 'Resolved' },
  { key: 'closed',      fr: 'Clôturée',      he: 'נסגרה',       en: 'Closed' },
  { key: 'cancelled',   fr: 'Annulée',       he: 'בוטלה',       en: 'Cancelled' },
];
export const OPEN_STATUSES = ['new', 'assigned', 'in_progress', 'waiting'];
/* Étapes visibles par le résident (progression) */
export const RESIDENT_STEPS = ['new', 'assigned', 'in_progress', 'resolved'];

export const PRIORITIES = [
  { key: 'urgent', fr: 'Urgent',  he: 'דחוף',   en: 'Urgent' },
  { key: 'high',   fr: 'Haute',   he: 'גבוהה',  en: 'High' },
  { key: 'normal', fr: 'Normale', he: 'רגילה',  en: 'Normal' },
  { key: 'low',    fr: 'Basse',   he: 'נמוכה',  en: 'Low' },
];

export const TRADES = [
  { key: 'plumbing',    icon: 'droplet',  fr: 'Plomberie',      he: 'אינסטלציה',    en: 'Plumbing' },
  { key: 'electricity', icon: 'zap',      fr: 'Électricité',    he: 'חשמל',         en: 'Electrical' },
  { key: 'ac',          icon: 'wind',     fr: 'Climatisation',  he: 'מיזוג אוויר',   en: 'Air conditioning' },
  { key: 'cleaning',    icon: 'sparkles', fr: 'Ménage',         he: 'ניקיון',        en: 'Cleaning' },
  { key: 'handyman',    icon: 'wrench',   fr: 'Bricolage',      he: 'הנדימן',        en: 'Handyman' },
  { key: 'locksmith',   icon: 'key',      fr: 'Serrurerie',     he: 'מנעולן',        en: 'Locksmith' },
  { key: 'windows',     icon: 'building', fr: 'Fenêtres / volets', he: 'חלונות / תריסים', en: 'Windows / shutters' },
  { key: 'painting',    icon: 'edit',     fr: 'Peinture',       he: 'צבע',          en: 'Painting' },
  { key: 'appliances',  icon: 'settings', fr: 'Électroménager', he: 'מכשירי חשמל',   en: 'Appliances' },
  { key: 'internet',    icon: 'globe',    fr: 'Internet / TV',  he: 'אינטרנט / טלוויזיה', en: 'Internet / TV' },
  { key: 'taxi',        icon: 'car',      fr: 'Taxi',           he: 'מוניות',        en: 'Taxi' },
  { key: 'moving',      icon: 'truck',    fr: 'Déménagement',   he: 'הובלות',        en: 'Moving' },
  { key: 'insurance',   icon: 'shield',   fr: 'Assurance',      he: 'ביטוח',         en: 'Insurance' },
  { key: 'pests',       icon: 'bug',      fr: 'Désinsectisation', he: 'הדברה',      en: 'Pest control' },
  { key: 'other',       icon: 'dots',     fr: 'Autre',          he: 'אחר',          en: 'Other' },
];

export const VOTE_RULES = [
  { key: 'majority_cast',      fr: 'Majorité des voix exprimées',          he: 'רוב קולות המצביעים',          en: 'Majority of votes cast' },
  { key: 'majority_all',       fr: 'Majorité de tous les appartements',    he: 'רוב מכלל הדירות',             en: 'Majority of all apartments' },
  { key: 'two_thirds_all',     fr: '2/3 de tous les appartements',         he: 'שני שלישים מכלל הדירות',       en: 'Two thirds of all apartments' },
  { key: 'three_quarters_all', fr: '3/4 de tous les appartements',         he: 'שלושה רבעים מכלל הדירות',      en: 'Three quarters of all apartments' },
];
export const optionText = (o, lang) => (o.translations && o.translations[lang]) || o.label;

export const label = (list, key, lang) => {
  const item = list.find(x => x.key === key);
  return item ? (item[lang] || item.fr) : key;
};
export const iconOf = (list, key) => (list.find(x => x.key === key) || {}).icon || 'dots';

/* ---------- Utilitaires ---------- */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const locale = (lang) => ({ fr: 'fr-FR', he: 'he-IL', en: 'en-GB' }[lang] || 'fr-FR');

export function fmtDate(d, lang, opts = { day: 'numeric', month: 'short' }) {
  if (!d) return '';
  return new Intl.DateTimeFormat(locale(lang), { timeZone: 'Asia/Jerusalem', ...opts }).format(new Date(d));
}
export function fmtDateTime(d, lang) {
  return fmtDate(d, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function relTime(d, lang) {
  if (!d) return '';
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(d, lang, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function toast(message, kind = 'info') {
  let host = document.querySelector('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'error' ? ' error' : '');
  t.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${kind === 'error' ? '<path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/>' : '<path d="m5 12.5 4.5 4.5L19 7.5"/>'}</svg><span></span>`;
  t.querySelector('span').textContent = message;
  host.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}

/* Compression des photos côté appareil : 1600 px max, JPEG ~0.82 */
export async function compressImage(file, max = 1600, quality = 0.82) {
  if (!file.type.startsWith('image/')) throw new Error('not_image');
  const bitmap = await (window.createImageBitmap ? createImageBitmap(file).catch(() => null) : null);
  let w, h, draw;
  if (bitmap) { w = bitmap.width; h = bitmap.height; draw = (ctx, W, H) => ctx.drawImage(bitmap, 0, 0, W, H); }
  else {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    w = img.naturalWidth; h = img.naturalHeight; draw = (ctx, W, H) => ctx.drawImage(img, 0, 0, W, H);
  }
  const scale = Math.min(1, max / Math.max(w, h));
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  draw(canvas.getContext('2d'), W, H);
  return await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
}

/* ---------- Erreurs lisibles ---------- */
export function errorKey(e) {
  const m = String(e?.message || e?.error_description || e || '');
  if (/Invalid login credentials/i.test(m)) return 'bad_credentials';
  if (/rate.?limit|too many/i.test(m)) return 'rate_limited';
  if (/Failed to fetch|NetworkError|network|Load failed|timeout/i.test(m)) return 'network';
  if (/JWT|not_authenticated|session/i.test(m)) return 'session';
  if (/directory_phone_consent/.test(m)) return 'phone_consent';
  if (/duplicate key|unique/i.test(m)) return 'duplicate';
  if (/cannot_cancel/.test(m)) return 'cannot_cancel';
  for (const k of ['vote_closed', 'not_eligible', 'no_proxy', 'owner_already_voted', 'proxies_disabled', 'holder_not_found', 'self_proxy', 'proxy_limit', 'bad_date', 'vote_locked', 'vote_without_options', 'proxy_not_pending', 'proxy_not_awaiting', 'slot_full', 'campaign_closed', 'campaign_without_slots', 'slot_not_found']) if (m.includes(k)) return k;
  if (/forbidden|permission|not_member|row-level security/i.test(m)) return 'forbidden';
  return 'unknown';
}

/* ---------- Client Supabase ---------- */
export function apartmentEmail(entrance, number) {
  return `apt-e${entrance}-${String(number).trim().toLowerCase()}@${CONFIG.apartmentEmailDomain}`;
}

export function createApi(storageKey) {
  // Les tests automatisés injectent une implémentation en mémoire ; jamais en production.
  if (window.__FL_TEST_API__) return window.__FL_TEST_API__;
  if (!window.supabase?.createClient) throw new Error('supabase_sdk_missing');
  const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey, detectSessionInUrl: false },
  });
  const must = ({ data, error }) => { if (error) throw error; return data; };

  return {
    sb,
    /* Auth */
    async session() { return (await sb.auth.getSession()).data.session; },
    onAuth(cb) { return sb.auth.onAuthStateChange((_e, s) => cb(s)); },
    async signInApartment(entrance, number, pin) {
      return must(await sb.auth.signInWithPassword({ email: apartmentEmail(entrance, number), password: pin }));
    },
    async signInStaff(email, password) { return must(await sb.auth.signInWithPassword({ email, password })); },
    async signUpStaff(email, password) { return must(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })); },
    async changeSecret(secret) { return must(await sb.auth.updateUser({ password: secret })); },
    async signOut() { await sb.auth.signOut(); },

    /* Référentiel */
    async towers() { return must(await sb.from('towers').select('*').order('id')); },
    async myApartment() { return must(await sb.from('apartments').select('id, entrance, tower_id, number, floor').maybeSingle()); },
    async meStaff() {
      const s = await this.session(); if (!s) return null;
      return must(await sb.from('staff').select('*').eq('user_id', s.user.id).maybeSingle());
    },
    async bootstrapOpen() { return must(await sb.rpc('staff_bootstrap_open')); },
    async claimOwner(fullName) { return must(await sb.rpc('claim_first_owner', { p_full_name: fullName })); },

    /* Demandes */
    async tickets({ limit = 500 } = {}) {
      return must(await sb.from('tickets').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    async ticket(id) {
      const [t, ev, ph] = await Promise.all([
        sb.from('tickets').select('*').eq('id', id).single(),
        sb.from('ticket_events').select('*').eq('ticket_id', id).order('created_at'),
        sb.from('ticket_photos').select('*').eq('ticket_id', id).order('created_at'),
      ]);
      return { ticket: must(t), events: must(ev), photos: must(ph) };
    },
    async createTicket(payload, files = []) {
      const t = must(await sb.from('tickets').insert(payload).select().single());
      const failed = [];
      for (const f of files) {
        try { await this.addPhoto(t.id, f); } catch (e) { failed.push(e); }
      }
      return { ticket: t, photoErrors: failed.length };
    },
    async addPhoto(ticketId, file) {
      const blob = await compressImage(file);
      const path = `${ticketId}/${crypto.randomUUID()}.jpg`;
      must(await sb.storage.from('ticket-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
      return must(await sb.from('ticket_photos').insert({ ticket_id: ticketId, path }).select().single());
    },
    async photoUrls(paths) {
      if (!paths.length) return {};
      const data = must(await sb.storage.from('ticket-photos').createSignedUrls(paths, 3600));
      return Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
    },
    async comment(ticketId, body, internal = false) {
      return must(await sb.from('ticket_events').insert({ ticket_id: ticketId, kind: internal ? 'note' : 'comment', body, is_public: !internal }).select().single());
    },
    async cancelTicket(id) { return must(await sb.rpc('resident_cancel_ticket', { p_ticket: id })); },
    async updateTicket(id, patch) { return must(await sb.from('tickets').update(patch).eq('id', id).select().single()); },
    subscribeTickets(cb) {
      const ch = sb.channel('tickets-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, cb)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_events' }, cb)
        .subscribe();
      return () => sb.removeChannel(ch);
    },

    /* Annonces */
    async announcements() {
      return must(await sb.from('announcements').select('*').order('pinned', { ascending: false }).order('starts_at', { ascending: false }).limit(100));
    },
    async saveAnnouncement(a) {
      const { id, ...rest } = a;
      if (id) return must(await sb.from('announcements').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).select().single());
      return must(await sb.from('announcements').insert(rest).select().single());
    },
    async deleteAnnouncement(id) { return must(await sb.from('announcements').delete().eq('id', id)); },

    /* Annuaire */
    async directory() { return must(await sb.from('directory_overview').select('*').order('trade').order('name')); },
    async directoryEntry(id) {
      const [e, r, v] = await Promise.all([
        sb.from('directory_overview').select('*').eq('id', id).single(),
        sb.from('directory_recommendations').select('*').eq('entry_id', id).order('created_at', { ascending: false }),
        sb.from('directory_revisions').select('*').eq('entry_id', id).order('version', { ascending: false }),
      ]);
      return { entry: must(e), recos: must(r), revisions: must(v) };
    },
    async saveEntry(entry) {
      const { id, ...rest } = entry;
      if (id) return must(await sb.from('directory_entries').update(rest).eq('id', id).select().single());
      return must(await sb.from('directory_entries').insert(rest).select().single());
    },
    async restoreVersion(entryId, version) { return must(await sb.rpc('restore_directory_version', { p_entry: entryId, p_version: version })); },
    async recommend(entryId, rating, comment) {
      return must(await sb.from('directory_recommendations').upsert({ entry_id: entryId, rating, comment }, { onConflict: 'entry_id,author' }).select().single());
    },
    async reportEntry(entryId, reason, details) {
      return must(await sb.from('directory_reports').insert({ entry_id: entryId, reason, details }).select().single());
    },
    async directoryReports() { return must(await sb.from('directory_reports').select('*').is('resolved_at', null).order('created_at', { ascending: false })); },
    async resolveReport(id) {
      const s = await this.session();
      return must(await sb.from('directory_reports').update({ resolved_at: new Date().toISOString(), resolved_by: s.user.id }).eq('id', id));
    },
    async legacySuggestions() {
      const { data, error } = await sb.from('directory_suggestions').select('*').limit(200);
      return error ? null : data;
    },

    /* Votes et procurations */
    async votes() {
      return must(await sb.from('votes').select('*, vote_options(*)').order('created_at', { ascending: false }).order('position', { foreignTable: 'vote_options' }));
    },
    async voteSummary(id) { return must(await sb.rpc('vote_summary', { p_vote: id })); },
    async myBallots() { return must(await sb.from('ballots').select('vote_id, apartment_id, option_id, method, cast_at')); },
    async castBallot(vote, option, forApartment = null) {
      return must(await sb.rpc('cast_ballot', { p_vote: vote, p_option: option, p_for_apartment: forApartment }));
    },
    async myProxies() { return must(await sb.rpc('my_proxies')); },
    async grantProxy(entrance, number, vote = null, validUntil = null) {
      return must(await sb.rpc('grant_proxy', { p_holder_entrance: Number(entrance), p_holder_number: String(number), p_vote: vote, p_valid_until: validUntil }));
    },
    async respondProxy(id, accept) { return must(await sb.rpc('respond_proxy', { p_proxy: id, p_accept: accept })); },
    async revokeProxy(id) { return must(await sb.rpc('revoke_proxy', { p_proxy: id })); },
    // CRM
    async saveVote(vote, options) {
      const { id, ...rest } = vote;
      const v = id ? must(await sb.from('votes').update(rest).eq('id', id).select().single())
                   : must(await sb.from('votes').insert(rest).select().single());
      if (options) {
        must(await sb.from('vote_options').delete().eq('vote_id', v.id));
        if (options.length) must(await sb.from('vote_options').insert(options.map((o, i) => ({ ...o, vote_id: v.id, position: i + 1 }))));
      }
      return v;
    },
    async setVoteStatus(id, status) { return must(await sb.from('votes').update({ status }).eq('id', id).select().single()); },
    async voteParticipation(id) { return must(await sb.rpc('vote_participation', { p_vote: id })); },
    async proxies() { return must(await sb.from('proxies').select('*').order('created_at', { ascending: false }).limit(500)); },
    async approveProxy(id, approve, reason = null) { return must(await sb.rpc('approve_proxy', { p_proxy: id, p_approve: approve, p_reason: reason })); },
    async staffRegisterProxy(grantor, holder, holderName, vote, validUntil, note) {
      return must(await sb.rpc('staff_register_proxy', { p_grantor: grantor, p_holder: holder, p_holder_name: holderName, p_vote: vote, p_valid_until: validUntil, p_note: note }));
    },
    async staffCastBallot(vote, option, apartment, note) {
      return must(await sb.rpc('staff_cast_ballot', { p_vote: vote, p_option: option, p_apartment: apartment, p_note: note }));
    },

    /* Prise de rendez-vous */
    async visitCampaigns() {
      return must(await sb.from('visit_campaigns').select('*, visit_slots(*)').order('created_at', { ascending: false }).order('starts_at', { foreignTable: 'visit_slots' }));
    },
    async myVisitBookings() { return must(await sb.from('visit_bookings').select('*')); },
    async visitSlotCounts(id) { return must(await sb.rpc('visit_slot_counts', { p_campaign: id })); },
    async bookVisit(campaign, slot, note) { return must(await sb.rpc('book_visit_slot', { p_campaign: campaign, p_slot: slot, p_note: note || null })); },
    async cancelVisit(campaign) { return must(await sb.rpc('cancel_visit_booking', { p_campaign: campaign })); },
    // CRM
    async saveCampaign(c, slots) {
      const { id, status, ...rest } = c;
      const v = id ? must(await sb.from('visit_campaigns').update(rest).eq('id', id).select().single())
                   : must(await sb.from('visit_campaigns').insert(rest).select().single());
      if (slots) {
        const keep = slots.filter(x => x.id).map(x => x.id);
        let del = sb.from('visit_slots').delete().eq('campaign_id', v.id);
        if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`);
        must(await del);
        for (const x of slots.filter(x => x.id)) must(await sb.from('visit_slots').update({ starts_at: x.starts_at, ends_at: x.ends_at, capacity: x.capacity }).eq('id', x.id));
        const add = slots.filter(x => !x.id).map(x => ({ campaign_id: v.id, starts_at: x.starts_at, ends_at: x.ends_at, capacity: x.capacity }));
        if (add.length) must(await sb.from('visit_slots').insert(add));
      }
      if (status && status !== v.status) return this.setCampaignStatus(v.id, status);
      return v;
    },
    async setCampaignStatus(id, status) { return must(await sb.from('visit_campaigns').update({ status }).eq('id', id).select().single()); },
    async visitSchedule(id) { return must(await sb.rpc('visit_schedule', { p_campaign: id })); },
    async staffBookVisit(campaign, slot, apartment, note) { return must(await sb.rpc('staff_book_visit', { p_campaign: campaign, p_slot: slot, p_apartment: apartment, p_note: note || null })); },
    async staffClearVisit(campaign, apartment) { return must(await sb.from('visit_bookings').delete().eq('campaign_id', campaign).eq('apartment_id', apartment)); },

    /* CRM : équipe, appartements, fournisseurs, interventions */
    async staff() { return must(await sb.from('staff').select('*').order('full_name')); },
    async updateStaff(userId, patch) { return must(await sb.from('staff').update(patch).eq('user_id', userId)); },
    async apartments() { return must(await sb.from('apartments').select('id, entrance, tower_id, number, floor, label, active, pin_set_at, user_id, vote_weight, can_vote').order('entrance').order('number')); },
    async addApartments(rows) { return must(await sb.from('apartments').insert(rows).select()); },
    async updateApartment(id, patch) { return must(await sb.from('apartments').update(patch).eq('id', id)); },
    async updateTower(id, patch) { return must(await sb.from('towers').update(patch).eq('id', id)); },
    async vendors() { return must(await sb.from('vendors').select('*').order('name')); },
    async saveVendor(v) {
      const { id, ...rest } = v;
      if (id) return must(await sb.from('vendors').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).select().single());
      return must(await sb.from('vendors').insert(rest).select().single());
    },
    async interventions(ticketId) {
      let q = sb.from('interventions').select('*').order('scheduled_at', { ascending: false, nullsFirst: false });
      if (ticketId) q = q.eq('ticket_id', ticketId);
      return must(await q);
    },
    async saveIntervention(iv) {
      const { id, ...rest } = iv;
      if (id) return must(await sb.from('interventions').update(rest).eq('id', id).select().single());
      return must(await sb.from('interventions').insert(rest).select().single());
    },
    async adminCall(action, payload = {}) {
      const { data, error } = await sb.functions.invoke('admin-api', { body: { action, ...payload } });
      if (error) {
        let detail = error.message;
        try { const j = await error.context?.json?.(); detail = j?.error || detail; } catch { /* ignore */ }
        throw new Error(detail);
      }
      return data;
    },
  };
}
