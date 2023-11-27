-- Deploy kcls-evergreen:XXXX-pr-audience to pg
-- requires: 0013-refund-summary-letter

BEGIN;

ALTER TABLE actor.usr_item_request ADD COLUMN audience TEXT;

COMMIT;

