-- Deploy kcls-evergreen:XXXX-ang-patron-reg to pg
-- requires: 0004-damaged-item-letter

BEGIN;

-- Repair these notices and make the opac_visible so they appear
-- in the angular patron register UI.

UPDATE config.usr_setting_type 
    SET opac_visible = TRUE, datatype = 'bool' WHERE name ~ '^notification.';

COMMIT;
