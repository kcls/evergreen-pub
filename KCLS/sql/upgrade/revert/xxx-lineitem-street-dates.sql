-- Revert kcls-evergreen:xxx-lineitem-street-dates from pg

BEGIN;

DELETE FROM acq.lineitem_attr_definition WHERE code = 'street_date';

COMMIT;
