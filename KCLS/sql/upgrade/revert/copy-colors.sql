-- Revert kcls-evergreen:copy-colors from pg

BEGIN;

ALTER TABLE asset.copy DROP COLUMN color;

DROP TABLE config.copy_color;

COMMIT;
