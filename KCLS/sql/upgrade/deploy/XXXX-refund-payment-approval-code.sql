-- Deploy kcls-evergreen:refund-payment-approval-code to pg
-- requires: 0019-pr-filters

BEGIN;

CREATE OR REPLACE VIEW money.refundable_payment_summary AS
 SELECT mrp.id,
    mrp.refundable_xact,
    mrp.payment,
    mrp.payment_ou,
    mrp.final_payment,
    mrp.receipt_number,
    mrp.refunded_via,
    mrp.staff_name,
    mrp.staff_email,
    aou.shortname || lpad(mrp.receipt_number::text, 6, '0'::text) AS receipt_code,
    pay.payment_ts AS payment_time,
    pay.amount,
    pay.payment_type,
    aws.name AS workstation,
    ccp.cc_order_number,
    ccp.cc_processor,
	ccp.approval_code
   FROM money.refundable_payment mrp
     JOIN money.payment_view pay ON pay.id = mrp.payment
     JOIN actor.org_unit aou ON aou.id = mrp.payment_ou
     LEFT JOIN money.cash_payment cash ON cash.id = pay.id
     LEFT JOIN actor.workstation aws ON aws.id = cash.cash_drawer
     LEFT JOIN money.credit_card_payment ccp ON ccp.id = pay.id;


COMMIT;
