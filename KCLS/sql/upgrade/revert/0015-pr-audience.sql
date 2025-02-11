-- Revert kcls-evergreen:XXXX-pr-audience from pg

BEGIN;

ALTER TABLE actor.usr_item_request DROP COLUMN audience TEXT;

COMMIT;
