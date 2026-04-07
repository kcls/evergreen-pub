
BEGIN;

CREATE INDEX staging_user_first_given_name_idx ON staging.user_stage (LOWER(first_given_name));
CREATE INDEX staging_user_second_given_name_idx ON staging.user_stage (LOWER(second_given_name));
CREATE INDEX staging_user_family_name_idx ON staging.user_stage (LOWER(family_name));

CREATE INDEX staging_user_first_given_name_squashed_idx 
    ON staging.user_stage (evergreen.unaccent_and_squash(first_given_name));
CREATE INDEX staging_user_second_given_name_squashed_idx 
    ON staging.user_stage (evergreen.unaccent_and_squash(second_given_name));
CREATE INDEX staging_user_family_name_squashed_idx 
    ON staging.user_stage (evergreen.unaccent_and_squash(family_name));

CREATE INDEX staging_user_email_idx ON staging.user_stage (LOWER(email));
CREATE INDEX staging_user_day_phone_idx ON staging.user_stage (day_phone);

COMMIT;


