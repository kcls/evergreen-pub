-- Deploy kcls-evergreen:pending-patrons-notice to pg
-- requires: 0004-damaged-item-letter

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT INTO action_trigger.event_definition (
    id, active, owner, name, hook, validator, reactor, 
    delay, granularity, retention_interval 
) VALUES (
    263,
    TRUE,
    1,
    'eCard Registration Email',
    'au.create.ecard',
    'NOOP_True',
    'NOOP_True',
    '00:00:00',
    'Ecard-Register-Email',
    '1 year'
);

END IF; END $INSERT$;                                                          

COMMIT;
