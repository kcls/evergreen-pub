-- Revert kcls-evergreen:pending-patrons-notice from pg

BEGIN;

DELETE FROM action_trigger.event WHERE event_def = 262;
DELETE FROM action_trigger.event_definition WHERE id = 262;

COMMIT;
