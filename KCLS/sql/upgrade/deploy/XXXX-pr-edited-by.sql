-- Deploy kcls-evergreen:XXXX-pr-edited-by to pg
-- requires: 0019-pr-filters

BEGIN;

ALTER TABLE actor.usr_item_request
    ADD COLUMN edited_by INTEGER REFERENCES actor.usr(id),
    ADD COLUMN edit_date TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- default to setting the user who created the request as the last editor.
UPDATE actor.usr_item_request SET edited_by = usr;

ALTER TABLE actor.usr_item_request 
    ALTER COLUMN edited_by SET NOT NULL;

COMMIT;
