-- Deploy kcls-evergreen:XXXX-invoice-entry-needs-attention to pg
-- requires: 0021-refund-payment-approval-code

BEGIN;

ALTER TABLE acq.invoice_entry
    ADD COLUMN needs_attention BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
