-- Deploy kcls-evergreen:0027-tote-checkin-sip-configs to pg
-- requires: 0026-sip-sorter-configs

BEGIN;

INSERT INTO sip.setting_group (label, institution) VALUES ('KCLS Tote Checkin', 'kcls');

-- Copy existing settings from 'KCLS' group
INSERT INTO sip.setting (setting_group, name, description, value)
  SELECT
    (SELECT id FROM sip.setting_group WHERE label = 'KCLS Tote Checkin'),
    name,
    description,
    value
  FROM sip.setting WHERE setting_group = 1001;

INSERT INTO sip.setting (setting_group, name, description, value)
  VALUES (
    (SELECT id FROM sip.setting_group WHERE label = 'KCLS Tote Checkin'),
    'checkin_block_on_checked_out',
    'Blocks checkin for checked out items',
    'true'
  );

-- These accounts were previously linked to setting_group id 1001
UPDATE sip.account
  SET setting_group = (SELECT id FROM sip.setting_group WHERE label = 'KCLS Tote Checkin')
  WHERE sip_username LIKE 'tote%';

COMMIT;
