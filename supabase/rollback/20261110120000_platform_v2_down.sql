-- =====================================================================
-- 4FLORENTINE · Retour arrière de la migration platform_v2
--
-- ⚠️  Supprime les objets créés par la v2 ET les données saisies depuis
--     (tickets, annuaire v2, annonces…). Faire une sauvegarde avant :
--     Dashboard Supabase → Database → Backups, ou pg_dump.
-- Ne touche pas aux tables préexistantes (ex. directory_suggestions),
-- sauf la politique de lecture ajoutée par la v2.
-- Les comptes auth des appartements ne sont pas supprimés (à faire
-- manuellement dans Authentication si souhaité).
-- =====================================================================

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime drop table public.tickets'; exception when others then null; end;
    begin execute 'alter publication supabase_realtime drop table public.ticket_events'; exception when others then null; end;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'drop policy if exists ticket_photos_obj_read on storage.objects';
    execute 'drop policy if exists ticket_photos_obj_insert on storage.objects';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'directory_suggestions') then
    execute 'drop policy if exists directory_suggestions_staff_read on public.directory_suggestions';
  end if;
end $$;

drop view  if exists public.directory_overview;
drop table if exists public.directory_reports;
drop table if exists public.directory_recommendations;
drop table if exists public.directory_revisions;
drop table if exists public.directory_entries;
drop table if exists public.announcements;
drop table if exists public.interventions;
drop table if exists public.ticket_photos;
drop table if exists public.ticket_events;
drop table if exists public.tickets;
drop table if exists public.vendors;
drop table if exists public.apartments;
drop table if exists public.staff;
drop table if exists public.towers;

drop function if exists public.revoke_user_sessions(uuid);
drop function if exists public.ticket_id_from_path(text);
drop function if exists public.restore_directory_version(bigint, integer);
drop function if exists public.resident_cancel_ticket(bigint);
drop function if exists public.directory_reports_before_insert();
drop function if exists public.directory_reports_after_insert();
drop function if exists public.directory_reco_before_write();
drop function if exists public.directory_after_write();
drop function if exists public.directory_before_write();
drop function if exists public.directory_rate_check();
drop function if exists public.interventions_after_write();
drop function if exists public.ticket_photos_after_insert();
drop function if exists public.ticket_events_before_insert();
drop function if exists public.tickets_after_write();
drop function if exists public.tickets_before_update();
drop function if exists public.tickets_before_insert();
drop function if exists public.actor_kind();
drop function if exists public.can_access_ticket(bigint);
drop function if exists public.claim_first_owner(text);
drop function if exists public.staff_bootstrap_open();
drop function if exists public.is_member();
drop function if exists public.my_tower_id();
drop function if exists public.my_apartment_id();
drop function if exists public.is_owner();
drop function if exists public.is_manager();
drop function if exists public.staff_can_edit();
drop function if exists public.is_staff();
drop function if exists public.staff_role();

-- Le bucket "ticket-photos" est conservé (Supabase interdit la suppression SQL
-- d'un bucket non vide). Le vider puis le supprimer depuis Storage si besoin.
