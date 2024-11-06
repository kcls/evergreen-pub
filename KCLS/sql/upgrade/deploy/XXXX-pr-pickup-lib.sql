-- Deploy kcls-evergreen:XXXX-pr-pickup-lib to pg
-- requires: 0007-patron-req-cont

BEGIN;

ALTER TABLE actor.usr_item_request
    ADD COLUMN pickup_lib INTEGER REFERENCES actor.org_unit(id);

COMMIT;
