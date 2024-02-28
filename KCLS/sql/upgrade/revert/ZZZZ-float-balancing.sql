-- Revert kcls-evergreen:ZZZZ-float-balancing from pg

BEGIN;

DROP FUNCTION IF EXISTS evergreen.float_members;

DROP VIEW IF EXISTS evergreen.float_target_location_counts;
DROP MATERIALIZED VIEW IF EXISTS evergreen.float_target_counts;

DROP TABLE IF EXISTS config.org_unit_float_policy;

COMMIT;
