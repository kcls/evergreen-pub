-- Revert kcls-evergreen:0026-sip-sorter-configs from pg

BEGIN;

DELETE FROM actor.workstation WHERE name IN (
	'OK-sorter-01',
	'OK-sorter-02',
	'OK-sorter-03',
	'OK-sorter-04',
	'OK-sorter-05',
	'OK-sorter-06'
);

DELETE FROM sip.setting WHERE setting_group = 
	(SELECT id FROM sip.setting_group WHERE label = 'KCLS Central Sorter');

DELETE FROM sip.setting_group WHERE label = 'KCLS Central Sorter';

DELETE FROM actor.org_unit_setting WHERE org_unit = 
	(SELECT id FROM actor.org_unit WHERE shortname = 'OK');

DELETE FROM config.org_unit_setting_type_log WHERE org = 
	(SELECT id FROM actor.org_unit WHERE shortname = 'OK');

DELETE FROM actor.org_unit WHERE shortname = 'OK';

COMMIT;
