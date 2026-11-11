-- =====================================================================
-- 4FLORENTINE · v2.1 — entrées, zones communes, catégories du terrain
--   6 entrées : 1-2 → tour 1 · 3 → tour 2 · 4-5 → tour 3 · 6 → tour 4
--   Zones : lobby, parking -1 (robotisé), parking -2 (barrière), etc.
--   Catégories : fuite, odeurs, travaux hors horaires, alarme, mendicité…
-- Retour arrière : supabase/rollback/20261111090000_entrances_areas_categories_down.sql
-- =====================================================================

create table if not exists public.entrances (
  id       smallint primary key check (id between 1 and 12),
  tower_id smallint not null references public.towers(id)
);
insert into public.entrances (id, tower_id) values (1,1),(2,1),(3,2),(4,3),(5,3),(6,4)
on conflict (id) do update set tower_id = excluded.tower_id;
alter table public.entrances enable row level security;
grant select on public.entrances to anon, authenticated;
drop policy if exists entrances_read on public.entrances;
create policy entrances_read on public.entrances for select using (true);

-- Appartements : identifiés par entrée + numéro ; la tour est déduite de l'entrée
alter table public.apartments add column if not exists entrance smallint references public.entrances(id);
update public.apartments a set entrance = (select min(e.id) from public.entrances e where e.tower_id = a.tower_id)
 where entrance is null;
alter table public.apartments alter column entrance set not null;
alter table public.apartments drop constraint if exists apartments_tower_id_number_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'apartments_entrance_number_key') then
    alter table public.apartments add constraint apartments_entrance_number_key unique (entrance, number);
  end if;
end $$;

create or replace function public.apartments_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.tower_id := (select tower_id from public.entrances where id = new.entrance);
  return new;
end $$;
drop trigger if exists apartments_bw on public.apartments;
create trigger apartments_bw before insert or update of entrance on public.apartments
  for each row execute function public.apartments_before_write();
revoke execute on function public.apartments_before_write() from public, anon, authenticated;
grant update (entrance) on public.apartments to authenticated;

-- Tickets : entrée + zone ; la tour devient facultative (parkings communs à tout le complexe)
alter table public.tickets add column if not exists entrance smallint references public.entrances(id);
alter table public.tickets add column if not exists area text;
alter table public.tickets drop constraint if exists tickets_area_check;
alter table public.tickets add constraint tickets_area_check check (area is null or area in
  ('apartment','lobby','parking_1','parking_2','stairs','roof','garbage','outside','other'));
alter table public.tickets alter column tower_id drop not null;
alter table public.tickets drop constraint if exists tickets_category_check;
alter table public.tickets add constraint tickets_category_check check (category in
  ('elevator','robotic_parking','parking_gate','plumbing','odor','alarm','noise_works','beggars',
   'electricity','cleaning','security','ac','parking','intercom','common_areas','pests','other'));
create index if not exists tickets_area_idx on public.tickets (area);
grant update (entrance, area) on public.tickets to authenticated;

create or replace function public.tickets_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_apt public.apartments%rowtype;
begin
  new.created_by := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  if public.is_staff() then
    if not public.staff_can_edit() then raise exception 'forbidden'; end if;
    new.source := 'staff';
    if new.assignee_id is not null and new.status = 'new' then new.status := 'assigned'; end if;
  else
    select * into v_apt from public.apartments where id = public.my_apartment_id();
    if v_apt.id is null then raise exception 'not_member'; end if;
    new.source := 'resident';
    new.status := 'new';
    new.assignee_id := null;
    new.vendor_id := null;
    new.due_at := null;
    new.resolved_at := null;
    new.closed_at := null;
    new.apartment_id := v_apt.id;             -- le déclarant suit toujours sa demande
    if new.location = 'apartment' then
      new.entrance := v_apt.entrance;
      new.floor := coalesce(v_apt.floor, new.floor);
      new.area := 'apartment';
    end if;
  end if;
  -- Les parkings sont communs à tout le complexe : ni entrée ni tour
  if new.area in ('parking_1','parking_2') or new.category in ('robotic_parking','parking_gate') then
    new.entrance := null;
    new.area := coalesce(nullif(new.area, 'apartment'),
                         case new.category when 'robotic_parking' then 'parking_1' else 'parking_2' end);
    new.location := 'common';
  end if;
  new.tower_id := (select tower_id from public.entrances where id = new.entrance);
  return new;
end $$;

create or replace function public.tickets_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.source := old.source;
  if new.entrance is distinct from old.entrance then
    new.tower_id := (select tower_id from public.entrances where id = new.entrance);
  end if;
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

-- Annonces : ciblage possible par entrée
alter table public.announcements add column if not exists entrance smallint references public.entrances(id);
create or replace function public.my_entrance()
returns smallint language sql stable security definer set search_path = public as $$
  select entrance from public.apartments where user_id = auth.uid() and active
$$;
revoke execute on function public.my_entrance() from public, anon;
grant execute on function public.my_entrance() to authenticated;
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select
  using (
    public.is_staff()
    or (public.my_apartment_id() is not null and published and starts_at <= now()
        and (expires_at is null or expires_at > now())
        and (tower_id is null or tower_id = public.my_tower_id())
        and (entrance is null or entrance = public.my_entrance()))
  );
