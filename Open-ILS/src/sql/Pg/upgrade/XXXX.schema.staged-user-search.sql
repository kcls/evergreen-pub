
BEGIN;

CREATE INDEX staging_user_first_given_name_idx ON staging.user_stage USING GIN (first_given_name gin_trgm_ops);
CREATE INDEX staging_user_second_given_name_idx ON staging.user_stage USING GIN (second_given_name gin_trgm_ops);
CREATE INDEX staging_user_family_name_idx ON staging.user_stage USING GIN (family_name gin_trgm_ops);

CREATE INDEX staging_user_first_given_name_squashed_idx
    ON staging.user_stage USING GIN (evergreen.unaccent_and_squash(first_given_name) gin_trgm_ops);
CREATE INDEX staging_user_second_given_name_squashed_idx
    ON staging.user_stage USING GIN (evergreen.unaccent_and_squash(second_given_name) gin_trgm_ops);
CREATE INDEX staging_user_family_name_squashed_idx
    ON staging.user_stage USING GIN (evergreen.unaccent_and_squash(family_name) gin_trgm_ops);

CREATE INDEX staging_user_email_idx ON staging.user_stage USING GIN (email gin_trgm_ops);
CREATE INDEX staging_user_day_phone_idx ON staging.user_stage USING GIN (day_phone gin_trgm_ops);

COMMIT;

/*
DROP INDEX IF EXISTS staging.staging_user_first_given_name_idx;
DROP INDEX IF EXISTS staging.staging_user_second_given_name_idx;
DROP INDEX IF EXISTS staging.staging_user_family_name_idx;
DROP INDEX IF EXISTS staging.staging_user_first_given_name_squashed_idx;
DROP INDEX IF EXISTS staging.staging_user_second_given_name_squashed_idx;
DROP INDEX IF EXISTS staging.staging_user_family_name_squashed_idx;
DROP INDEX IF EXISTS staging.staging_user_email_idx;
DROP INDEX IF EXISTS staging.staging_user_day_phone_idx;
*/
