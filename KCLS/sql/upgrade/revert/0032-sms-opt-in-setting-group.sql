-- Revert kcls-evergreen:0032-sms-opt-in-setting-group from pg

BEGIN;

INSERT INTO config.settings_group (name, label) VALUES ('notify.text', 'Text Notices TMP');
UPDATE config.usr_setting_type SET grp = 'notify.text' WHERE grp = 'notify.sms';
DELETE FROM config.settings_group WHERE name = 'notify.sms';
UPDATE config.settings_group SET label = 'Text Notices' WHERE name = 'notify.text';

COMMIT;
