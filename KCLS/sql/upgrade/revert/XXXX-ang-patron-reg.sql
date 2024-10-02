-- Revert kcls-evergreen:XXXX-ang-patron-reg from pg

BEGIN;

DROP TABLE config.usr_address_exception;

DROP TABLE config.district_of_residence;

DROP TABLE actor.org_unit_coords;

COMMIT;
