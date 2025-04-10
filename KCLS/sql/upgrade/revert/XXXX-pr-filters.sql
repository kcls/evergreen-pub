-- Revert kcls-evergreen:XXXX-pr-formats from pg

BEGIN;

DROP TABLE config.usr_item_request_format;

COMMIT;
