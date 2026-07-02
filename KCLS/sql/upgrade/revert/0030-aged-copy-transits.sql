BEGIN;

DROP FUNCTION IF EXISTS action.batch_age_copy_transits(INTERVAL, INTEGER);
DROP FUNCTION IF EXISTS action.age_copy_transit(INTEGER);
DROP TABLE IF EXISTS action.aged_copy_transit;

COMMIT;
