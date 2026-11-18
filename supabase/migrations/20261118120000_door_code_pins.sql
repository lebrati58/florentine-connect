-- Codes de porte des bâtiments + liste des 300 appartements.
-- Le code d'un appartement = code de porte du bâtiment + numéro d'appartement (ex. code fictif 1234 + appartement 491 = 1234491).
-- Les codes de porte ne sont JAMAIS écrits dans ce dépôt (public) : ils sont saisis
-- directement en base. Table lisible uniquement par la fonction serveur (service_role).
begin;

create table if not exists public.tower_door_codes (
  tower_id   smallint primary key references public.towers(id),
  door_code  text not null check (door_code ~ '^[0-9]{4}$'),
  updated_at timestamptz not null default now()
);
alter table public.tower_door_codes enable row level security;
-- Aucune policy : ni les habitants ni l'équipe ne peuvent lire cette table via l'API.
revoke all on table public.tower_door_codes from public, anon, authenticated;
grant all on table public.tower_door_codes to service_role;

-- 6 bâtiments ; étages 1 à 8 : appartements 1 à 6 ; étage 9 : appartements 1 et 2.
insert into public.apartments (tower_id, number, floor)
select t, t::text || f::text || u::text, f
from generate_series(1, 6) t, generate_series(1, 9) f, generate_series(1, 6) u
where f < 9 or u <= 2
on conflict (tower_id, number) do nothing;

commit;
