-- Revert kcls-evergreen:ZZZZ-float-balancing from pg

BEGIN;

UPDATE asset.copy SET floating = NULL
WHERE floating = (SELECT id FROM config.floating_group WHERE name = 'Everywhere Balanced');

DELETE FROM config.floating_group_member WHERE floating_group = 
    (SELECT id FROM config.floating_group WHERE name = 'Everywhere Balanced');

DELETE FROM config.floating_group WHERE name = 'Everywhere Balanced';

DROP FUNCTION IF EXISTS kcls.float_members;
DROP FUNCTION IF EXISTS kcls.float_target_has_bib_slot(INTEGER, TEXT, INTEGER);
DROP FUNCTION IF EXISTS kcls.float_copy_slots(INTEGER, INTEGER);

DROP MATERIALIZED VIEW IF EXISTS kcls.float_target_counts;

DROP VIEW IF EXISTS kcls.all_shelf_items;
DROP VIEW IF EXISTS kcls.on_shelf_items;
DROP VIEW IF EXISTS kcls.in_transit_to_shelf_items;

DROP TABLE IF EXISTS config.org_unit_float_policy;

COMMIT;
