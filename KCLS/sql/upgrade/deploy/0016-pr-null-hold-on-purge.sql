-- Deploy kcls-evergreen:XXXX-pr-null-hold-on-purge to pg
-- requires: 0013-refund-summary-letter

BEGIN;

ALTER TABLE actor.usr_item_request
    DROP CONSTRAINT usr_item_request_hold_fkey,
    ADD CONSTRAINT usr_item_request_hold_fkey 
        FOREIGN KEY (hold) REFERENCES action.hold_request(id) ON DELETE SET NULL;

ALTER TABLE actor.usr_item_request ADD COLUMN hold_date TIMESTAMPTZ;

-- Set the hold_date from known data.
UPDATE actor.usr_item_request AS req
SET hold_date = ahr.request_time
FROM action.hold_request ahr
WHERE ahr.id = req.hold;

COMMIT;
