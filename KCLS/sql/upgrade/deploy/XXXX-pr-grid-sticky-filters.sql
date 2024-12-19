-- Deploy kcls-evergreen:XXXX-pr-grid-sticky-filters to pg
-- requires: 0009-phone-settings-index

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.acq.request.list.filters','acq','object',
    'Patron Requests Management Filters'
);


END IF; END $INSERT$;

COMMIT;
