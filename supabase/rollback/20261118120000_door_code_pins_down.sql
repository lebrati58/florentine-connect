-- Retour arrière de 20261118120000_door_code_pins.
-- Supprime les codes de porte, et seulement les appartements de la liste qui n'ont
-- encore ni compte ni donnée liée (les clés étrangères bloquent sinon).
begin;
drop table if exists public.tower_door_codes;
delete from public.apartments a
where a.user_id is null and a.pin_set_at is null
  and a.number = a.tower_id::text || a.floor::text || right(a.number, 1)
  and a.tower_id between 1 and 6 and a.floor between 1 and 9;
commit;
