-- Revert kcls-evergreen:XXXX-org-select-short-names from pg

BEGIN;

DELETE FROM actor.workstation_setting WHERE name = 'eg.orgselect.show_short_names';
DELETE FROM config.workstation_setting_type WHERE name = 'eg.orgselect.show_short_names';

COMMIT;
