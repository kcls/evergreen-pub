-- Revert kcls-evergreen:XXXX-hold-max-expire from pg

BEGIN;

DELETE FROM config.org_unit_setting_type_log WHERE name = 'circ.holds.max_expire_interval';
DELETE FROM actor.org_unit_setting WHERE name = 'circ.holds.max_expire_interval';
DELETE FROM config.org_unit_setting_type WHERE name = 'circ.holds.max_expire_interval';

COMMIT;
