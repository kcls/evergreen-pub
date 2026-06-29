-- Revert kcls-evergreen:0028-retain-transit-data from pg

BEGIN;

ALTER TABLE action.transit_copy
    DROP COLUMN IF EXISTS orig_source,
    DROP COLUMN IF EXISTS created_at;

COMMIT;
