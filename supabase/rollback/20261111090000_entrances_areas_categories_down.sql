-- Retour arrière de la v2.1 (entrées, zones, catégories). À exécuter AVANT le rollback v2.
-- ⚠️ Les tickets aux nouvelles catégories sont reclassés en "other" ; les zones et entrées sont perdues.
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select
  using (
    public.is_staff()
    or (public.my_apartment_id() is not null and published and starts_at <= now()
        and (expires_at is null or expires_at > now())
        and (tower_id is null or tower_id = public.my_tower_id()))
  );
drop function if exists public.my_entrance();
alter table public.announcements drop column if exists entrance;

update public.tickets set category = 'other'
 where category in ('robotic_parking','parking_gate','odor','alarm','noise_works','beggars');
update public.tickets set tower_id = 1 where tower_id is null;
alter table public.tickets drop constraint if exists tickets_category_check;
alter table public.tickets add constraint tickets_category_check check (category in
  ('elevator','plumbing','electricity','cleaning','security','ac','parking','intercom','common_areas','pests','other'));
alter table public.tickets alter column tower_id set not null;
alter table public.tickets drop constraint if exists tickets_area_check;
drop index if exists public.tickets_area_idx;
alter table public.tickets drop column if exists area;
alter table public.tickets drop column if exists entrance;

drop trigger if exists apartments_bw on public.apartments;
drop function if exists public.apartments_before_write();
alter table public.apartments drop constraint if exists apartments_entrance_number_key;
alter table public.apartments drop column if exists entrance;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'apartments_tower_id_number_key') then
    begin
      alter table public.apartments add constraint apartments_tower_id_number_key unique (tower_id, number);
    exception when unique_violation then
      -- Des numéros identiques existent dans deux entrées d'une même tour : on garde les données intactes.
      raise warning 'apartments: numéros en double par tour, contrainte (tower_id, number) non rétablie';
    end;
  end if;
end $$;
drop table if exists public.entrances;
-- Fonctions de la v2 restaurées
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
