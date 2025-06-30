-- Revert kcls-evergreen:XXXX-pr-edited-by from pg

BEGIN;

ALTER TABLE actor.usr_item_request DROP COLUMN edited_by, DROP COLUMN edit_date;

COMMIT;
