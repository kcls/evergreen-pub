-- Deploy kcls-evergreen:0034-bib-915d-record-attr to pg
-- requires: 0032-sms-opt-in-setting-group

BEGIN;

-- Extracts the first YYYY-MM-DD style date from a string and returns it
-- in hyphenated form, or NULL when no valid date is present.
--
-- Values arriving from metabib.full_rec have already been through
-- naco_normalize (see vandelay.flatten_marc), which replaces the hyphens
-- with spaces, so the separator is matched loosely.
CREATE OR REPLACE FUNCTION public.iso_date_normalizer(TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE STRICT
AS $function$
DECLARE
    m TEXT[] := regexp_match($1, '(\d{4})[ -]?(\d{2})[ -]?(\d{2})');
BEGIN
    IF m IS NULL THEN
        RETURN NULL;
    END IF;

    -- Raises on an impossible date (month 13, Feb 30, year 0000, ...)
    -- so consumers can safely cast the result to a date.
    PERFORM make_date(m[1]::INT, m[2]::INT, m[3]::INT);

    RETURN m[1] || '-' || m[2] || '-' || m[3];
EXCEPTION WHEN datetime_field_overflow THEN
    RETURN NULL;
END;
$function$;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN

    INSERT INTO config.index_normalizer (name, description, func)
        VALUES ('ISO Date', 'ISO Date Normalizer', 'iso_date_normalizer');

    INSERT INTO config.record_attr_definition
        (name, label, tag, sf_list, filter, sorter, multi, composite)
        VALUES ('marc_915d', '915d Date', '915', 'd', TRUE, FALSE, FALSE, FALSE);

    INSERT INTO config.record_attr_index_norm_map (attr, norm)
        VALUES (
            'marc_915d',
            (SELECT id FROM config.index_normalizer WHERE func = 'iso_date_normalizer')
        );

END IF; END $INSERT$;

COMMIT;
