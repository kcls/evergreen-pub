-- Deploy kcls-evergreen:YYYY-refund-xact-dibs to pg
-- requires: 0004-damaged-item-letter

BEGIN;

DROP VIEW IF EXISTS money.eligible_refundable_xact;
DROP VIEW IF EXISTS money.refundable_xact_summary;

ALTER TABLE money.refundable_xact ADD COLUMN dibs TEXT;


CREATE VIEW money.refundable_xact_summary AS
 SELECT xact.id,
    xact.xact,
    xact.item_price,
    xact.refund_amount,
    xact.notes,
    xact.usr_first_name,
    xact.usr_middle_name,
    xact.usr_family_name,
    xact.usr_barcode,
    xact.usr_street1,
    xact.usr_street2,
    xact.usr_city,
    xact.usr_state,
    xact.usr_post_code,
    xact.approve_date,
    xact.approved_by,
    xact.reject_date,
    xact.rejected_by,
    xact.pause_date,
    xact.paused_by,
    xact.refund_session,
    xact.erp_export_date,
    acp.id AS copy,
    acp.barcode AS copy_barcode,
    acn.label AS call_number,
        CASE
            WHEN (acn.id = '-1'::integer) THEN acp.dummy_title
            ELSE rsr.title
        END AS title,
    circ.usr,
    circ.xact_start,
    circ.xact_finish,
    summary.total_owed,
    summary.balance_owed,
    (refundable_paid.amount)::numeric(8,2) AS refundable_paid,
    (total_paid.amount)::numeric(8,2) AS total_paid,
    (total_refunded.amount)::numeric(8,2) AS total_refunded,
    refundable_payment_count.count AS num_refundable_payments,
    xact.dibs
   FROM (((((((((money.refundable_xact xact
     JOIN action.circulation circ ON ((circ.id = xact.xact)))
     JOIN asset.copy acp ON ((acp.id = circ.target_copy)))
     JOIN asset.call_number acn ON ((acn.id = acp.call_number)))
     JOIN reporter.materialized_simple_record rsr ON ((rsr.id = acn.record)))
     JOIN money.materialized_billable_xact_summary summary ON ((summary.id = xact.xact)))
     JOIN ( SELECT pay.xact,
            sum(pay.amount) AS amount
           FROM money.payment pay
          WHERE (pay.amount > (0)::numeric)
          GROUP BY pay.xact) total_paid ON ((total_paid.xact = xact.xact)))
     JOIN ( SELECT mrp.refundable_xact,
            sum(pay.amount) AS amount
           FROM (money.refundable_payment mrp
             JOIN money.payment pay ON ((mrp.payment = pay.id)))
          GROUP BY mrp.refundable_xact) refundable_paid ON ((refundable_paid.refundable_xact = xact.id)))
     LEFT JOIN ( SELECT pay.xact,
            (- sum(pay.amount)) AS amount
           FROM money.cash_payment pay
          WHERE (pay.amount < (0)::numeric)
          GROUP BY pay.xact) total_refunded ON ((total_refunded.xact = xact.xact)))
     JOIN ( SELECT count(*) AS count,
            mrp.refundable_xact
           FROM money.refundable_payment mrp
          GROUP BY mrp.refundable_xact) refundable_payment_count ON ((refundable_payment_count.refundable_xact = xact.id)));

COMMIT;
