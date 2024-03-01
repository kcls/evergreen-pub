-- Revert kcls-evergreen:ZZZZ-float-balancing from pg

BEGIN;

DROP FUNCTION IF EXISTS kcls.float_members;

DROP FUNCTION IF EXISTS kcls.float_target_has_bib_slot(INTEGER, TEXT, INTEGER);
DROP MATERIALIZED VIEW IF EXISTS kcls.float_target_counts;

DROP VIEW IF EXISTS kcls.float_balanced_items;
DROP VIEW IF EXISTS kcls.on_shelf_float_balanced_items;
DROP VIEW IF EXISTS kcls.in_transit_float_balanced_items;

DROP TABLE IF EXISTS config.org_unit_float_policy;

COMMIT;
