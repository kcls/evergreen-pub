-- Revert kcls-evergreen:XXXX-invoice-entry-needs-attention from pg

BEGIN;

ALTER TABLE acq.invoice_entry DROP COLUMN needs_attention;

COMMIT;
