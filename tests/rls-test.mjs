// Banc d'essai RLS : exécute la migration réelle sur un Postgres local (PGlite)
// avec des stubs minimaux des schémas auth/storage de Supabase.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = process.argv[2].split(',').map(f => readFileSync(f, 'utf8')).join('\n');
const rollback = process.argv[3] ? process.argv[3].split(',').map(f => readFileSync(f, 'utf8')).join('\n') : null;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage; grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated;
  create publication supabase_realtime;
`);

await db.exec(migration);
await db.exec(migration); // idempotence
console.log('Migration appliquée deux fois sans erreur');

const U = {
  owner: '00000000-0000-0000-0000-000000000001', tech: '00000000-0000-0000-0000-000000000002',
  viewer: '00000000-0000-0000-0000-000000000003', A: '00000000-0000-0000-0000-00000000000a',
  B: '00000000-0000-0000-0000-00000000000b', C: '00000000-0000-0000-0000-00000000000c',
  X: '00000000-0000-0000-0000-0000000000ff',
};
for (const id of Object.values(U)) await db.query('insert into auth.users(id) values ($1)', [id]);

async function as(who, sql, params = []) {
  await db.exec('reset role');
  if (who === 'anon') {
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub','',false)`);
  } else {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [U[who]]);
    await db.exec('set role authenticated');
  }
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec('reset role'); }
}

console.log('\n— Démarrage & équipe');
ok((await as('anon', 'select public.staff_bootstrap_open() o')).rows[0].o === true, 'bootstrap ouvert au départ');
ok(!(await as('owner', `select public.claim_first_owner('Lionel')`)).error, 'premier compte devient propriétaire');
ok(/bootstrap_closed/.test((await as('X', `select public.claim_first_owner('Intrus')`)).error), 'second bootstrap refusé');
ok(!(await as('owner', `insert into public.staff(user_id,full_name,role) values ($1,'Danny','technician')`, [U.tech])).error, 'propriétaire ajoute un technicien');
ok(!(await as('owner', `insert into public.staff(user_id,full_name,role) values ($1,'Observateur','viewer')`, [U.viewer])).error, 'propriétaire ajoute un observateur');
ok(!!(await as('tech', `insert into public.staff(user_id,full_name,role) values ($1,'X','owner')`, [U.X])).error, 'technicien ne peut pas créer de compte équipe');

console.log('\n— Appartements');
ok(!(await as('owner', `insert into public.apartments(entrance,number,floor) values (1,'12',3),(3,'30',7),(2,'14',3)`)).error, 'propriétaire crée des appartements');
ok(!!(await as('tech', `insert into public.apartments(entrance,number) values (4,'1')`)).error, 'technicien ne crée pas d’appartement');
await db.exec(`update public.apartments set user_id='${U.A}' where entrance=1 and number='12';
               update public.apartments set user_id='${U.B}' where entrance=3 and number='30';
               update public.apartments set user_id='${U.C}' where entrance=2 and number='14';`);
ok((await db.query(`select tower_id from public.apartments where entrance=3`)).rows[0].tower_id === 2, 'entrée 3 → tour 2 (déduite)');
ok((await db.query(`select tower_id from public.apartments where entrance=2`)).rows[0].tower_id === 1, 'entrée 2 → tour 1 (déduite)');
ok(!(await as('owner', `insert into public.apartments(entrance,number) values (2,'12')`)).error, 'même numéro autorisé dans une autre entrée');
ok(!!(await as('owner', `insert into public.apartments(entrance,number) values (1,'12')`)).error, 'doublon entrée + numéro refusé');
ok((await as('A', 'select * from public.apartments')).rows.length === 1, 'résident ne voit que son appartement');
ok(!!(await as('A', `update public.apartments set user_id=$1`, [U.B])).error, 'résident ne peut pas réassigner un compte');
ok((await as('X', 'select * from public.apartments')).rows.length === 0, 'compte non membre : aucun appartement');

console.log('\n— Tickets');
const ins = await as('A', `insert into public.tickets(tower_id,location,category,title,description,status,priority,assignee_id)
  values (4,'apartment','plumbing','Fuite sous l''évier','Goutte à goutte','closed','urgent',$1) returning *`, [U.tech]);
ok(!ins.error, 'résident crée un ticket ' + (ins.error || ''));
const t = ins.rows?.[0] || {};
ok(t.status === 'new' && t.assignee_id === null, 'statut/responsable imposés côté serveur');
ok(t.tower_id === 1 && t.entrance === 1 && t.floor === 3 && t.area === 'apartment', 'entrée, tour, étage et zone forcés depuis l’appartement');
ok(t.ref === 'FL-' + String(t.id).padStart(5, '0'), 'référence générée ' + t.ref);
ok((await as('B', 'select * from public.tickets')).rows.length === 0, 'autre appartement : ticket invisible');
ok((await as('X', 'select * from public.tickets')).rows.length === 0, 'non-membre : ticket invisible');
ok(!!(await as('anon', 'select * from public.tickets')).error, 'anonyme : accès refusé');
ok(!!(await as('X', `insert into public.tickets(tower_id,category,title) values (1,'other','Spam spam')`)).error, 'non-membre ne peut pas créer de ticket');
{ const r = await as('A', `update public.tickets set status='resolved' where id=$1 returning id`, [t.id]); ok(!!r.error || r.rows.length === 0, 'résident ne modifie pas le statut (aucune ligne affectée)'); }
ok((await as('tech', 'select * from public.tickets')).rows.length === 1, 'gestionnaire voit le ticket');
ok(!(await as('tech', `update public.tickets set status='in_progress', assignee_id=$2, priority='high' where id=$1`, [t.id, U.tech])).error, 'gestionnaire change le statut / assigne');
ok(!!((await as('viewer', `update public.tickets set status='closed' where id=$1 returning id`, [t.id])).rows?.length === 0), 'observateur : modification sans effet');
const evA = (await as('A', 'select kind from public.ticket_events where ticket_id=$1 order by id', [t.id])).rows.map(r => r.kind);
const evS = (await as('tech', 'select kind from public.ticket_events where ticket_id=$1 order by id', [t.id])).rows.map(r => r.kind);
ok(evA.join() === 'created,status', 'résident voit création + statut : ' + evA.join());
ok(evS.includes('assignee') && evS.includes('priority'), 'équipe voit tout l’historique : ' + evS.join());
ok(!(await as('A', `insert into public.ticket_events(ticket_id,kind,body) values ($1,'comment','Merci !')`, [t.id])).error, 'résident commente');
ok(!!(await as('A', `insert into public.ticket_events(ticket_id,kind,body,is_public) values ($1,'note','x',false)`, [t.id])).error, 'résident ne crée pas de note interne');
ok(!!(await as('B', `insert into public.ticket_events(ticket_id,kind,body) values ($1,'comment','Hack')`, [t.id])).error, 'autre résident ne commente pas');
ok(!(await as('tech', `insert into public.ticket_events(ticket_id,kind,body) values ($1,'note','Pièce commandée')`, [t.id])).error, 'équipe ajoute une note interne');
ok(!(await as('A', `select 1 from public.ticket_events where kind='note'`)).rows.length, 'note interne invisible pour le résident');
ok(/cannot_cancel/.test((await as('A', 'select public.resident_cancel_ticket($1)', [t.id])).error || ''), 'annulation impossible une fois pris en charge');
const t2 = (await as('A', `insert into public.tickets(entrance,location,area,category,title) values (4,'common','lobby','alarm','Alarme du lobby') returning *`)).rows[0];
ok(t2.tower_id === 3 && t2.entrance === 4 && t2.apartment_id !== null, 'lobby entrée 4 : tour 3 déduite, déclarant suivi');
const tp = (await as('A', `insert into public.tickets(entrance,location,category,title) values (2,'apartment','robotic_parking','Parking robot en panne') returning *`)).rows[0];
ok(tp && tp.area === 'parking_1' && tp.entrance === null && tp.tower_id === null && tp.location === 'common', 'parking robotisé → zone -1, commun au complexe');
const tg = (await as('A', `insert into public.tickets(location,area,category,title) values ('common','parking_2','plumbing','Fuite parking -2') returning *`)).rows[0];
ok(tg && tg.area === 'parking_2' && tg.tower_id === null, 'fuite au parking -2 acceptée sans tour');
for (const c of ['parking_gate','odor','noise_works','beggars']) {
  const r = await as('A', `insert into public.tickets(location,area,category,title) values ('common','other',$1,'Test catégorie') returning id`, [c]);
  ok(!r.error, 'nouvelle catégorie acceptée : ' + c);
}
ok(!!(await as('A', `insert into public.tickets(location,area,category,title) values ('common','nowhere','other','Zone inconnue')`)).error, 'zone inconnue refusée');
ok(!(await as('A', 'select public.resident_cancel_ticket($1)', [t2.id])).error, 'résident annule un ticket encore nouveau');
await as('tech', `update public.tickets set status='resolved' where id=$1`, [t.id]);
ok((await as('A', 'select resolved_at from public.tickets where id=$1', [t.id])).rows[0].resolved_at, 'date de résolution horodatée');

console.log('\n— Photos (stockage privé)');
ok(!(await as('A', `insert into storage.objects(bucket_id,name) values ('ticket-photos',$1)`, [`${t.id}/a.jpg`])).error, 'résident dépose une photo sur son ticket');
ok(!!(await as('B', `insert into storage.objects(bucket_id,name) values ('ticket-photos',$1)`, [`${t.id}/b.jpg`])).error, 'autre résident ne peut pas déposer');
ok(!!(await as('A', `insert into storage.objects(bucket_id,name) values ('ticket-photos','../etc/x.jpg')`)).error, 'chemin invalide refusé');
ok((await as('B', `select * from storage.objects`)).rows.length === 0, 'photo invisible pour un autre résident');
ok(!(await as('A', `insert into public.ticket_photos(ticket_id,path) values ($1,$2)`, [t.id, `${t.id}/a.jpg`])).error, 'photo rattachée au ticket');

console.log('\n— Annonces');
await as('owner', `insert into public.announcements(title,body,tower_id) values ('Coupure d''eau','Mardi 9h-12h',2)`);
await as('owner', `insert into public.announcements(title,body,published) values ('Brouillon','Non publié',false)`);
ok((await as('A', 'select * from public.announcements')).rows.length === 0, 'annonce tour 2 / brouillon invisibles pour la tour 1');
ok((await as('B', 'select * from public.announcements')).rows.length === 1, 'annonce visible pour la tour 2');
await as('owner', `insert into public.announcements(title,body,entrance) values ('Lobby entrée 2','Peinture',2)`);
ok((await as('C', `select * from public.announcements where entrance=2`)).rows.length === 1, 'annonce ciblée entrée 2 : visible entrée 2');
ok((await as('A', `select * from public.announcements where entrance=2`)).rows.length === 0, 'annonce ciblée entrée 2 : invisible entrée 1');
ok(!!(await as('A', `insert into public.announcements(title,body) values ('Pub','spam')`)).error, 'résident ne publie pas d’annonce');

console.log('\n— Annuaire collaboratif');
ok((await as('A', 'select * from public.directory_entries')).rows.length === 17, 'ancien annuaire importé (17 fiches, sans numéro)');
ok((await as('X', 'select * from public.directory_entries')).rows.length === 0, 'non-membre : annuaire invisible');
ok(/directory_phone_consent/.test((await as('A', `insert into public.directory_entries(trade,name,phone) values ('locksmith','Avi Serrurier','050-1234567')`)).error || ''), 'numéro refusé sans accord de publication');
const e = (await as('A', `insert into public.directory_entries(trade,name,phone,phone_public_ok) values ('locksmith','Avi Serrurier','050-1234567',true) returning *`)).rows[0];
ok(e && e.version === 1 && e.source === 'resident', 'résident ajoute un professionnel');
ok(!(await as('B', `update public.directory_entries set phone='050-7654321' where id=$1`, [e.id])).error, 'voisin corrige la fiche');
ok((await as('B', 'select version from public.directory_entries where id=$1', [e.id])).rows[0].version === 2, 'version incrémentée');
ok(!(await as('B', 'select public.restore_directory_version($1,1)', [e.id])).error, 'restauration de la version 1');
const revs = (await as('A', 'select version, change_kind, snapshot->>$2 phone from public.directory_revisions where entry_id=$1 order by version', [e.id, 'phone'])).rows;
ok(revs.map(r => r.change_kind).join() === 'create,edit,restore' && revs[2].phone === '050-1234567', 'historique complet : ' + revs.map(r => r.change_kind).join());
ok(!!(await as('A', `update public.directory_entries set status='hidden' where id=$1`, [e.id])).error, 'résident ne peut pas masquer une fiche');
ok(!(await as('A', `insert into public.directory_recommendations(entry_id,rating,comment) values ($1,5,'Rapide et sérieux')`, [e.id])).error, 'recommandation ajoutée');
ok(!!(await as('A', `insert into public.directory_recommendations(entry_id,rating) values ($1,1)`, [e.id])).error, 'une seule recommandation par appartement');
for (const w of ['A', 'B', 'C']) await as(w, `insert into public.directory_reports(entry_id,reason) values ($1,'obsolete')`, [e.id]);
ok((await as('A', 'select status from public.directory_entries where id=$1', [e.id])).rows[0].status === 'obsolete', '3 signalements → fiche obsolète');
const ov = (await as('B', 'select avg_rating, reco_count from public.directory_overview where id=$1', [e.id])).rows[0];
ok(Number(ov.avg_rating) === 5 && Number(ov.reco_count) === 1, 'vue agrégée des recommandations');
ok(!(await as('tech', `update public.directory_entries set status='hidden' where id=$1`, [e.id])).error, 'équipe masque une fiche abusive');
ok((await as('A', 'select * from public.directory_entries where id=$1', [e.id])).rows.length === 0, 'fiche masquée invisible pour les résidents');
let limited = false;
const e2 = (await as('C', `insert into public.directory_entries(trade,name) values ('painting','Peintre test') returning id`)).rows[0];
for (let i = 0; i < 35 && !limited; i++) {
  const r = await as('C', `update public.directory_entries set notes=$2 where id=$1`, [e2.id, 'n' + i]);
  if (r.error && /rate_limited/.test(r.error)) limited = true;
}
ok(limited, 'anti-abus : plafond de modifications sur 24 h');

console.log('\n— Votes de copropriété et procurations');
const q1 = async (who, sql, params) => { const r = await as(who, sql, params); return r.error ? { error: r.error } : (r.rows[0] || {}); };
const v1 = (await as('owner', `insert into public.votes(title,rule) values ('Ravalement de façade','majority_cast') returning id`)).rows[0].id;
for (const [k, l, i] of [['yes','Pour',1],['no','Contre',2],['abstain','Abstention',3]])
  await as('owner', `insert into public.vote_options(vote_id,kind,label,position) values ($1,$2,$3,$4)`, [v1, k, l, i]);
const opt = Object.fromEntries((await db.query(`select kind, id from public.vote_options where vote_id=$1`, [v1])).rows.map(r => [r.kind, r.id]));
ok((await as('A', `select * from public.votes`)).rows.length === 0, 'brouillon invisible pour les résidents');
const v0 = (await as('owner', `insert into public.votes(title) values ('Sans options') returning id`)).rows[0].id;
ok(/vote_without_options/.test((await as('owner', `update public.votes set status='open' where id=$1`, [v0])).error || ''), 'impossible d’ouvrir un vote sans options');
ok(!!(await as('tech', `update public.votes set status='open' where id=$1 returning id`, [v1])).rows?.length === false, 'technicien ne peut pas ouvrir un vote');
ok(!(await as('owner', `update public.votes set status='open' where id=$1`, [v1])).error, 'gestionnaire ouvre le vote');
ok((await as('A', `select * from public.votes`)).rows.length === 1, 'vote ouvert visible par les résidents');
ok((await as('X', `select * from public.votes`)).rows.length === 0, 'non-membre : aucun vote visible');
ok(/vote_locked/.test((await as('owner', `update public.votes set rule='two_thirds_all' where id=$1`, [v1])).error || ''), 'règle verrouillée après ouverture');
ok(/vote_locked/.test((await as('owner', `insert into public.vote_options(vote_id,label) values ($1,'Ajout')`, [v1])).error || ''), 'options verrouillées après ouverture');
ok(!!(await as('A', `insert into public.ballots(vote_id,apartment_id,option_id,method) values ($1,1,$2,'direct')`, [v1, opt.yes])).error, 'insertion directe d’un bulletin refusée');
ok((await q1('A', `select public.cast_ballot($1,$2) r`, [v1, opt.yes])).r === 'direct', 'A vote pour lui-même');
ok(!(await as('A', `select public.cast_ballot($1,$2)`, [v1, opt.no])).error, 'A peut changer son vote tant que c’est ouvert');
await as('A', `select public.cast_ballot($1,$2)`, [v1, opt.yes]);
ok(/no_proxy/.test((await as('A', `select public.cast_ballot($1,$2,$3)`, [v1, opt.no, 2])).error || ''), 'voter pour un autre sans procuration : refusé');
ok(/self_proxy/.test((await as('B', `select public.grant_proxy(3::smallint,'30',$1)`, [v1])).error || ''), 'procuration à soi-même refusée');
ok(/holder_not_found/.test((await as('B', `select public.grant_proxy(5::smallint,'999',$1)`, [v1])).error || ''), 'mandataire inconnu refusé');
const px = (await q1('B', `select public.grant_proxy(2::smallint,'14',$1) id`, [v1])).id;
ok(!!px, 'B donne procuration à C (entrée 2, appt 14)');
ok(/no_proxy/.test((await as('C', `select public.cast_ballot($1,$2,2)`, [v1, opt.no])).error || ''), 'procuration non acceptée : C ne peut pas encore voter');
ok(/forbidden/.test((await as('A', `select public.respond_proxy($1,true)`, [px])).error || ''), 'seul le mandataire peut accepter');
ok(!(await as('C', `select public.respond_proxy($1,true)`, [px])).error, 'C accepte la procuration');
ok(/no_proxy/.test((await as('C', `select public.cast_ballot($1,$2,2)`, [v1, opt.no])).error || ''), 'acceptée mais pas encore validée par l’admin : C ne peut pas voter');
ok(/forbidden/.test((await as('tech', `select public.approve_proxy($1,true)`, [px])).error || ''), 'un technicien ne peut pas valider une procuration');
ok(/forbidden/.test((await as('B', `select public.approve_proxy($1,true)`, [px])).error || ''), 'le mandant ne peut pas valider sa propre procuration');
ok(!(await as('owner', `select public.approve_proxy($1,true)`, [px])).error, 'l’administrateur valide la procuration');
const myp = (await as('C', `select * from public.my_proxies()`)).rows;
ok(myp.length === 1 && myp[0].direction === 'received' && myp[0].other_label === 'E3-30', 'C voit la procuration reçue de E3-30');
ok((await q1('C', `select public.cast_ballot($1,$2,2) r`, [v1, opt.no])).r === 'proxy', 'C vote « contre » au nom de B');
ok((await as('C', `select * from public.ballots where apartment_id=2`)).rows.length === 1, 'C voit le bulletin déposé pour B');
ok((await q1('B', `select public.cast_ballot($1,$2) r`, [v1, opt.yes])).r === 'direct', 'B vote lui-même : son vote remplace celui du mandataire');
ok(/owner_already_voted/.test((await as('C', `select public.cast_ballot($1,$2,2)`, [v1, opt.no])).error || ''), 'le mandataire ne peut plus écraser le vote de B');
ok((await q1('A', `select public.vote_summary($1) s`, [v1])).s.hidden === true, 'résultats masqués aux résidents pendant le vote');
let sm = (await q1('owner', `select public.vote_summary($1) s`, [v1])).s;
ok(sm.cast_count === 2 && Number(sm.yes_weight) === 2 && sm.eligible_count === 4, `équipe : 2 votants sur 4 éligibles, 2 « pour » (${sm.cast_count}/${sm.eligible_count})`);
ok((await as('tech', `select * from public.ballot_log where vote_id=$1`, [v1])).rows.length === 5, 'journal complet des voix (changements compris)');
ok(/forbidden/.test((await as('tech', `select public.staff_cast_ballot($1,$2,4)`, [v1, opt.no])).error || ''), 'technicien ne peut pas saisir une voix d’assemblée');
{ const r = await as('owner', `select public.staff_cast_ballot($1,$2,(select id from public.apartments where entrance=2 and number='12'),'Assemblée du 12/11')`, [v1, opt.no]); ok(!r.error, 'gestionnaire saisit une voix exprimée en assemblée ' + (r.error || '')); }
await as('owner', `update public.votes set status='closed' where id=$1`, [v1]);
ok(/vote_closed/.test((await as('A', `select public.cast_ballot($1,$2)`, [v1, opt.no])).error || ''), 'vote clos : plus de bulletin');
sm = (await q1('A', `select public.vote_summary($1) s`, [v1])).s;
ok(sm.hidden === false && sm.passed === true && sm.cast_count === 3, 'vote clos : résultat visible par les résidents, adopté (2 pour / 1 contre)');

// Vote secret, pondéré, majorité des 2/3 de tous les appartements
await db.exec(`update public.apartments set vote_weight = case number when '12' then 3 else 1 end`);
const v2 = (await as('owner', `insert into public.votes(title,rule,weighted,secret,max_proxies_per_holder) values ('Travaux ascenseur','two_thirds_all',true,true,1) returning id`)).rows[0].id;
await as('owner', `insert into public.vote_options(vote_id,kind,label) values ($1,'yes','Pour'),($1,'no','Contre')`, [v2]);
const o2 = Object.fromEntries((await db.query(`select kind, id from public.vote_options where vote_id=$1`, [v2])).rows.map(r => [r.kind, r.id]));
await as('owner', `update public.votes set status='open' where id=$1`, [v2]);
await as('A', `select public.cast_ballot($1,$2)`, [v2, o2.yes]);
ok((await as('owner', `select * from public.ballots where vote_id=$1`, [v2])).rows.length === 0, 'vote secret : l’équipe ne voit aucun bulletin individuel');
const part = (await as('owner', `select * from public.vote_participation($1)`, [v2])).rows;
ok(part.some(r => r.method === 'direct' && r.option_id === null), 'vote secret : participation visible, choix masqué');
const pa = (await q1('A', `select public.grant_proxy(2::smallint,'14',$1) id`, [v2])).id;
const pb = (await q1('B', `select public.grant_proxy(2::smallint,'14',$1) id`, [v2])).id;
await as('C', `select public.respond_proxy($1,true)`, [pa]); await as('owner', `select public.approve_proxy($1,true)`, [pa]);
await as('C', `select public.respond_proxy($1,true)`, [pb]);
ok(/proxy_limit/.test((await as('owner', `select public.approve_proxy($1,true)`, [pb])).error || ''), 'plafond de procurations par mandataire respecté à la validation');
ok(!(await as('owner', `select public.approve_proxy($1,false,'Plafond atteint')`, [pb])).error, 'l’administrateur refuse avec un motif');
const rej = (await as('B', `select * from public.my_proxies()`)).rows.find(r => r.id === pb);
ok(rej && rej.status === 'rejected' && rej.rejected_reason === 'Plafond atteint', 'le mandant voit le refus et son motif');
ok(!(await as('A', `select public.revoke_proxy($1)`, [pa])).error, 'A révoque sa procuration');
ok(/no_proxy/.test((await as('C', `select public.cast_ballot($1,$2,1)`, [v2, o2.no])).error || ''), 'procuration révoquée : le mandataire ne peut plus voter');
sm = (await q1('owner', `select public.vote_summary($1) s`, [v2])).s;
ok(Number(sm.eligible_weight) === 8 && Number(sm.yes_weight) === 3 && sm.passed === false, `pondéré 2/3 : 3/8 « pour » → non adopté (${sm.yes_weight}/${sm.eligible_weight})`);
{ const ex = (await q1('owner', `select public.staff_register_proxy((select id from public.apartments where entrance=2 and number='12'), null, 'Me Cohen (avocat)', $1, null, 'Procuration signée reçue') id`, [v2])).id;
  ok(!!ex && (await db.query(`select status from public.proxies where id=$1`, [ex])).rows[0].status === 'active', 'procuration papier enregistrée par l’admin : active immédiatement'); }
const v3 = (await as('owner', `insert into public.votes(title,scope_entrance) values ('Peinture lobby entrée 3',3) returning id`)).rows[0].id;
await as('owner', `insert into public.vote_options(vote_id,kind,label) values ($1,'yes','Pour')`, [v3]);
await as('owner', `update public.votes set status='open' where id=$1`, [v3]);
ok((await as('A', `select * from public.votes where id=$1`, [v3])).rows.length === 0 && (await as('B', `select * from public.votes where id=$1`, [v3])).rows.length === 1, 'vote limité à l’entrée 3 : visible seulement par l’entrée 3');
ok(/not_eligible/.test((await as('A', `select public.cast_ballot($1,(select id from public.vote_options where vote_id=$1))`, [v3])).error || ''), 'appartement hors périmètre : vote refusé');

console.log('\n— Révocation de session (fonction serveur uniquement)');
ok(!!(await as('A', 'select public.revoke_user_sessions($1)', [U.A])).error, 'résident ne peut pas appeler la révocation');

if (rollback) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`);
  await db.exec(rollback);
  const left = (await db.query(`select count(*)::int n from information_schema.tables where table_schema='public'
     and table_name in ('tickets','apartments','directory_entries','staff','towers')`)).rows[0].n;
  ok(left === 0, 'retour arrière : objets v2 supprimés');
  await db.exec(migration);
  ok(true, 'migration ré-appliquable après retour arrière');
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
