-- Return the lineitems on five cancelled-then-restored POs to on-order,
-- clear the lineitem_detail cancel reasons, and create/link encumbrance
-- fund debits per detail (amount = lineitem.estimated_unit_price).
--
-- POs: 147447, 147507, 147576, 147578, 147589
-- Run with: psql -U evergreen -h localhost -f po-uncancel.sql

BEGIN;

-- 1. Return the lineitems on these POs to on-order.
--    NOTE: also clears lineitem.cancel_reason -- an on-order lineitem
--    with a lingering cancel_reason is inconsistent.  Remove that line
--    if you want it left in place.
UPDATE acq.lineitem
   SET state = 'on-order',
       cancel_reason = NULL,
       edit_time = NOW()
 WHERE purchase_order IN (147447, 147507, 147576, 147578, 147589);

-- 2. Clear the cancel reason on the affected lineitem details.
UPDATE acq.lineitem_detail lid
   SET cancel_reason = NULL
  FROM acq.lineitem li
 WHERE li.id = lid.lineitem
   AND li.purchase_order IN (147447, 147507, 147576, 147578, 147589);

-- 3. Create one encumbrance fund_debit per lineitem_detail, amount =
--    the lineitem's estimated_unit_price, and link it via
--    lineitem_detail.fund_debit.  Loop so each new debit id can be
--    paired with its source detail row.  The fund_debit IS NULL guard
--    makes this safe to re-run.
DO $$
DECLARE
    rec RECORD;
    new_debit INT;
BEGIN
    FOR rec IN
        SELECT lid.id AS lid_id,
               lid.fund,
               li.estimated_unit_price AS price,
               f.currency_type
          FROM acq.lineitem_detail lid
          JOIN acq.lineitem li ON li.id = lid.lineitem
          JOIN acq.fund f ON f.id = lid.fund
         WHERE li.purchase_order IN (147447, 147507, 147576, 147578, 147589)
           AND lid.fund_debit IS NULL
    LOOP
        INSERT INTO acq.fund_debit
            (fund, origin_amount, origin_currency_type,
                amount, encumbrance, debit_type)
        VALUES
            (rec.fund, rec.price, rec.currency_type,
                rec.price, TRUE, 'purchase')
        RETURNING id INTO new_debit;

        UPDATE acq.lineitem_detail
           SET fund_debit = new_debit
         WHERE id = rec.lid_id;
    END LOOP;
END $$;

COMMIT;

-- Verification: expect li_on_order/details counts per PO, zero
-- details_still_cancelled, details_with_debit = details, and sane
-- encumbrance totals.
SELECT li.purchase_order AS po,
       count(*) FILTER (WHERE li.state = 'on-order') AS li_on_order,
       count(lid.cancel_reason) AS details_still_cancelled,
       count(lid.fund_debit) AS details_with_debit,
       sum(fd.amount) AS total_encumbered
  FROM acq.lineitem li
  JOIN acq.lineitem_detail lid ON lid.lineitem = li.id
  LEFT JOIN acq.fund_debit fd ON fd.id = lid.fund_debit
 WHERE li.purchase_order IN (147447, 147507, 147576, 147578, 147589)
 GROUP BY 1 ORDER BY 1;
