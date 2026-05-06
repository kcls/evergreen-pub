-- Revert kcls-evergreen:0027-tote-checkin-sip-configs from pg

BEGIN;

UPDATE sip.account
  SET setting_group = 1001
  WHERE setting_group = (SELECT id FROM sip.setting_group WHERE label = 'KCLS Tote Checkin');

DELETE FROM sip.setting
  WHERE setting_group = (SELECT id FROM sip.setting_group WHERE label = 'KCLS Tote Checkin');

DELETE FROM sip.setting_group WHERE label = 'KCLS Tote Checkin';

COMMIT;
