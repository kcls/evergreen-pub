
BEGIN;

ALTER TABLE staging.user_stage ADD COLUMN keywords_tsvector TSVECTOR;

CREATE OR REPLACE FUNCTION staging.user_ingest_name_keywords()
 RETURNS TRIGGER
 LANGUAGE PLPGSQL
AS $FUNK$
BEGIN
    NEW.keywords_tsvector := TO_TSVECTOR(
		COALESCE(NEW.email, '') || ' ' ||
		COALESCE(NEW.first_given_name, '') || ' ' ||
		COALESCE(evergreen.unaccent_and_squash(NEW.first_given_name), '') || ' ' ||
		COALESCE(NEW.second_given_name, '') || ' ' ||
		COALESCE(evergreen.unaccent_and_squash(NEW.second_given_name), '') || ' ' ||
		COALESCE(NEW.family_name, '') || ' ' ||
		COALESCE(evergreen.unaccent_and_squash(NEW.family_name), '') || ' ' ||
		COALESCE(NEW.pref_first_given_name, '') || ' ' ||
		COALESCE(evergreen.unaccent_and_squash(NEW.pref_first_given_name), '') || ' ' ||
		COALESCE(NEW.pref_second_given_name, '') || ' ' ||
		COALESCE(evergreen.unaccent_and_squash(NEW.pref_second_given_name), '') || ' ' ||
		COALESCE(NEW.pref_family_name, '') || ' ' ||
		COALESCE(evergreen.unaccent_and_squash(NEW.pref_family_name), '') || ' ' ||
		COALESCE(NEW.day_phone, '') || ' ' ||
        COALESCE(REGEXP_REPLACE(NEW.day_phone, '[^\d]', '', 'g'), '') || ' ' ||
		COALESCE(NEW.evening_phone, '') || ' ' ||
        COALESCE(REGEXP_REPLACE(NEW.evening_phone, '[^\d]', '', 'g'), '')
    );
    RETURN NEW;
END;
$FUNK$;

CREATE TRIGGER user_ingest_name_keywords_tgr
    BEFORE INSERT OR UPDATE ON staging.user_stage
    FOR EACH ROW EXECUTE PROCEDURE staging.user_ingest_name_keywords();

-- Force the new trigger to run on every entry.
-- Assumes staging.user_stage is not huge.
UPDATE staging.user_stage SET usrname = usrname;

/*
ALTER TABLE staging.user_stage DROP TRIGGER user_ingest_name_keywords_tgr;
DROP FUNCTION IF EXISTS staging.user_ingest_name_keywords();
ALTER TABLE staging.user_stage DROP COLUMN keywords_tsvector;
*/

COMMIT;


