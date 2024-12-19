-- Deploy kcls-evergreen:XXXX-metabib-browse-cache-fix to pg
-- requires: 0007-patron-req-cont

BEGIN;

CREATE OR REPLACE FUNCTION metabib.maintain_browse_metabib_fields_cache() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    entry_id BIGINT;
    keep_entry BOOLEAN;
BEGIN

    SELECT INTO entry_id
        CASE WHEN TG_OP = 'DELETE' THEN OLD.entry ELSE NEW.entry END;
    
    -- distinct list of config.metabib_field IDs which link 
    -- to a given metabib.browse_entry via bib or auth maps.
    UPDATE metabib.browse_entry
    SET metabib_fields_cache = ARRAY(
        SELECT DISTINCT(x.def_id) FROM (
            SELECT mbedm.def AS def_id
                FROM metabib.browse_entry_def_map mbedm
                WHERE mbedm.entry = entry_id
            UNION
            SELECT map.metabib_field AS def_id
                FROM metabib.browse_entry_simple_heading_map mbeshm
                JOIN authority.simple_heading ash ON (mbeshm.simple_heading = ash.id)
                JOIN authority.control_set_auth_field_metabib_field_map_refs map
                    ON (ash.atag = map.authority_field)
                WHERE mbeshm.entry = entry_id
        )x
    )
    WHERE id = entry_id;

    -- While we're here, remove orphaned browse entries
    -- At this point, browse entries mapped to the deleted bibs/auths
    -- have already been removed.
    IF TG_OP = 'DELETE' THEN

        -- start with a faster query to see if any fields are known
        -- reference the browse entry we're potentially removing.
        PERFORM TRUE FROM metabib.browse_entry
        WHERE id = entry_id AND ARRAY_LENGTH(metabib_fields_cache, 1) > 0;
        
        IF NOT FOUND THEN
            -- If no obvious links are found, check for specific map
            -- entries. These can exist e.g. if an authority field does 
            -- link to a bib field and thus config.metabib_field.
            SELECT INTO keep_entry EXISTS (
                SELECT TRUE FROM metabib.browse_entry_def_map WHERE entry = entry_id
                UNION
                SELECT TRUE FROM metabib.browse_entry_simple_heading_map WHERE entry = entry_id
            );
            IF NOT keep_entry THEN
                DELETE FROM metabib.browse_entry WHERE id = entry_id;
            END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$;

COMMIT;
