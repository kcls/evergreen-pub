-- Revert kcls-evergreen:XXXX-phone-search-indexes from pg

BEGIN;

DROP INDEX actor.actor_usr_setting_phone_values_idx;
DROP INDEX actor.actor_usr_setting_phone_values_numeric_idx;

COMMIT;
