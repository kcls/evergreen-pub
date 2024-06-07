-- Deploy kcls-evergreen:pending-patrons-notice to pg
-- requires: 0004-damaged-item-letter

BEGIN;

-- old bug
UPDATE action_trigger.hook SET passive = FALSE WHERE key = 'stgu.created';

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT INTO action_trigger.event_definition (
    id, active, owner, name, hook, validator, reactor, 
    delay, granularity, retention_interval 
) VALUES (
    262,
    TRUE,
    1,
    'All-Access Registration Email',
    'stgu.created',
    'NOOP_True',
    'NOOP_True',
    '00:00:00',
    'All-Access-Register-Email',
    '1 year'
);

END IF; END $INSERT$;                                                          

COMMIT;
