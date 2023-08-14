-- Revert kcls-evergreen:0025-refund-summary-letter from pg

BEGIN;

DELETE FROM config.print_template WHERE name = 'refund_summary';

COMMIT;

