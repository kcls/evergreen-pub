-- Revert kcls-evergreen:XXXX-transit-sips from pg

BEGIN;

DELETE FROM actor.workstation_setting WHERE name = 'eg.circ.checkin.auto_print_transits';
DELETE FROM config.workstation_setting_type name = 'eg.circ.checkin.auto_print_transits';

COMMIT;
