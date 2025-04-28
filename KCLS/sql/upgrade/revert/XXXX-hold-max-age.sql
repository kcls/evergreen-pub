-- Revert kcls-evergreen:XXXX-hold-max-age from pg

BEGIN;

DELETE FROM config.org_unit_setting_type_log WHERE name = 'circ.holds.max_age_interval';
DELETE FROM actor.org_unit_setting WHERE name = 'circ.holds.max_age_interval';
DELETE FROM config.org_unit_setting_type WHERE name = 'circ.holds.max_age_interval';

COMMIT;
