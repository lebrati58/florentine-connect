-- =====================================================================
-- 4FLORENTINE · v2.2 — votes de copropriété et procurations (ייפוי כוח)
--
--  · Une voix par appartement (ou pondérée par sa quote-part si le vote l'exige)
--  · Le résident vote lui-même, ou donne procuration à un autre appartement
--    (pour un vote précis ou pour tous les votes jusqu'à une date)
--  · Le titulaire de la procuration doit l'accepter, PUIS l'administrateur doit l'approuver ;
--    le mandant peut la révoquer à tout moment
--  · Si le mandant vote lui-même, son vote remplace celui de son mandataire
--  · Le gestionnaire peut enregistrer une procuration papier et les voix
--    exprimées en assemblée physique
--  · Vote secret : personne (ni l'équipe) ne voit le choix d'un appartement,
--    seulement les totaux et la liste de participation
-- Dépend de : 20261111090000_entrances_areas_categories.sql
-- Retour arrière : supabase/rollback/20261111110000_votes_proxies_down.sql
-- =====================================================================

alter table public.apartments add column if not exists vote_weight numeric(9,4) not null default 1;
alter table public.apartments drop constraint if exists apartments_vote_weight_check;
alter table public.apartments add constraint apartments_vote_weight_check check (vote_weight > 0);
alter table public.apartments add column if not exists can_vote boolean not null default true;
grant update (vote_weight, can_vote) on public.apartments to authenticated;

create table if not exists public.votes (
  id                     bigint generated always as identity primary key,
  title                  text not null check (char_length(title) between 3 and 160),
  body                   text check (body is null or char_length(body) <= 5000),
  translations           jsonb not null default '{}'::jsonb,
  scope_tower            smallint references public.towers(id),
  scope_entrance         smallint references public.entrances(id),
  rule                   text not null default 'majority_cast'
                         check (rule in ('majority_cast','majority_all','two_thirds_all','three_quarters_all')),
  weighted               boolean not null default false,
  secret                 boolean not null default false,
  live_results           boolean not null default false,
  allow_proxies          boolean not null default true,
  max_proxies_per_holder smallint check (max_proxies_per_holder is null or max_proxies_per_holder between 1 and 50),
  status                 text not null default 'draft' check (status in ('draft','open','closed','cancelled')),
  opens_at               timestamptz,
  closes_at              timestamptz,
  closed_at              timestamptz,
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (closes_at is null or opens_at is null or closes_at > opens_at)
);

create table if not exists public.vote_options (
  id           bigint generated always as identity primary key,
  vote_id      bigint not null references public.votes(id) on delete cascade,
  position     smallint not null default 0,
  kind         text not null default 'choice' check (kind in ('yes','no','abstain','choice')),
  label        text not null check (char_length(label) between 1 and 120),
  translations jsonb not null default '{}'::jsonb
);
create index if not exists vote_options_vote_idx on public.vote_options (vote_id, position);

create table if not exists public.proxies (
  id                bigint generated always as identity primary key,
  grantor_apartment bigint not null references public.apartments(id) on delete cascade,
  holder_apartment  bigint references public.apartments(id) on delete cascade,
  holder_name       text check (holder_name is null or char_length(holder_name) between 2 and 80),
  vote_id           bigint references public.votes(id) on delete cascade,   -- null = tous les votes
  valid_until       timestamptz,
  status            text not null default 'pending'
                    check (status in ('pending','awaiting_approval','active','rejected','revoked')),
  source            text not null default 'app' check (source in ('app','paper')),
  note              text check (note is null or char_length(note) <= 300),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  responded_at      timestamptz,
  approved_by       uuid,
  approved_at       timestamptz,
  rejected_reason   text check (rejected_reason is null or char_length(rejected_reason) <= 300),
  revoked_at        timestamptz,
  check (holder_apartment is not null or holder_name is not null),
  check (holder_apartment is distinct from grantor_apartment)
);
create unique index if not exists proxies_one_live_per_scope
  on public.proxies (grantor_apartment, coalesce(vote_id, 0)) where status in ('pending','awaiting_approval','active');
create index if not exists proxies_holder_idx on public.proxies (holder_apartment, status);

create table if not exists public.ballots (
  id           bigint generated always as identity primary key,
  vote_id      bigint not null references public.votes(id) on delete cascade,
  apartment_id bigint not null references public.apartments(id) on delete cascade,
  option_id    bigint not null references public.vote_options(id) on delete cascade,
  method       text not null check (method in ('direct','proxy','assembly')),
  proxy_id     bigint references public.proxies(id) on delete set null,
  cast_by      uuid,
  cast_at      timestamptz not null default now(),
  unique (vote_id, apartment_id)
);

-- Journal de toutes les voix exprimées (changements compris) — consultable par l'équipe
create table if not exists public.ballot_log (
  id           bigint generated always as identity primary key,
  vote_id      bigint not null references public.votes(id) on delete cascade,
  apartment_id bigint not null,
  option_id    bigint,
  method       text not null,
  proxy_id     bigint,
  cast_by      uuid,
  note         text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Règles métier
-- ---------------------------------------------------------------------

create or replace function public.vote_is_open(p_vote bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.votes v where v.id = p_vote and v.status = 'open'
                  and (v.opens_at is null or v.opens_at <= now())
                  and (v.closes_at is null or v.closes_at > now()))
$$;

create or replace function public.apartment_in_vote(p_vote bigint, p_apartment bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.votes v join public.apartments a on a.id = p_apartment
                  where v.id = p_vote and a.active and a.can_vote
                    and (v.scope_tower is null or a.tower_id = v.scope_tower)
                    and (v.scope_entrance is null or a.entrance = v.scope_entrance))
$$;

create or replace function public.active_proxy(p_vote bigint, p_grantor bigint, p_holder bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select p.id from public.proxies p
   where p.grantor_apartment = p_grantor and p.holder_apartment = p_holder and p.status = 'active'
     and (p.vote_id is null or p.vote_id = p_vote)
     and (p.valid_until is null or p.valid_until > now())
   order by (p.vote_id is null), p.created_at desc limit 1
$$;

-- Verrouillage : règles et options figées dès l'ouverture du vote
create or replace function public.votes_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if (new.rule, new.weighted, new.secret, new.allow_proxies, new.scope_tower, new.scope_entrance, new.max_proxies_per_holder)
       is distinct from
       (old.rule, old.weighted, old.secret, old.allow_proxies, old.scope_tower, old.scope_entrance, old.max_proxies_per_holder) then
      raise exception 'vote_locked';
    end if;
    if old.status in ('closed','cancelled') and new.status in ('draft','open') then raise exception 'vote_locked'; end if;
  end if;
  if new.status = 'open' and not exists (select 1 from public.vote_options where vote_id = new.id) then
    raise exception 'vote_without_options';
  end if;
  if new.status in ('closed','cancelled') and (tg_op = 'INSERT' or old.status not in ('closed','cancelled')) then
    new.closed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists votes_bw on public.votes;
create trigger votes_bw before insert or update on public.votes
  for each row execute function public.votes_before_write();

create or replace function public.vote_options_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.votes where id = coalesce(new.vote_id, old.vote_id);
  if v_status is distinct from 'draft' then raise exception 'vote_locked'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists vote_options_guard on public.vote_options;
create trigger vote_options_guard before insert or update or delete on public.vote_options
  for each row execute function public.vote_options_guard();

create or replace function public.write_ballot(p_vote bigint, p_option bigint, p_apartment bigint,
                                               p_method text, p_proxy bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.vote_options where id = p_option and vote_id = p_vote) then
    raise exception 'bad_option';
  end if;
  insert into public.ballots (vote_id, apartment_id, option_id, method, proxy_id, cast_by, cast_at)
  values (p_vote, p_apartment, p_option, p_method, p_proxy, auth.uid(), now())
  on conflict (vote_id, apartment_id) do update
     set option_id = excluded.option_id, method = excluded.method, proxy_id = excluded.proxy_id,
         cast_by = excluded.cast_by, cast_at = excluded.cast_at;
  insert into public.ballot_log (vote_id, apartment_id, option_id, method, proxy_id, cast_by, note)
  values (p_vote, p_apartment, p_option, p_method, p_proxy, auth.uid(), p_note);
end $$;

-- Vote d'un résident, pour son appartement ou au titre d'une procuration
create or replace function public.cast_ballot(p_vote bigint, p_option bigint, p_for_apartment bigint default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.my_apartment_id(); v_target bigint; v_proxy bigint; v_existing text;
begin
  if v_me is null then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(p_vote);
  if not public.vote_is_open(p_vote) then raise exception 'vote_closed'; end if;
  v_target := coalesce(p_for_apartment, v_me);
  if not public.apartment_in_vote(p_vote, v_target) then raise exception 'not_eligible'; end if;
  if v_target = v_me then
    perform public.write_ballot(p_vote, p_option, v_me, 'direct', null, null);
    return 'direct';
  end if;
  if not (select allow_proxies from public.votes where id = p_vote) then raise exception 'proxies_disabled'; end if;
  v_proxy := public.active_proxy(p_vote, v_target, v_me);
  if v_proxy is null then raise exception 'no_proxy'; end if;
  select method into v_existing from public.ballots where vote_id = p_vote and apartment_id = v_target;
  if v_existing in ('direct','assembly') then raise exception 'owner_already_voted'; end if;
  perform public.write_ballot(p_vote, p_option, v_target, 'proxy', v_proxy, null);
  return 'proxy';
end $$;

-- Voix recueillie en assemblée (ou sur bulletin papier) par le gestionnaire
create or replace function public.staff_cast_ballot(p_vote bigint, p_option bigint, p_apartment bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(p_vote);
  if not public.vote_is_open(p_vote) then raise exception 'vote_closed'; end if;
  if not public.apartment_in_vote(p_vote, p_apartment) then raise exception 'not_eligible'; end if;
  perform public.write_ballot(p_vote, p_option, p_apartment, 'assembly', null, p_note);
end $$;

-- Procuration donnée depuis l'application (le mandataire doit l'accepter)
create or replace function public.grant_proxy(p_holder_entrance smallint, p_holder_number text,
                                              p_vote bigint default null, p_valid_until timestamptz default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.my_apartment_id(); v_holder bigint; v_id bigint;
begin
  if v_me is null then raise exception 'not_member'; end if;
  select id into v_holder from public.apartments
   where entrance = p_holder_entrance and lower(number) = lower(trim(p_holder_number)) and active;
  if v_holder is null then raise exception 'holder_not_found'; end if;
  if v_holder = v_me then raise exception 'self_proxy'; end if;
  if p_vote is not null then
    if not exists (select 1 from public.votes where id = p_vote and status in ('draft','open') and allow_proxies) then
      raise exception 'proxies_disabled';
    end if;
    if not public.apartment_in_vote(p_vote, v_me) then raise exception 'not_eligible'; end if;
  end if;
  if p_valid_until is not null and p_valid_until <= now() then raise exception 'bad_date'; end if;
  -- Une nouvelle procuration remplace la précédente sur le même périmètre
  update public.proxies set status = 'revoked', revoked_at = now()
   where grantor_apartment = v_me and coalesce(vote_id, 0) = coalesce(p_vote, 0) and status in ('pending','awaiting_approval','active');
  insert into public.proxies (grantor_apartment, holder_apartment, vote_id, valid_until, status, source)
  values (v_me, v_holder, p_vote, p_valid_until, 'pending', 'app') returning id into v_id;
  return v_id;
end $$;

create or replace function public.proxy_limit_reached(p_holder bigint, p_vote bigint)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_max smallint; v_held int;
begin
  if p_vote is null or p_holder is null then return false; end if;
  select max_proxies_per_holder into v_max from public.votes where id = p_vote;
  if v_max is null then return false; end if;
  select count(*) into v_held from public.proxies
   where holder_apartment = p_holder and status = 'active'
     and (vote_id is null or vote_id = p_vote) and (valid_until is null or valid_until > now());
  return v_held >= v_max;
end $$;

-- Le mandataire accepte ou refuse ; une acceptation part ensuite en validation chez l'administrateur
create or replace function public.respond_proxy(p_proxy bigint, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p public.proxies%rowtype;
begin
  select * into p from public.proxies where id = p_proxy for update;
  if p.id is null or p.holder_apartment is distinct from public.my_apartment_id() then raise exception 'forbidden'; end if;
  if p.status <> 'pending' then raise exception 'proxy_not_pending'; end if;
  update public.proxies set status = case when p_accept then 'awaiting_approval' else 'rejected' end, responded_at = now()
   where id = p_proxy;
end $$;

-- L'administrateur (propriétaire ou gestionnaire) approuve ou refuse la procuration
create or replace function public.approve_proxy(p_proxy bigint, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p public.proxies%rowtype;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  select * into p from public.proxies where id = p_proxy for update;
  if p.id is null then raise exception 'not_found'; end if;
  if p.status <> 'awaiting_approval' then raise exception 'proxy_not_awaiting'; end if;
  if p_approve and public.proxy_limit_reached(p.holder_apartment, p.vote_id) then raise exception 'proxy_limit'; end if;
  update public.proxies
     set status = case when p_approve then 'active' else 'rejected' end,
         approved_by = auth.uid(), approved_at = now(),
         rejected_reason = case when p_approve then null else nullif(trim(p_reason), '') end
   where id = p_proxy;
end $$;

create or replace function public.revoke_proxy(p_proxy bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.proxies set status = 'revoked', revoked_at = now()
   where id = p_proxy and status in ('pending','awaiting_approval','active')
     and (grantor_apartment = public.my_apartment_id() or public.is_manager());
  if not found then raise exception 'forbidden'; end if;
end $$;

-- Procuration papier enregistrée par le gestionnaire (active immédiatement)
create or replace function public.staff_register_proxy(p_grantor bigint, p_holder bigint, p_holder_name text,
                                                       p_vote bigint, p_valid_until timestamptz, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  if p_holder = p_grantor then raise exception 'self_proxy'; end if;
  if public.proxy_limit_reached(p_holder, p_vote) then raise exception 'proxy_limit'; end if;
  update public.proxies set status = 'revoked', revoked_at = now()
   where grantor_apartment = p_grantor and coalesce(vote_id, 0) = coalesce(p_vote, 0) and status in ('pending','awaiting_approval','active');
  insert into public.proxies (grantor_apartment, holder_apartment, holder_name, vote_id, valid_until, status, source, note,
                              responded_at, approved_by, approved_at)
  values (p_grantor, p_holder, nullif(trim(p_holder_name), ''), p_vote, p_valid_until, 'active', 'paper', p_note,
          now(), auth.uid(), now())
  returning id into v_id;
  return v_id;
end $$;

-- Résultats agrégés (jamais le détail d'un vote secret)
create or replace function public.vote_summary(p_vote bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.votes%rowtype; v_me bigint := public.my_apartment_id();
        v_elig_n int; v_elig_w numeric; v_cast_n int; v_cast_w numeric; v_yes numeric; v_no numeric;
        v_opts jsonb; v_passed boolean; v_need numeric;
begin
  select * into v from public.votes where id = p_vote;
  if v.id is null then raise exception 'not_found'; end if;
  if not public.is_staff() then
    if v_me is null or v.status = 'draft' or not public.apartment_in_vote(p_vote, v_me) then raise exception 'forbidden'; end if;
    if v.status = 'open' and not v.live_results then
      return jsonb_build_object('hidden', true);
    end if;
  end if;
  select count(*), coalesce(sum(case when v.weighted then a.vote_weight else 1 end), 0)
    into v_elig_n, v_elig_w
    from public.apartments a where public.apartment_in_vote(p_vote, a.id);
  select count(*), coalesce(sum(case when v.weighted then a.vote_weight else 1 end), 0)
    into v_cast_n, v_cast_w
    from public.ballots b join public.apartments a on a.id = b.apartment_id
   where b.vote_id = p_vote and public.apartment_in_vote(p_vote, a.id);
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'kind', o.kind,
           'translations', o.translations, 'count', coalesce(r.n, 0), 'weight', coalesce(r.w, 0)) order by o.position, o.id), '[]'::jsonb)
    into v_opts
    from public.vote_options o
    left join (select b.option_id, count(*) n, sum(case when v.weighted then a.vote_weight else 1 end) w
                 from public.ballots b join public.apartments a on a.id = b.apartment_id
                where b.vote_id = p_vote and public.apartment_in_vote(p_vote, a.id)
                group by b.option_id) r on r.option_id = o.id
   where o.vote_id = p_vote;
  select coalesce(sum((e->>'weight')::numeric) filter (where e->>'kind' = 'yes'), 0),
         coalesce(sum((e->>'weight')::numeric) filter (where e->>'kind' = 'no'), 0)
    into v_yes, v_no from jsonb_array_elements(v_opts) e;
  if exists (select 1 from jsonb_array_elements(v_opts) e where e->>'kind' = 'yes') then
    v_need := case v.rule when 'majority_all' then v_elig_w / 2
                          when 'two_thirds_all' then v_elig_w * 2 / 3
                          when 'three_quarters_all' then v_elig_w * 3 / 4 end;
    v_passed := case v.rule when 'majority_cast' then v_yes > v_no
                            when 'majority_all' then v_yes > v_need
                            else v_yes >= v_need end;
  end if;
  return jsonb_build_object('hidden', false, 'status', v.status, 'rule', v.rule, 'weighted', v.weighted,
    'eligible_count', v_elig_n, 'eligible_weight', v_elig_w, 'cast_count', v_cast_n, 'cast_weight', v_cast_w,
    'yes_weight', v_yes, 'no_weight', v_no, 'threshold_weight', v_need, 'passed', v_passed, 'options', v_opts);
end $$;

-- Participation (équipe) : qui a voté et comment ; le choix seulement si le vote n'est pas secret
create or replace function public.vote_participation(p_vote bigint)
returns table (apartment_id bigint, entrance smallint, number text, method text, cast_at timestamptz,
               option_id bigint, holder_label text)
language plpgsql stable security definer set search_path = public as $$
declare v_secret boolean;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  select secret into v_secret from public.votes where id = p_vote;
  return query
    select a.id, a.entrance, a.number, b.method, b.cast_at,
           case when v_secret then null else b.option_id end,
           case when b.method = 'proxy' then (select 'כניסה ' || h.entrance || ' · דירה ' || h.number
                                                from public.proxies p join public.apartments h on h.id = p.holder_apartment
                                               where p.id = b.proxy_id) end
      from public.apartments a
      left join public.ballots b on b.apartment_id = a.id and b.vote_id = p_vote
     where public.apartment_in_vote(p_vote, a.id)
     order by a.entrance, a.number;
end $$;

-- Procurations vues par un résident (données / reçues), avec le libellé des appartements
create or replace function public.my_proxies()
returns table (id bigint, direction text, other_label text, other_apartment bigint, vote_id bigint, vote_title text,
               valid_until timestamptz, status text, created_at timestamptz, rejected_reason text)
language sql stable security definer set search_path = public as $$
  select p.id,
         case when p.grantor_apartment = public.my_apartment_id() then 'given' else 'received' end,
         case when p.grantor_apartment = public.my_apartment_id()
              then coalesce((select 'E' || h.entrance || '-' || h.number from public.apartments h where h.id = p.holder_apartment), p.holder_name)
              else (select 'E' || g.entrance || '-' || g.number from public.apartments g where g.id = p.grantor_apartment) end,
         case when p.grantor_apartment = public.my_apartment_id() then p.holder_apartment else p.grantor_apartment end,
         p.vote_id, (select title from public.votes where id = p.vote_id), p.valid_until, p.status, p.created_at,
         p.rejected_reason
    from public.proxies p
   where public.my_apartment_id() is not null
     and (p.grantor_apartment = public.my_apartment_id() or p.holder_apartment = public.my_apartment_id())
     and (p.status in ('pending','awaiting_approval','active')
          or (p.status = 'rejected' and coalesce(p.approved_at, p.responded_at) > now() - interval '30 days'))
   order by p.created_at desc
$$;

-- ---------------------------------------------------------------------
-- RLS et droits
-- ---------------------------------------------------------------------
alter table public.votes        enable row level security;
alter table public.vote_options enable row level security;
alter table public.proxies      enable row level security;
alter table public.ballots      enable row level security;
alter table public.ballot_log   enable row level security;

revoke all on public.votes, public.vote_options, public.proxies, public.ballots, public.ballot_log from anon;
grant select, insert, update on public.votes to authenticated;
grant select, insert, update, delete on public.vote_options to authenticated;
grant select on public.proxies, public.ballots, public.ballot_log to authenticated;
revoke insert, update, delete on public.proxies, public.ballots, public.ballot_log from authenticated;

drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes for select using (
  public.is_staff() or (status in ('open','closed') and public.apartment_in_vote(id, public.my_apartment_id())));
drop policy if exists votes_insert on public.votes;
create policy votes_insert on public.votes for insert with check (public.is_manager());
drop policy if exists votes_update on public.votes;
create policy votes_update on public.votes for update using (public.is_manager()) with check (public.is_manager());

drop policy if exists vote_options_read on public.vote_options;
create policy vote_options_read on public.vote_options for select using (
  exists (select 1 from public.votes v where v.id = vote_id));   -- hérite de votes_read
drop policy if exists vote_options_write on public.vote_options;
create policy vote_options_write on public.vote_options for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists proxies_read on public.proxies;
create policy proxies_read on public.proxies for select using (
  public.is_staff() or grantor_apartment = public.my_apartment_id() or holder_apartment = public.my_apartment_id());

drop policy if exists ballots_read on public.ballots;
create policy ballots_read on public.ballots for select using (
  apartment_id = public.my_apartment_id()
  or (proxy_id is not null and exists (select 1 from public.proxies p where p.id = proxy_id and p.holder_apartment = public.my_apartment_id()))
  or (public.is_staff() and not (select secret from public.votes v where v.id = vote_id)));

drop policy if exists ballot_log_read on public.ballot_log;
create policy ballot_log_read on public.ballot_log for select using (
  public.is_staff() and not (select secret from public.votes v where v.id = vote_id));

-- Fonctions : triggers et utilitaires internes jamais appelables directement
revoke execute on function public.votes_before_write(), public.vote_options_guard(),
  public.write_ballot(bigint, bigint, bigint, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.vote_is_open(bigint), public.apartment_in_vote(bigint, bigint),
  public.active_proxy(bigint, bigint, bigint), public.cast_ballot(bigint, bigint, bigint),
  public.staff_cast_ballot(bigint, bigint, bigint, text), public.grant_proxy(smallint, text, bigint, timestamptz),
  public.respond_proxy(bigint, boolean), public.approve_proxy(bigint, boolean, text), public.revoke_proxy(bigint),
  public.staff_register_proxy(bigint, bigint, text, bigint, timestamptz, text), public.proxy_limit_reached(bigint, bigint),
  public.vote_summary(bigint), public.vote_participation(bigint), public.my_proxies() from public, anon;
grant execute on function public.vote_is_open(bigint), public.apartment_in_vote(bigint, bigint),
  public.active_proxy(bigint, bigint, bigint), public.cast_ballot(bigint, bigint, bigint),
  public.staff_cast_ballot(bigint, bigint, bigint, text), public.grant_proxy(smallint, text, bigint, timestamptz),
  public.respond_proxy(bigint, boolean), public.approve_proxy(bigint, boolean, text), public.revoke_proxy(bigint),
  public.staff_register_proxy(bigint, bigint, text, bigint, timestamptz, text), public.proxy_limit_reached(bigint, bigint),
  public.vote_summary(bigint), public.vote_participation(bigint), public.my_proxies() to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.votes, public.ballots';
    exception when duplicate_object then null; end;
  end if;
end $$;
