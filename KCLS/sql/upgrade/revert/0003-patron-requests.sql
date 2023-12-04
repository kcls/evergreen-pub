-- Revert kcls-evergreen:YYYY-patron-requests from pg

BEGIN;

DROP TABLE IF EXISTS actor.usr_item_request;
DROP TYPE IF EXISTS actor.usr_item_request_route;

COMMIT;
