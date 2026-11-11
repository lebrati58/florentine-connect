-- Retour arrière v2.2 (votes et procurations). À exécuter AVANT le rollback v2.1.
-- ⚠️ Supprime les votes, bulletins et procurations enregistrés. Sauvegarder avant.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime drop table public.votes'; exception when others then null; end;
    begin execute 'alter publication supabase_realtime drop table public.ballots'; exception when others then null; end;
  end if;
end $$;
drop function if exists public.my_proxies();
drop function if exists public.vote_participation(bigint);
drop function if exists public.vote_summary(bigint);
drop function if exists public.staff_register_proxy(bigint, bigint, text, bigint, timestamptz, text);
drop function if exists public.revoke_proxy(bigint);
drop function if exists public.approve_proxy(bigint, boolean, text);
drop function if exists public.respond_proxy(bigint, boolean);
drop function if exists public.proxy_limit_reached(bigint, bigint);
drop function if exists public.grant_proxy(smallint, text, bigint, timestamptz);
drop function if exists public.staff_cast_ballot(bigint, bigint, bigint, text);
drop function if exists public.cast_ballot(bigint, bigint, bigint);
drop table if exists public.ballot_log;
drop table if exists public.ballots;
drop table if exists public.proxies;
drop table if exists public.vote_options;
drop table if exists public.votes;
drop function if exists public.write_ballot(bigint, bigint, bigint, text, bigint, text);
drop function if exists public.vote_options_guard();
drop function if exists public.votes_before_write();
drop function if exists public.active_proxy(bigint, bigint, bigint);
drop function if exists public.apartment_in_vote(bigint, bigint);
drop function if exists public.vote_is_open(bigint);
alter table public.apartments drop constraint if exists apartments_vote_weight_check;
alter table public.apartments drop column if exists vote_weight;
alter table public.apartments drop column if exists can_vote;
