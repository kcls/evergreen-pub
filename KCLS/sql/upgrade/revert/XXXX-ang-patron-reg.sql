-- Revert kcls-evergreen:XXXX-ang-patron-reg from pg

BEGIN;

DROP TABLE actor.org_unit_coords;

COMMIT;
