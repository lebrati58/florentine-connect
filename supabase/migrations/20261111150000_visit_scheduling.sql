-- =====================================================================
-- 4FLORENTINE · v2.3 — prise de rendez-vous (תיאום מועד)
--
--  · L'équipe crée une campagne (ex. passage du drone, contrôle des
--    détecteurs, technicien) : message traduit, périmètre (tout / tour / entrée),
--    créneaux avec capacité (nombre d'appartements par créneau), date limite.
--  · Chaque appartement concerné choisit UN créneau, ou indique « aucun
--    créneau ne me convient », avec une note (accès, clé chez le voisin…).
--  · Le résident ne voit jamais quel appartement a pris quel créneau :
--    seulement le nombre de places restantes.
--  · Le calendrier commun (qui, où, quand, qui n'a pas répondu) est réservé à l'équipe.
-- Dépend de : 20261111090000_entrances_areas_categories.sql
-- Retour arrière : supabase/rollback/20261111150000_visit_scheduling_down.sql
-- =====================================================================

create table if not exists public.visit_campaigns (
  id             bigint generated always as identity primary key,
  title          text not null check (char_length(title) between 3 and 160),
  body           text check (body is null or char_length(body) <= 5000),
  translations   jsonb not null default '{}'::jsonb,
  scope_tower    smallint references public.towers(id),
  scope_entrance smallint references public.entrances(id),
  status         text not null default 'draft' check (status in ('draft','open','closed','cancelled')),
  respond_until  timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.visit_slots (
  id          bigint generated always as identity primary key,
  campaign_id bigint not null references public.visit_campaigns(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  capacity    smallint not null default 1 check (capacity between 1 and 500),
  check (ends_at > starts_at)
);
create index if not exists visit_slots_campaign_idx on public.visit_slots (campaign_id, starts_at);

create table if not exists public.visit_bookings (
  id           bigint generated always as identity primary key,
  campaign_id  bigint not null references public.visit_campaigns(id) on delete cascade,
  slot_id      bigint references public.visit_slots(id) on delete set null,
  apartment_id bigint not null references public.apartments(id) on delete cascade,
  unavailable  boolean not null default false,
  note         text check (note is null or char_length(note) <= 500),
  source       text not null default 'resident' check (source in ('resident','staff')),
  updated_at   timestamptz not null default now(),
  unique (campaign_id, apartment_id)
);
create index if not exists visit_bookings_slot_idx on public.visit_bookings (slot_id);

-- ---------------------------------------------------------------------
-- Utilitaires
-- ---------------------------------------------------------------------
create or replace function public.apartment_in_campaign(p_campaign bigint, p_apartment bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.visit_campaigns c join public.apartments a on a.id = p_apartment
                  where c.id = p_campaign and a.active
                    and (c.scope_tower is null or a.tower_id = c.scope_tower)
                    and (c.scope_entrance is null or a.entrance = c.scope_entrance))
$$;

create or replace function public.visit_campaigns_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  if new.status = 'open' and (tg_op = 'INSERT' or old.status <> 'open')
     and not exists (select 1 from public.visit_slots s where s.campaign_id = new.id) then
    raise exception 'campaign_without_slots';
  end if;
  return new;
end $$;
drop trigger if exists visit_campaigns_bw on public.visit_campaigns;
create trigger visit_campaigns_bw before insert or update on public.visit_campaigns
  for each row execute function public.visit_campaigns_before_write();

-- Un créneau déjà réservé ne peut pas voir sa capacité passer sous le nombre de réservations
create or replace function public.visit_slots_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.capacity < (select count(*) from public.visit_bookings b where b.slot_id = new.id) then
    raise exception 'slot_full';
  end if;
  return new;
end $$;
drop trigger if exists visit_slots_g on public.visit_slots;
create trigger visit_slots_g before update on public.visit_slots
  for each row execute function public.visit_slots_guard();

-- Écriture d'une réponse (interne) : contrôle la capacité sous verrou
create or replace function public.write_visit_booking(p_campaign bigint, p_slot bigint, p_apartment bigint,
                                                      p_note text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cap int; v_used int;
begin
  if p_slot is not null then
    select capacity into v_cap from public.visit_slots where id = p_slot and campaign_id = p_campaign for update;
    if v_cap is null then raise exception 'slot_not_found'; end if;
    select count(*) into v_used from public.visit_bookings
     where slot_id = p_slot and apartment_id <> p_apartment;
    if v_used >= v_cap then raise exception 'slot_full'; end if;
  end if;
  insert into public.visit_bookings (campaign_id, slot_id, apartment_id, unavailable, note, source, updated_at)
  values (p_campaign, p_slot, p_apartment, p_slot is null, nullif(trim(p_note), ''), p_source, now())
  on conflict (campaign_id, apartment_id) do update
    set slot_id = excluded.slot_id, unavailable = excluded.unavailable, note = excluded.note,
        source = excluded.source, updated_at = now();
end $$;

-- Résident : choisir un créneau (p_slot null = aucun créneau ne convient)
create or replace function public.book_visit_slot(p_campaign bigint, p_slot bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_apt bigint := public.my_apartment_id(); v_c public.visit_campaigns%rowtype;
begin
  if v_apt is null then raise exception 'not_member'; end if;
  select * into v_c from public.visit_campaigns where id = p_campaign;
  if v_c.id is null or v_c.status <> 'open' or (v_c.respond_until is not null and v_c.respond_until < now()) then
    raise exception 'campaign_closed';
  end if;
  if not public.apartment_in_campaign(p_campaign, v_apt) then raise exception 'not_eligible'; end if;
  perform public.write_visit_booking(p_campaign, p_slot, v_apt, p_note, 'resident');
end $$;

-- Résident : retirer sa réponse
create or replace function public.cancel_visit_booking(p_campaign bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_c public.visit_campaigns%rowtype;
begin
  select * into v_c from public.visit_campaigns where id = p_campaign;
  if v_c.id is null or v_c.status <> 'open' or (v_c.respond_until is not null and v_c.respond_until < now()) then
    raise exception 'campaign_closed';
  end if;
  delete from public.visit_bookings where campaign_id = p_campaign and apartment_id = public.my_apartment_id();
end $$;

-- Équipe : placer un appartement (par téléphone, sur place…) — sans date limite
create or replace function public.staff_book_visit(p_campaign bigint, p_slot bigint, p_apartment bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.staff_can_edit() then raise exception 'forbidden'; end if;
  if not public.apartment_in_campaign(p_campaign, p_apartment) then raise exception 'not_eligible'; end if;
  perform public.write_visit_booking(p_campaign, p_slot, p_apartment, p_note, 'staff');
end $$;

-- Places prises par créneau (sans révéler les appartements)
create or replace function public.visit_slot_counts(p_campaign bigint)
returns table (slot_id bigint, booked int)
language sql stable security definer set search_path = public as $$
  select s.id, (select count(*)::int from public.visit_bookings b where b.slot_id = s.id)
    from public.visit_slots s
   where s.campaign_id = p_campaign
     and (public.is_staff() or public.apartment_in_campaign(p_campaign, public.my_apartment_id()))
$$;

-- Calendrier commun (équipe) : chaque appartement concerné et sa réponse
create or replace function public.visit_schedule(p_campaign bigint)
returns table (apartment_id bigint, entrance smallint, number text, floor smallint,
               slot_id bigint, unavailable boolean, note text, source text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return query
  select a.id, a.entrance, a.number, a.floor::smallint, b.slot_id, coalesce(b.unavailable, false), b.note, b.source, b.updated_at
    from public.apartments a
    left join public.visit_bookings b on b.apartment_id = a.id and b.campaign_id = p_campaign
   where public.apartment_in_campaign(p_campaign, a.id) or b.id is not null
   order by a.entrance, a.number;
end $$;

-- ---------------------------------------------------------------------
-- RLS et droits
-- ---------------------------------------------------------------------
alter table public.visit_campaigns enable row level security;
alter table public.visit_slots     enable row level security;
alter table public.visit_bookings  enable row level security;

revoke all on public.visit_campaigns, public.visit_slots, public.visit_bookings from anon;
grant select, insert, update, delete on public.visit_campaigns, public.visit_slots to authenticated;
grant select, delete on public.visit_bookings to authenticated;
revoke insert, update on public.visit_bookings from authenticated;

drop policy if exists visit_campaigns_read on public.visit_campaigns;
create policy visit_campaigns_read on public.visit_campaigns for select using (
  public.is_staff() or (status in ('open','closed') and public.apartment_in_campaign(id, public.my_apartment_id())));
drop policy if exists visit_campaigns_write on public.visit_campaigns;
create policy visit_campaigns_write on public.visit_campaigns for all
  using (public.staff_can_edit()) with check (public.staff_can_edit());

drop policy if exists visit_slots_read on public.visit_slots;
create policy visit_slots_read on public.visit_slots for select using (
  exists (select 1 from public.visit_campaigns c where c.id = campaign_id));   -- hérite de visit_campaigns_read
drop policy if exists visit_slots_write on public.visit_slots;
create policy visit_slots_write on public.visit_slots for all
  using (public.staff_can_edit()) with check (public.staff_can_edit());

drop policy if exists visit_bookings_read on public.visit_bookings;
create policy visit_bookings_read on public.visit_bookings for select using (
  public.is_staff() or apartment_id = public.my_apartment_id());
drop policy if exists visit_bookings_delete on public.visit_bookings;
create policy visit_bookings_delete on public.visit_bookings for delete using (public.staff_can_edit());

revoke execute on function public.visit_campaigns_before_write(), public.visit_slots_guard(),
  public.write_visit_booking(bigint, bigint, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.apartment_in_campaign(bigint, bigint), public.book_visit_slot(bigint, bigint, text),
  public.cancel_visit_booking(bigint), public.staff_book_visit(bigint, bigint, bigint, text),
  public.visit_slot_counts(bigint), public.visit_schedule(bigint) from public, anon;
grant execute on function public.apartment_in_campaign(bigint, bigint), public.book_visit_slot(bigint, bigint, text),
  public.cancel_visit_booking(bigint), public.staff_book_visit(bigint, bigint, bigint, text),
  public.visit_slot_counts(bigint), public.visit_schedule(bigint) to authenticated;
