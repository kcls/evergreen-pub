-- Revert kcls-evergreen:XXXX-pr-null-hold-on-purge from pg

BEGIN;

ALTER TABLE actor.usr_item_request
    DROP CONSTRAINT usr_item_request_hold_fkey,
    ADD CONSTRAINT usr_item_request_hold_fkey 
        FOREIGN KEY (hold) REFERENCES action.hold_request(id);

COMMIT;
