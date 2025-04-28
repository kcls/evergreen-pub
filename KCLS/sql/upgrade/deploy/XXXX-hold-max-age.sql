-- Deploy kcls-evergreen:XXXX-hold-max-age to pg
-- requires: 0018-ill-req-perm

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT into config.org_unit_setting_type
    (name, grp, label, description, datatype) 
VALUES (
    'circ.holds.max_age_interval',
    'holds', 
    'Max Hold Age Interval',
    'Max Hold Age Interval',
    'interval'
);

INSERT INTO actor.org_unit_setting (org_unit, name, value) 
    VALUES (1, 'circ.holds.max_age_interval', '"4 years"');

END IF; END $INSERT$;                                                          

COMMIT;
