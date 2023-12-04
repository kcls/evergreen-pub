-- Deploy kcls-evergreen:XXXX-org-select-short-names to pg
-- requires: 0013-refund-summary-letter

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.orgselect.show_short_names', 
    'gui', 
    'bool',
    'Org Select Show Short Names Only'
);

END IF; END $INSERT$;                                                          

COMMIT;
