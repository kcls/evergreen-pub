-- Deploy kcls-evergreen:xxx-lineitem-street-dates to pg
-- requires: 0024-collection-hq-refresh

BEGIN;

-- protection for inserting data into a running DB vs. initial build
DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN

INSERT INTO acq.lineitem_attr_definition (code, description)
	VALUES ('street_date', 'Vendor street date');

END IF; END $INSERT$;

COMMIT;
