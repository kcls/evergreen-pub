-- Revert kcls-evergreen:XXXX-patron-req-cont from pg

BEGIN;

ALTER TABLE actor.usr_item_request
    DROP COLUMN ill_opt_out,
    DROP COLUMN id_matched,
    DROP COLUMN patron_notes
;

COMMIT;
