-- Deploy kcls-evergreen:0032-sms-opt-in-setting-group to pg
-- requires: 0031-ang-patron-reg

BEGIN;

INSERT INTO config.settings_group (name, label) VALUES ('notify.sms', 'Text Notices TMP');

UPDATE config.usr_setting_type SET grp = 'notify.sms' WHERE grp = 'notify.text';

DELETE FROM config.settings_group WHERE name = 'notify.text';

UPDATE config.settings_group SET label = 'Text Notices' WHERE name = 'notify.sms';

COMMIT;

