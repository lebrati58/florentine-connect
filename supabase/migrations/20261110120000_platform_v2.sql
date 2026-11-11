-- =====================================================================
-- 4FLORENTINE · Platform v2
-- Résidents (comptes par appartement) · CRM · tickets · annuaire collaboratif
--
-- Additif : ne modifie ni ne supprime aucune table existante.
-- Retour arrière : supabase/rollback/20261110120000_platform_v2_down.sql
-- =====================================================================

-- (gen_random_uuid est natif depuis PostgreSQL 13 : aucune extension requise)

-- ---------------------------------------------------------------------
-- 1. Référentiel : tours, appartements, équipe
-- ---------------------------------------------------------------------

create table if not exists public.towers (
  id        smallint primary key check (id between 1 and 9),
  name      text not null,
  name_he   text not null,
  floors    smallint check (floors is null or floors between 1 and 80),
  address   text,
  notes     text
);

insert into public.towers (id, name, name_he) values
  (1, 'Tour 1', 'בניין 1'),
  (2, 'Tour 2', 'בניין 2'),
  (3, 'Tour 3', 'בניין 3'),
  (4, 'Tour 4', 'בניין 4')
on conflict (id) do nothing;

create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null check (char_length(full_name) between 2 and 80),
  role       text not null check (role in ('owner','manager','technician','viewer')),
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.apartments (
  id          bigint generated always as identity primary key,
  tower_id    smallint not null references public.towers(id),
  number      text not null check (number ~ '^[0-9]{1,4}[A-Za-z]?$'),
  floor       smallint check (floor is null or floor between -5 and 80),
  label       text check (label is null or char_length(label) <= 80),
  user_id     uuid unique references auth.users(id) on delete set null,
  pin_set_at  timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tower_id, number)
);

-- ---------------------------------------------------------------------
-- 2. Fonctions d'autorisation (security definer, utilisées par les RLS)
-- ---------------------------------------------------------------------

create or replace function public.staff_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid() and active
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and active)
$$;

create or replace function public.staff_can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() in ('owner','manager','technician'), false)
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() in ('owner','manager'), false)
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() = 'owner', false)
$$;

create or replace function public.my_apartment_id()
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.apartments where user_id = auth.uid() and active
$$;

create or replace function public.my_tower_id()
returns smallint language sql stable security definer set search_path = public as $$
  select tower_id from public.apartments where user_id = auth.uid() and active
$$;

-- Membre = appartement actif OU membre de l'équipe actif.
-- Un simple compte Supabase "authenticated" n'a AUCUN accès.
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or public.my_apartment_id() is not null
$$;

-- Démarrage : le tout premier compte équipe devient propriétaire.
create or replace function public.staff_bootstrap_open()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.staff)
$$;

create or replace function public.claim_first_owner(p_full_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.apartments where user_id = auth.uid()) then
    raise exception 'apartment_account_cannot_be_staff';
  end if;
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from public.staff) then raise exception 'bootstrap_closed'; end if;
  insert into public.staff (user_id, full_name, role) values (auth.uid(), p_full_name, 'owner');
end $$;

-- ---------------------------------------------------------------------
-- 3. Fournisseurs, tickets, interventions, historique, photos
-- ---------------------------------------------------------------------

create table if not exists public.vendors (
  id           bigint generated always as identity primary key,
  name         text not null check (char_length(name) between 2 and 120),
  trade        text not null check (char_length(trade) between 2 and 60),
  contact_name text,
  phone        text,
  email        text,
  notes        text check (notes is null or char_length(notes) <= 2000),
  rating       smallint check (rating is null or rating between 1 and 5),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.tickets (
  id              bigint generated always as identity primary key,
  ref             text generated always as ('FL-' || lpad(id::text, 5, '0')) stored,
  tower_id        smallint not null references public.towers(id),
  floor           smallint check (floor is null or floor between -5 and 80),
  apartment_id    bigint references public.apartments(id),
  location        text not null default 'apartment' check (location in ('apartment','common')),
  location_detail text check (location_detail is null or char_length(location_detail) <= 120),
  category        text not null check (category in
                    ('elevator','plumbing','electricity','cleaning','security','ac',
                     'parking','intercom','common_areas','pests','other')),
  title           text not null check (char_length(title) between 3 and 120),
  description     text check (description is null or char_length(description) <= 2000),
  priority        text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status          text not null default 'new' check (status in
                    ('new','assigned','in_progress','waiting','resolved','closed','cancelled')),
  assignee_id     uuid references public.staff(user_id) on delete set null,
  vendor_id       bigint references public.vendors(id) on delete set null,
  source          text not null default 'resident' check (source in ('resident','staff')),
  created_by      uuid references auth.users(id) on delete set null,
  due_at          timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  closed_at       timestamptz
);
create index if not exists tickets_status_idx    on public.tickets (status);
create index if not exists tickets_apartment_idx on public.tickets (apartment_id);
create index if not exists tickets_tower_idx     on public.tickets (tower_id);

create table if not exists public.ticket_events (
  id          bigint generated always as identity primary key,
  ticket_id   bigint not null references public.tickets(id) on delete cascade,
  actor_id    uuid,
  actor_kind  text not null default 'system' check (actor_kind in ('resident','staff','system')),
  kind        text not null check (kind in
                ('created','status','priority','assignee','vendor','comment','note','photo','intervention')),
  from_value  text,
  to_value    text,
  body        text check (body is null or char_length(body) <= 2000),
  is_public   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

create table if not exists public.ticket_photos (
  id          bigint generated always as identity primary key,
  ticket_id   bigint not null references public.tickets(id) on delete cascade,
  path        text not null unique,
  uploaded_by uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.interventions (
  id            bigint generated always as identity primary key,
  ticket_id     bigint not null references public.tickets(id) on delete cascade,
  vendor_id     bigint references public.vendors(id) on delete set null,
  status        text not null default 'planned' check (status in ('planned','done','cancelled')),
  scheduled_at  timestamptz,
  completed_at  timestamptz,
  cost          numeric(10,2) check (cost is null or cost >= 0),
  notes         text check (notes is null or char_length(notes) <= 2000),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

create or replace function public.can_access_ticket(p_ticket bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff()
      or exists (select 1 from public.tickets t
                 where t.id = p_ticket and t.apartment_id = public.my_apartment_id())
$$;

-- Ticket : normalisation à la création (un résident ne choisit ni statut, ni responsable)
create or replace function public.tickets_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_apt bigint; v_tower smallint; v_floor smallint;
begin
  new.created_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  if public.is_staff() then
    if not public.staff_can_edit() then raise exception 'forbidden'; end if;
    new.source := 'staff';
    if new.assignee_id is not null and new.status = 'new' then new.status := 'assigned'; end if;
  else
    v_apt := public.my_apartment_id();
    if v_apt is null then raise exception 'not_member'; end if;
    select tower_id, floor into v_tower, v_floor from public.apartments where id = v_apt;
    new.source := 'resident';
    new.status := 'new';
    new.assignee_id := null;
    new.vendor_id := null;
    new.due_at := null;
    new.resolved_at := null;
    new.closed_at := null;
    new.apartment_id := v_apt;            -- le déclarant suit toujours sa demande
    if new.location = 'apartment' then
      new.tower_id := v_tower;
      new.floor := coalesce(v_floor, new.floor);
    end if;
  end if;
  return new;
end $$;

create or replace function public.tickets_before_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.source := old.source;
  if new.assignee_id is not null and old.assignee_id is null and new.status = 'new' then
    new.status := 'assigned';
  end if;
  if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  if new.status = 'closed' and old.status <> 'closed' then new.closed_at := now(); end if;
  if new.status not in ('resolved','closed') then
    new.resolved_at := null; new.closed_at := null;
  end if;
  return new;
end $$;

create or replace function public.actor_kind()
returns text language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 'system'
              when public.is_staff() then 'staff'
              else 'resident' end
$$;

create or replace function public.tickets_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text := public.actor_kind();
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, actor_id, actor_kind, kind, to_value, is_public)
    values (new.id, auth.uid(), k, 'created', new.status, true);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.ticket_events (ticket_id, actor_id, actor_kind, kind, from_value, to_value, is_public)
    values (new.id, auth.uid(), k, 'status', old.status, new.status, true);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.ticket_events (ticket_id, actor_id, actor_kind, kind, from_value, to_value, is_public)
    values (new.id, auth.uid(), k, 'priority', old.priority, new.priority, false);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.ticket_events (ticket_id, actor_id, actor_kind, kind, from_value, to_value, is_public)
    values (new.id, auth.uid(), k, 'assignee',
            (select full_name from public.staff where user_id = old.assignee_id),
            (select full_name from public.staff where user_id = new.assignee_id), false);
  end if;
  if new.vendor_id is distinct from old.vendor_id then
    insert into public.ticket_events (ticket_id, actor_id, actor_kind, kind, from_value, to_value, is_public)
    values (new.id, auth.uid(), k, 'vendor',
            (select name from public.vendors where id = old.vendor_id),
            (select name from public.vendors where id = new.vendor_id), false);
  end if;
  return new;
end $$;

drop trigger if exists tickets_bi on public.tickets;
create trigger tickets_bi before insert on public.tickets
  for each row execute function public.tickets_before_insert();
drop trigger if exists tickets_bu on public.tickets;
create trigger tickets_bu before update on public.tickets
  for each row execute function public.tickets_before_update();
drop trigger if exists tickets_aiu on public.tickets;
create trigger tickets_aiu after insert or update on public.tickets
  for each row execute function public.tickets_after_write();

-- Événements saisis par un utilisateur : l'auteur et sa nature sont imposés
create or replace function public.ticket_events_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;   -- triggers internes / service
  new.actor_id := auth.uid();
  new.actor_kind := public.actor_kind();
  new.created_at := now();
  if new.actor_kind = 'resident' then
    if new.kind <> 'comment' then raise exception 'forbidden'; end if;
    new.is_public := true;
  elsif new.kind = 'note' then
    new.is_public := false;
  end if;
  return new;
end $$;
drop trigger if exists ticket_events_bi on public.ticket_events;
create trigger ticket_events_bi before insert on public.ticket_events
  for each row execute function public.ticket_events_before_insert();

create or replace function public.ticket_photos_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, actor_kind, kind, to_value, is_public)
  values (new.ticket_id, auth.uid(), public.actor_kind(), 'photo', new.path, true);
  return new;
end $$;
drop trigger if exists ticket_photos_ai on public.ticket_photos;
create trigger ticket_photos_ai after insert on public.ticket_photos
  for each row execute function public.ticket_photos_after_insert();

create or replace function public.interventions_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, actor_kind, kind, to_value, body, is_public)
  values (new.ticket_id, auth.uid(), public.actor_kind(), 'intervention', new.status,
          (select name from public.vendors where id = new.vendor_id), false);
  return new;
end $$;
drop trigger if exists interventions_aiu on public.interventions;
create trigger interventions_aiu after insert or update of status on public.interventions
  for each row execute function public.interventions_after_write();

-- Annulation par le résident (seul changement autorisé côté résident)
create or replace function public.resident_cancel_ticket(p_ticket bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tickets set status = 'cancelled'
   where id = p_ticket and apartment_id = public.my_apartment_id() and status = 'new';
  if not found then raise exception 'cannot_cancel'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Annonces
-- ---------------------------------------------------------------------

create table if not exists public.announcements (
  id           bigint generated always as identity primary key,
  title        text not null check (char_length(title) between 2 and 140),
  body         text not null check (char_length(body) between 2 and 5000),
  translations jsonb not null default '{}'::jsonb,   -- {"fr":{"title","body"},"en":{...}}
  category     text not null default 'info' check (category in ('info','works','meeting','urgent','event')),
  tower_id     smallint references public.towers(id),  -- null = toutes les tours
  pinned       boolean not null default false,
  published    boolean not null default true,
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Annuaire collaboratif (versions, recommandations, signalements)
-- ---------------------------------------------------------------------

create table if not exists public.directory_entries (
  id              bigint generated always as identity primary key,
  trade           text not null check (char_length(trade) between 2 and 40),
  name            text not null check (char_length(name) between 2 and 80),
  phone           text check (phone is null or phone ~ '^[0-9 +().-]{6,20}$'),
  -- Un numéro n'est publié que si l'auteur atteste qu'il est professionnel et partageable.
  phone_public_ok boolean not null default false,
  website         text check (website is null or char_length(website) <= 200),
  area            text check (area is null or char_length(area) <= 80),
  notes           text check (notes is null or char_length(notes) <= 600),
  status          text not null default 'active' check (status in ('active','obsolete','hidden')),
  source          text not null default 'resident' check (source in ('resident','staff','legacy')),
  version         integer not null default 1,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint directory_phone_consent check (phone is null or phone_public_ok)
);

create table if not exists public.directory_revisions (
  id           bigint generated always as identity primary key,
  entry_id     bigint not null references public.directory_entries(id) on delete cascade,
  version      integer not null,
  change_kind  text not null check (change_kind in ('create','edit','restore','status')),
  snapshot     jsonb not null,
  changed_by   uuid,
  apartment_id bigint,
  created_at   timestamptz not null default now()
);
create index if not exists directory_revisions_entry_idx on public.directory_revisions (entry_id, version desc);
create index if not exists directory_revisions_author_idx on public.directory_revisions (changed_by, created_at);

create table if not exists public.directory_recommendations (
  id           bigint generated always as identity primary key,
  entry_id     bigint not null references public.directory_entries(id) on delete cascade,
  author       uuid not null default auth.uid(),
  apartment_id bigint references public.apartments(id) on delete set null,
  rating       smallint not null check (rating between 1 and 5),
  comment      text check (comment is null or char_length(comment) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (entry_id, author)
);

create table if not exists public.directory_reports (
  id           bigint generated always as identity primary key,
  entry_id     bigint not null references public.directory_entries(id) on delete cascade,
  reason       text not null check (reason in ('obsolete','wrong_number','closed','abuse','other')),
  details      text check (details is null or char_length(details) <= 300),
  reported_by  uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid,
  unique (entry_id, reported_by)
);

-- Anti-abus : plafond de modifications par compte sur 24 h (hors équipe)
create or replace function public.directory_rate_check()
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_staff() then return; end if;
  if (select count(*) from public.directory_revisions
       where changed_by = auth.uid() and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'rate_limited';
  end if;
end $$;

create or replace function public.directory_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.is_member() then raise exception 'not_member'; end if;
  perform public.directory_rate_check();
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.version := 1;
    if not public.is_staff() then new.source := 'resident'; new.status := 'active'; end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.version := old.version + 1;
    if not public.is_staff() and (old.status = 'hidden' or new.status = 'hidden') then
      raise exception 'forbidden';
    end if;
  end if;
  return new;
end $$;

create or replace function public.directory_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_kind text;
begin
  if tg_op = 'INSERT' then v_kind := 'create';
  elsif coalesce(current_setting('app.change_kind', true), '') = 'restore' then v_kind := 'restore';
  elsif new.status is distinct from old.status
        and (new.trade, new.name, new.phone, new.phone_public_ok, new.website, new.area, new.notes)
            is not distinct from
            (old.trade, old.name, old.phone, old.phone_public_ok, old.website, old.area, old.notes)
    then v_kind := 'status';
  else v_kind := 'edit';
  end if;
  insert into public.directory_revisions (entry_id, version, change_kind, snapshot, changed_by, apartment_id)
  values (new.id, new.version, v_kind,
          jsonb_build_object('trade', new.trade, 'name', new.name, 'phone', new.phone,
                             'phone_public_ok', new.phone_public_ok, 'website', new.website,
                             'area', new.area, 'notes', new.notes, 'status', new.status),
          auth.uid(), public.my_apartment_id());
  return new;
end $$;

drop trigger if exists directory_bw on public.directory_entries;
create trigger directory_bw before insert or update on public.directory_entries
  for each row execute function public.directory_before_write();
drop trigger if exists directory_aw on public.directory_entries;
create trigger directory_aw after insert or update on public.directory_entries
  for each row execute function public.directory_after_write();

create or replace function public.restore_directory_version(p_entry bigint, p_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not public.is_member() then raise exception 'not_member'; end if;
  select snapshot into s from public.directory_revisions where entry_id = p_entry and version = p_version;
  if s is null then raise exception 'version_not_found'; end if;
  if not public.is_staff() and exists (select 1 from public.directory_entries where id = p_entry and status = 'hidden') then
    raise exception 'forbidden';
  end if;
  perform set_config('app.change_kind', 'restore', true);
  update public.directory_entries set
    trade = s->>'trade', name = s->>'name', phone = s->>'phone',
    phone_public_ok = coalesce((s->>'phone_public_ok')::boolean, false),
    website = s->>'website', area = s->>'area', notes = s->>'notes',
    status = case when public.is_staff() then s->>'status'
                  when s->>'status' = 'hidden' then status
                  else s->>'status' end
  where id = p_entry;
  perform set_config('app.change_kind', '', true);
end $$;

create or replace function public.directory_reco_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'not_member'; end if;
  new.author := auth.uid();
  new.apartment_id := public.my_apartment_id();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  return new;
end $$;
drop trigger if exists directory_reco_bw on public.directory_recommendations;
create trigger directory_reco_bw before insert or update on public.directory_recommendations
  for each row execute function public.directory_reco_before_write();

-- 3 voisins distincts signalent "obsolète" → la fiche passe en obsolète (réversible)
create or replace function public.directory_reports_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(distinct reported_by) from public.directory_reports
       where entry_id = new.entry_id and resolved_at is null
         and reason in ('obsolete','wrong_number','closed')) >= 3 then
    update public.directory_entries set status = 'obsolete'
     where id = new.entry_id and status = 'active';
  end if;
  return new;
end $$;
drop trigger if exists directory_reports_ai on public.directory_reports;
create trigger directory_reports_ai after insert on public.directory_reports
  for each row execute function public.directory_reports_after_insert();

create or replace function public.directory_reports_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'not_member'; end if;
  new.reported_by := auth.uid();
  new.created_at := now();
  new.resolved_at := null;
  new.resolved_by := null;
  return new;
end $$;
drop trigger if exists directory_reports_bi on public.directory_reports;
create trigger directory_reports_bi before insert on public.directory_reports
  for each row execute function public.directory_reports_before_insert();

-- Vue agrégée : note moyenne et nombre de recommandations
create or replace view public.directory_overview with (security_invoker = true) as
select e.*,
       coalesce(r.avg_rating, 0)::numeric(3,2) as avg_rating,
       coalesce(r.reco_count, 0)               as reco_count,
       coalesce(p.open_reports, 0)             as open_reports
from public.directory_entries e
left join (select entry_id, avg(rating) avg_rating, count(*) reco_count
             from public.directory_recommendations group by entry_id) r on r.entry_id = e.id
left join (select entry_id, count(*) open_reports
             from public.directory_reports where resolved_at is null group by entry_id) p on p.entry_id = e.id;

-- Contenu de l'ancien annuaire public : prénoms + métier (traduit par l'interface), sans aucun numéro ni texte en dur
insert into public.directory_entries (trade, name, source, created_at)
select v.trade, v.name, 'legacy', now()
from (values
  ('plumbing','Shimon'),
  ('plumbing','Matan'),
  ('electricity','Moshe'),
  ('ac','Matan'),
  ('ac','Henry'),
  ('cleaning','Goli'),
  ('cleaning','Maryann Cleaning'),
  ('cleaning','Patrick'),
  ('windows','Moshe'),
  ('taxi','Lionel'),
  ('taxi','Sagi'),
  ('taxi','Yossi'),
  ('taxi','Elie'),
  ('taxi','Oren'),
  ('taxi','Effi'),
  ('insurance','IMAGEST (Deborah)'),
  ('moving','Anglo Movers')
) as v(trade, name)
where not exists (select 1 from public.directory_entries where source = 'legacy');

-- ---------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------

alter table public.towers                    enable row level security;
alter table public.staff                     enable row level security;
alter table public.apartments                enable row level security;
alter table public.vendors                   enable row level security;
alter table public.tickets                   enable row level security;
alter table public.ticket_events             enable row level security;
alter table public.ticket_photos             enable row level security;
alter table public.interventions             enable row level security;
alter table public.announcements             enable row level security;
alter table public.directory_entries         enable row level security;
alter table public.directory_revisions       enable row level security;
alter table public.directory_recommendations enable row level security;
alter table public.directory_reports         enable row level security;

-- Privilèges de base : rien pour anon (sauf la liste des tours), contrôlé finement pour authenticated
revoke all on public.staff, public.apartments, public.vendors, public.tickets, public.ticket_events,
              public.ticket_photos, public.interventions, public.announcements, public.directory_entries,
              public.directory_revisions, public.directory_recommendations, public.directory_reports,
              public.directory_overview
  from anon;
grant select on public.towers to anon, authenticated;
grant update (name, name_he, floors, address, notes) on public.towers to authenticated;

grant select, insert, update, delete on public.staff to authenticated;
grant select, insert on public.apartments to authenticated;
revoke update on public.apartments from authenticated;
grant update (tower_id, number, floor, label, active) on public.apartments to authenticated;
grant select, insert, update on public.vendors to authenticated;
grant select, insert on public.tickets to authenticated;
revoke update on public.tickets from authenticated;
grant update (tower_id, floor, location, location_detail, category, title, description,
              priority, status, assignee_id, vendor_id, due_at) on public.tickets to authenticated;
grant select, insert on public.ticket_events to authenticated;
grant select, insert on public.ticket_photos to authenticated;
grant select, insert, update on public.interventions to authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert on public.directory_entries to authenticated;
revoke update on public.directory_entries from authenticated;
grant update (trade, name, phone, phone_public_ok, website, area, notes, status) on public.directory_entries to authenticated;
grant select on public.directory_revisions to authenticated;
grant select, insert, update, delete on public.directory_recommendations to authenticated;
grant select, insert on public.directory_reports to authenticated;
grant update (resolved_at, resolved_by) on public.directory_reports to authenticated;
grant select on public.directory_overview to authenticated;

-- towers
drop policy if exists towers_read on public.towers;
create policy towers_read on public.towers for select using (true);
drop policy if exists towers_manage on public.towers;
create policy towers_manage on public.towers for update using (public.is_manager()) with check (public.is_manager());

-- staff
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select using (public.is_staff());
drop policy if exists staff_owner_insert on public.staff;
create policy staff_owner_insert on public.staff for insert with check (public.is_owner());
drop policy if exists staff_owner_update on public.staff;
create policy staff_owner_update on public.staff for update using (public.is_owner()) with check (public.is_owner());
drop policy if exists staff_owner_delete on public.staff;
create policy staff_owner_delete on public.staff for delete using (public.is_owner() and user_id <> auth.uid());

-- apartments
drop policy if exists apartments_read on public.apartments;
create policy apartments_read on public.apartments for select
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists apartments_insert on public.apartments;
create policy apartments_insert on public.apartments for insert with check (public.is_manager());
drop policy if exists apartments_update on public.apartments;
create policy apartments_update on public.apartments for update using (public.is_manager()) with check (public.is_manager());

-- vendors / interventions
drop policy if exists vendors_read on public.vendors;
create policy vendors_read on public.vendors for select using (public.is_staff());
drop policy if exists vendors_write on public.vendors;
create policy vendors_write on public.vendors for insert with check (public.staff_can_edit());
drop policy if exists vendors_update on public.vendors;
create policy vendors_update on public.vendors for update using (public.staff_can_edit()) with check (public.staff_can_edit());

drop policy if exists interventions_read on public.interventions;
create policy interventions_read on public.interventions for select using (public.is_staff());
drop policy if exists interventions_write on public.interventions;
create policy interventions_write on public.interventions for insert with check (public.staff_can_edit());
drop policy if exists interventions_update on public.interventions;
create policy interventions_update on public.interventions for update using (public.staff_can_edit()) with check (public.staff_can_edit());

-- tickets
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets for select
  using (public.is_staff() or apartment_id = public.my_apartment_id());
drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert
  with check (public.staff_can_edit() or (public.my_apartment_id() is not null and apartment_id = public.my_apartment_id()));
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update
  using (public.staff_can_edit()) with check (public.staff_can_edit());

-- ticket_events
drop policy if exists ticket_events_read on public.ticket_events;
create policy ticket_events_read on public.ticket_events for select
  using (public.is_staff() or (is_public and public.can_access_ticket(ticket_id)));
drop policy if exists ticket_events_insert on public.ticket_events;
create policy ticket_events_insert on public.ticket_events for insert
  with check (
    (public.staff_can_edit() and kind in ('comment','note'))
    or (not public.is_staff() and kind = 'comment' and public.can_access_ticket(ticket_id))
  );

-- ticket_photos
drop policy if exists ticket_photos_read on public.ticket_photos;
create policy ticket_photos_read on public.ticket_photos for select using (public.can_access_ticket(ticket_id));
drop policy if exists ticket_photos_insert on public.ticket_photos;
create policy ticket_photos_insert on public.ticket_photos for insert
  with check (public.can_access_ticket(ticket_id) and (not public.is_staff() or public.staff_can_edit()));

-- announcements
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select
  using (
    public.is_staff()
    or (public.my_apartment_id() is not null and published and starts_at <= now()
        and (expires_at is null or expires_at > now())
        and (tower_id is null or tower_id = public.my_tower_id()))
  );
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert with check (public.is_manager());
drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements for update using (public.is_manager()) with check (public.is_manager());
drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete using (public.is_manager());

-- directory
drop policy if exists directory_read on public.directory_entries;
create policy directory_read on public.directory_entries for select
  using (public.is_staff() or (public.is_member() and status <> 'hidden'));
drop policy if exists directory_insert on public.directory_entries;
create policy directory_insert on public.directory_entries for insert with check (public.is_member());
drop policy if exists directory_update on public.directory_entries;
create policy directory_update on public.directory_entries for update
  using (public.is_staff() or (public.is_member() and status <> 'hidden'))
  with check (public.is_member());

drop policy if exists directory_revisions_read on public.directory_revisions;
create policy directory_revisions_read on public.directory_revisions for select
  using (public.is_staff() or (public.is_member() and exists (
    select 1 from public.directory_entries e where e.id = entry_id and e.status <> 'hidden')));

drop policy if exists directory_reco_read on public.directory_recommendations;
create policy directory_reco_read on public.directory_recommendations for select using (public.is_member());
drop policy if exists directory_reco_insert on public.directory_recommendations;
create policy directory_reco_insert on public.directory_recommendations for insert
  with check (public.is_member() and author = auth.uid());
drop policy if exists directory_reco_update on public.directory_recommendations;
create policy directory_reco_update on public.directory_recommendations for update
  using (author = auth.uid()) with check (author = auth.uid());
drop policy if exists directory_reco_delete on public.directory_recommendations;
create policy directory_reco_delete on public.directory_recommendations for delete
  using (author = auth.uid() or public.is_manager());

drop policy if exists directory_reports_read on public.directory_reports;
create policy directory_reports_read on public.directory_reports for select
  using (public.is_staff() or reported_by = auth.uid());
drop policy if exists directory_reports_insert on public.directory_reports;
create policy directory_reports_insert on public.directory_reports for insert
  with check (public.is_member() and reported_by = auth.uid());
drop policy if exists directory_reports_update on public.directory_reports;
create policy directory_reports_update on public.directory_reports for update
  using (public.staff_can_edit()) with check (public.staff_can_edit());

-- RPC : exécution réservée aux comptes connectés
revoke execute on function public.claim_first_owner(text)             from public, anon;
revoke execute on function public.resident_cancel_ticket(bigint)       from public, anon;
revoke execute on function public.restore_directory_version(bigint, integer) from public, anon;
grant execute on function public.claim_first_owner(text)               to authenticated;
grant execute on function public.resident_cancel_ticket(bigint)        to authenticated;
grant execute on function public.restore_directory_version(bigint, integer) to authenticated;
grant execute on function public.staff_bootstrap_open()                to anon, authenticated;

-- Révocation des sessions d'un appartement (utilisée par la fonction serveur lors d'un nouveau PIN)
create or replace function public.revoke_user_sessions(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.sessions where user_id = p_user;
end $$;
revoke execute on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.revoke_user_sessions(uuid) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Stockage des photos (bucket privé)
-- ---------------------------------------------------------------------

create or replace function public.ticket_id_from_path(p_name text)
returns bigint language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9]{1,12}$'
              then split_part(p_name, '/', 1)::bigint end
$$;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ticket-photos', 'ticket-photos', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic'])
    on conflict (id) do nothing;

    execute 'drop policy if exists ticket_photos_obj_read on storage.objects';
    execute $p$create policy ticket_photos_obj_read on storage.objects for select to authenticated
      using (bucket_id = 'ticket-photos' and public.can_access_ticket(public.ticket_id_from_path(name)))$p$;
    execute 'drop policy if exists ticket_photos_obj_insert on storage.objects';
    execute $p$create policy ticket_photos_obj_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'ticket-photos' and public.can_access_ticket(public.ticket_id_from_path(name)))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Temps réel (suivi instantané des statuts) + ancienne table de suggestions
-- ---------------------------------------------------------------------

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.tickets, public.ticket_events';
    exception when duplicate_object then null;
    end;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'directory_suggestions') then
    execute 'drop policy if exists directory_suggestions_staff_read on public.directory_suggestions';
    execute 'create policy directory_suggestions_staff_read on public.directory_suggestions for select to authenticated using (public.is_staff())';
    execute 'grant select on public.directory_suggestions to authenticated';
  end if;
end $$;
