-- Revert kcls-evergreen:XXXX-invoice-ready-for-payment from pg

BEGIN;

ALTER TABLE acq.invoice
    DROP COLUMN ready_for_payment_at,
    DROP COLUMN ready_for_payment_by;

COMMIT;
