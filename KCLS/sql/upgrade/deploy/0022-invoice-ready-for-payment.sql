-- Deploy kcls-evergreen:XXXX-invoice-ready-for-payment to pg

BEGIN;

ALTER TABLE acq.invoice
    ADD COLUMN ready_for_payment_at TIMESTAMPTZ,
    ADD COLUMN ready_for_payment_by INTEGER REFERENCES actor.usr(id);

COMMIT;
