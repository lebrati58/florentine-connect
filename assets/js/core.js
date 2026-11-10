// 4FLORENTINE — noyau partagé : client Supabase, couche d'accès aux données, référentiels.
import { CONFIG } from './config.js';

/* ---------- Référentiels (clés stables, libellés traduits) ---------- */
export const CATEGORIES = [
  { key: 'elevator',     icon: 'elevator',  fr: 'Ascenseur',          he: 'מעלית',          en: 'Elevator' },
  { key: 'plumbing',     icon: 'droplet',   fr: 'Eau / fuite',        he: 'מים / נזילה',     en: 'Water / leak' },
  { key: 'electricity',  icon: 'zap',       fr: 'Électricité',        he: 'חשמל',           en: 'Electricity' },
  { key: 'cleaning',     icon: 'sparkles',  fr: 'Propreté',           he: 'ניקיון',          en: 'Cleaning' },
  { key: 'security',     icon: 'shield',    fr: 'Sécurité / portes',  he: 'ביטחון / דלתות',  en: 'Security / doors' },
  { key: 'ac',           icon: 'wind',      fr: 'Climatisation',      he: 'מיזוג אוויר',     en: 'Air conditioning' },
  { key: 'parking',      icon: 'car',       fr: 'Parking',            he: 'חניה',           en: 'Parking' },
  { key: 'intercom',     icon: 'intercom',  fr: 'Interphone',         he: 'אינטרקום',        en: 'Intercom' },
  { key: 'common_areas', icon: 'building',  fr: 'Parties communes',   he: 'שטחים משותפים',   en: 'Common areas' },
  { key: 'pests',        icon: 'bug',       fr: 'Nuisibles',          he: 'מזיקים',          en: 'Pests' },
  { key: 'other',        icon: 'dots',      fr: 'Autre',              he: 'אחר',            en: 'Other' },
];

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
  if (/forbidden|permission|not_member|row-level security/i.test(m)) return 'forbidden';
  return 'unknown';
}

/* ---------- Client Supabase ---------- */
export function apartmentEmail(towerId, number) {
  return `apt-${towerId}-${String(number).trim().toLowerCase()}@${CONFIG.apartmentEmailDomain}`;
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
    async signInApartment(towerId, number, pin) {
      return must(await sb.auth.signInWithPassword({ email: apartmentEmail(towerId, number), password: pin }));
    },
    async signInStaff(email, password) { return must(await sb.auth.signInWithPassword({ email, password })); },
    async signUpStaff(email, password) { return must(await sb.auth.signUp({ email, password })); },
    async changeSecret(secret) { return must(await sb.auth.updateUser({ password: secret })); },
    async signOut() { await sb.auth.signOut(); },

    /* Référentiel */
    async towers() { return must(await sb.from('towers').select('*').order('id')); },
    async myApartment() { return must(await sb.from('apartments').select('id, tower_id, number, floor').maybeSingle()); },
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

    /* CRM : équipe, appartements, fournisseurs, interventions */
    async staff() { return must(await sb.from('staff').select('*').order('full_name')); },
    async updateStaff(userId, patch) { return must(await sb.from('staff').update(patch).eq('user_id', userId)); },
    async apartments() { return must(await sb.from('apartments').select('id, tower_id, number, floor, label, active, pin_set_at, user_id').order('tower_id').order('number')); },
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
