-- Retour arrière de 20261111150000_visit_scheduling.sql
-- ⚠️ supprime les campagnes de rendez-vous, créneaux et réponses — faire une sauvegarde avant.
drop function if exists public.visit_schedule(bigint);
drop function if exists public.visit_slot_counts(bigint);
drop function if exists public.staff_book_visit(bigint, bigint, bigint, text);
drop function if exists public.cancel_visit_booking(bigint);
drop function if exists public.book_visit_slot(bigint, bigint, text);
drop function if exists public.write_visit_booking(bigint, bigint, bigint, text, text);
drop table if exists public.visit_bookings;
drop table if exists public.visit_slots;
drop table if exists public.visit_campaigns;
drop function if exists public.visit_slots_guard();
drop function if exists public.visit_campaigns_before_write();
drop function if exists public.apartment_in_campaign(bigint, bigint);
