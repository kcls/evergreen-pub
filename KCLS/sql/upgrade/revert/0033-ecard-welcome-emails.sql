-- Revert kcls-evergreen:0033-ecard-welcome-emails from pg

BEGIN;

DELETE FROM action_trigger.event WHERE event_def = 263;
DELETE FROM action_trigger.event_definition WHERE id = 263;

COMMIT;
