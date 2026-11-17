-- Run only if buildings 5 and 6 were created by this migration.
-- Existing foreign keys prevent deleting a building that has dependent data.
begin;
delete from public.towers where id in (5, 6);
commit;
