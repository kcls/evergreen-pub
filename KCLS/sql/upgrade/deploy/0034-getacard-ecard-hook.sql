-- Deploy kcls-evergreen:0035-getacard-ecard-hook to pg
-- requires: 0034-drop-xml2
--
-- Give the new getacard registration app its own hook so its events are
-- kept apart from those of the old Quipu/external eCard registration,
-- which continues to fire au.create.ecard.

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN

INSERT INTO action_trigger.hook (key, core_type, description, passive)
SELECT
    'au.create.ecard.getacard',
    core_type,
    'New eCard user created via the getacard app (not the old Quipu app)',
    passive
FROM action_trigger.hook
WHERE key = 'au.create.ecard';

UPDATE action_trigger.event_definition
    SET hook = 'au.create.ecard.getacard'
    WHERE granularity = 'Ecard-Register-Email';

END IF; END $INSERT$;

COMMIT;
