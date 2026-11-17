-- Add missing building identifiers without changing existing apartments or accounts.
begin;
insert into public.towers (id, name, name_he) values
  (5, 'Tour 5', 'בניין 5'),
  (6, 'Tour 6', 'בניין 6')
on conflict (id) do nothing;
commit;
