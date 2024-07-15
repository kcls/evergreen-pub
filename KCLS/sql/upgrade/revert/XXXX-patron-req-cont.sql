-- Revert kcls-evergreen:XXXX-patron-req-cont from pg

BEGIN;

DELETE FROM permission.perm_list WHERE code = 'CREATE_USER_ITEM_REQUEST';

DELETE FROM config.org_unit_setting_type_log WHERE name = 'patron_requests.max_active';
DELETE FROM actor.org_unit_setting WHERE name = 'patron_requests.max_active';
DELETE FROM config.org_unit_setting_type WHERE name = 'patron_requests.max_active';

ALTER TABLE actor.usr_item_request
    DROP COLUMN ill_opt_out,
    DROP COLUMN id_matched,
    DROP COLUMN patron_notes
;

COMMIT;
