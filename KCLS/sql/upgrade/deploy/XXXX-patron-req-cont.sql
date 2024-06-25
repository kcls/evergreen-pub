-- Deploy kcls-evergreen:XXXX-patron-req-cont to pg
-- requires: 0004-damaged-item-letter

BEGIN;

ALTER TABLE actor.usr_item_request
    ADD COLUMN ill_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN id_matched BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN patron_notes TEXT
;

COMMIT;
