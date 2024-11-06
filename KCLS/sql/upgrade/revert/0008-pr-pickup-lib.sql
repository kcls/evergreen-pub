-- Revert kcls-evergreen:XXXX-pr-pickup-lib from pg

BEGIN;

ALTER TABLE actor.usr_item_request DROP COLUMN pickup_lib;

COMMIT;
