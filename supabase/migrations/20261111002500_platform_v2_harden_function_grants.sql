-- Fonctions de trigger : jamais appelables via l'API (les triggers s'exécutent sans privilège EXECUTE)
revoke execute on function public.tickets_before_insert(), public.tickets_after_write(), public.tickets_before_update(),
  public.ticket_events_before_insert(), public.ticket_photos_after_insert(), public.interventions_after_write(),
  public.directory_before_write(), public.directory_after_write(), public.directory_reco_before_write(),
  public.directory_reports_before_insert(), public.directory_reports_after_insert(), public.directory_rate_check()
  from public, anon, authenticated;
-- Fonctions d'autorisation : réservées aux comptes connectés (utilisées par les politiques RLS)
revoke execute on function public.staff_role(), public.is_staff(), public.staff_can_edit(), public.is_manager(),
  public.is_owner(), public.my_apartment_id(), public.my_tower_id(), public.is_member(), public.actor_kind(),
  public.can_access_ticket(bigint)
  from public, anon;
grant execute on function public.staff_role(), public.is_staff(), public.staff_can_edit(), public.is_manager(),
  public.is_owner(), public.my_apartment_id(), public.my_tower_id(), public.is_member(), public.actor_kind(),
  public.can_access_ticket(bigint)
  to authenticated;
