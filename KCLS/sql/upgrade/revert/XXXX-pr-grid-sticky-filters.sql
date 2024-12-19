-- Revert kcls-evergreen:XXXX-pr-grid-sticky-filters from pg

BEGIN;

DELETE FROM actor.workstation_setting WHERE name = 'eg.acq.request.list.filters';
DELETE FROM config.workstation_setting_type WHERE name = 'eg.acq.request.list.filters';

COMMIT;
