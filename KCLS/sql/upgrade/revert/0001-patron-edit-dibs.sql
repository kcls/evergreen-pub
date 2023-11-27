-- Revert kcls-evergreen:XXXX-patron-edit-dibs from pg

BEGIN;

ALTER TABLE actor.usr DROP COLUMN dibs;
ALTER TABLE auditor.actor_usr_history DROP COLUMN dibs;

COMMIT;
