-- Deploy kcls-evergreen:0033-ecard-welcome-emails to pg
-- requires: 0032-sms-opt-in-setting-group

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT INTO action_trigger.event_definition (
    id, active, owner, name, hook, validator, reactor, 
    delay, granularity, retention_interval 
) VALUES (
    263,
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
