BEGIN;

DROP PROCEDURE IF EXISTS action.age_copy_transits(INTERVAL, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS action.age_copy_transit_group(INTEGER);
DROP TABLE IF EXISTS action.aged_copy_transit;

COMMIT;
