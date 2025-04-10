-- Revert kcls-evergreen:XXXX-pr-formats from pg

BEGIN;

ALTER TABLE actor.usr_item_request DROP CONSTRAINT actor_usr_item_request_format_fkey;
ALTER TABLE actor.usr_item_request DROP CONSTRAINT actor_usr_item_request_audience_fkey;

DROP TABLE config.usr_item_request_format;
DROP TABLE config.usr_item_request_audience;

COMMIT;
