-- Revert kcls-evergreen:ZZZZ-float-balancing from pg

BEGIN;

DROP FUNCTION IF EXISTS evergreen.float_members;

DROP FUNCTION IF EXISTS evergreen.float_target_has_bib_slot(INTEGER, TEXT, INTEGER);
DROP MATERIALIZED VIEW IF EXISTS evergreen.float_target_counts;
DROP VIEW IF EXISTS evergreen.on_shelf_float_balanced_items;

DROP TABLE IF EXISTS config.org_unit_float_policy;

COMMIT;
