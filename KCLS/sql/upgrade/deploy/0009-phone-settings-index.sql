-- Deploy kcls-evergreen:0009-phone-settings-index to pg
-- requires: 0008-pr-pickup-lib

BEGIN;

CREATE INDEX actor_usr_setting_phone_values_idx
    ON actor.usr_setting (evergreen.lowercase(value))
    WHERE name IN ('opac.default_phone', 'opac.default_sms_notify');

CREATE INDEX actor_usr_setting_phone_values_numeric_idx
    ON actor.usr_setting (evergreen.lowercase(REGEXP_REPLACE(value, '[^0-9]', '', 'g')))
    WHERE name IN ('opac.default_phone', 'opac.default_sms_notify');

COMMIT;
