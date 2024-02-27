-- Deploy kcls-evergreen:ZZZZ-float-balancing to pg
-- requires: YYYY-patron-requests

BEGIN;

-- Policies are linked directly to org units, not
-- config.floating_group_member entries, on the assumption that an org
-- unit wants "X items per copy location" or "X max copies per bib per
-- copy location" regardless of the floating group at play.
-- TODO verify max bibs makes sense or if it should be org unit global.
CREATE TABLE config.org_unit_float_policy (
    id              SERIAL PRIMARY KEY,
    active          BOOL NOT NULL DEFAULT FALSE,
    org_unit        INT NOT NULL REFERENCE actor.org_unit(id)
                    DEFERRABLE INITIALLY DEFERRED ON DELETE CASCADE,
    max_same_bib    INT,
    copy_location   INT,
    items_allowed   INT,
    CONSTRAINT      one_loc_per_orgc UNIQUE(org_unit, copy_location)
    CONSTRAINT      needs_some_rules CHECK (
        max_same_bib IS NOT NULL OR (
            copy_location IS NOT NULL AND items_allowed IS NOT NULL
        )
    )
);

CREATE OR REPLACE FUNCTION evergreen.float_members(
	floating_group INTEGER,
	from_ou INTEGER,
	to_ou INTEGER
) RETURNS SETOF INTEGER AS $FUNK$
DECLARE
    float_member config.floating_group_member%ROWTYPE;
    shared_ou_depth INT;
    to_ou_depth INT;
BEGIN
    -- Returns the set of org units that are covered by the 
    -- floating group member configuration.
    -- 
    -- MOST OF THIS IS LIFTED DIRECTLY (minus formatting) FROM evergreen.can_float()	

    -- Grab the shared OU depth. 
    -- If this is less than the stop depth later we ignore the entry.
    SELECT INTO shared_ou_depth max(depth) 
    FROM actor.org_unit_common_ancestors(from_ou, to_ou) aou 
    JOIN actor.org_unit_type aout ON aou.ou_type = aout.id;

    -- Grab the to ou depth. 
    -- If this is greater than max depth we ignore the entry.
    SELECT INTO to_ou_depth depth 
    FROM actor.org_unit aou 
    JOIN actor.org_unit_type aout ON aou.ou_type = aout.id 
    WHERE aou.id = to_ou;

    -- Grab float members that apply and exit early if we hit an EXCLUDE entry.
    FOR float_member IN SELECT *
        FROM
            config.floating_group_member cfgm
            JOIN actor.org_unit aou ON cfgm.org_unit = aou.id
            JOIN actor.org_unit_type aout ON aou.ou_type = aout.id
        WHERE
            cfgm.floating_group = floating_group
            AND to_ou IN (SELECT id FROM actor.org_unit_descendants(aou.id))
            AND cfgm.stop_depth <= shared_ou_depth
            AND (cfgm.max_depth IS NULL OR to_ou_depth <= max_depth)
        ORDER BY
            exclude DESC 
    LOOP
        -- Exit with nothing if we encountered an EXCLUDE rule.
        -- If this happens, it will happen on the first row (ORDER BY).
        IF float_member.exclude THEN
            RETURN;
        END IF;

        RETURN NEXT floating_member.org_unit;
    END LOOP;
END;
$FUNK$ LANGUAGE PLPGSQL;

COMMIT;

