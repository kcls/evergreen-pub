-- Revert kcls-evergreen:XXXX-sip-filters from pg

BEGIN;

DROP TABLE IF EXISTS sip.filter;

COMMIT;
