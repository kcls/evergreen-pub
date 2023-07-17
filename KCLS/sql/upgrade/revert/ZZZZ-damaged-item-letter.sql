-- Deploy kcls-evergreen:0024-damaged-item-letter to pg
-- requires: 0023-on-order-call-numbers

BEGIN;

DELETE FROM config.print_template WHERE name = 'damaged_item_letter';

COMMIT;
