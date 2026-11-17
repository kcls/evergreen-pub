-- Revert kcls-evergreen:0035-getacard-ecard-hook from pg

BEGIN;

UPDATE action_trigger.event_definition
    SET hook = 'au.create.ecard'
    WHERE hook = 'au.create.ecard.getacard';

DELETE FROM action_trigger.hook WHERE key = 'au.create.ecard.getacard';

COMMIT;
