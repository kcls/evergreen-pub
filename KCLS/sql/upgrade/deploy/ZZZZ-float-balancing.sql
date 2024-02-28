-- Deploy kcls-evergreen:ZZZZ-float-balancing to pg
-- requires: YYYY-patron-requests

BEGIN;

CREATE TABLE config.org_unit_float_policy (
    -- Policies are linked directly to org units, not
    -- config.floating_group_member entries, on the assumption that an org
    -- unit wants "X items per copy location" or "X max copies per bib per
    -- copy location" regardless of the floating group at play.

    id              SERIAL PRIMARY KEY,
    active          BOOL NOT NULL DEFAULT FALSE,
    org_unit        INT NOT NULL REFERENCES actor.org_unit(id)
                    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    max_per_bib     INT,
    copy_location   INT NOT NULL,
    max_items       INT, 
    CONSTRAINT      one_loc_per_orgc UNIQUE(org_unit, copy_location),
    CONSTRAINT      needs_some_rules CHECK 
                        (max_per_bib IS NOT NULL OR max_items IS NOT NULL)
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



CREATE MATERIALIZED VIEW evergreen.float_target_counts AS 
    SELECT 
        COUNT(acp.id) AS bib_slots_filled,
        acn.record AS bib_record,
        acp.circ_lib AS circ_lib,
        acp.location AS copy_location,
        acpl.name AS copy_location_name,
        coufp.max_items AS location_slots,
        coufp.max_per_bib AS bib_slots
    FROM asset.copy acp
    JOIN asset.call_number acn ON acn.id = acp.call_number
    JOIN config.copy_status ccs ON ccs.id = acp.status
    JOIN asset.copy_location acpl ON acpl.id = acp.location
    JOIN config.org_unit_float_policy coufp ON (
        coufp.org_unit = acp.circ_lib 
        AND coufp.copy_location = acp.location
    )
    WHERE 
        NOT acp.deleted
        AND NOT acn.deleted
        AND acp.call_number > 0
        AND acn.record > 0
        AND ccs.is_available
        AND coufp.active
    GROUP BY 2, 3, 4, 5, 6, 7
;

CREATE VIEW evergreen.float_target_location_counts AS 
    -- Count of copies per location among org units and copy
    -- locations where float policies apply.
    SELECT 
        SUM(ftbc.bib_slots_filled) AS location_slots_filled,
        ftbc.circ_lib,
        ftbc.copy_location,
        ftbc.copy_location_name,
        ftbc.location_slots,
    FROM evergreen.float_target_bib_counts ftbc
    GROUP BY 2, 3, 4, 5
;


CREATE OR REPLACE FUNCTION evergreen.float_destination(
    copy_id INTEGER,
	to_ou INTEGER
) RETURNS INTEGER AS $FUNK$
DECLARE
    copy asset.copy%ROWTYPE;

    --- Float policy at the destination/checkin org unit.
    policy config.org_unit_float_policy%ROWTYPE,

    -- Org units within this copy's float member group.
    member_orgs: INTEGER[];

    target_bib: INTEGER;

    target_bib_counts: evergreen.float_target_bib_counts%ROWTYPE;

    target_location_counts: evergreen.float_target_location_counts%ROWTYPE;

    -- KCLS matches copy location by their code names since each branch
    -- maintains its own version of (practically) every copy location, 
    -- i.e. locations are not shared by the consortium.
    copy_location_code TEXT;
BEGIN

    SELECT INTO copy * FROM asset.copy WHERE id = copy_id;

    IF copy.floating IS NULL THEN
        -- This copy doesn't float.
        RETURN copy.circ_lib;
    END IF;

    SELECT INTO member_orgs ARRAY(
        FROM evergreen.float_members(copy.floating, copy.circ_lib, to_ou));

    IF ARRAY_LENGTH(member_orgs) = 0 THEN
        -- Likely excluded from floating in this group.
        RETURN copy.circ_lib;
    END IF;

    SELECT INTO copy_location_code name FROM asset.copy_location WHERE id = copy.location;

    SELECT INTO target_bib acn.record 
        FROM asset.copy acp
        JOIN asset.call_number acn ON acn.id = acp.location
        WHERE acp.id = copy_id;

    -- Float to the destination (checkin) branch if possible.

    -- Have we exceeded the bib target count at the destination?
    PERFORM TRUE
        FROM evergreen.float_target_bib_counts ftbc
        WHERE ftbc.circ_lib = to_ou
            AND ftbc.bib_record = target_record
            AND ftbc.copy_location_name = copy_location_code -- KCLS
            AND ftbc.bib_slots_filled < ftbc.bib_slots;

    IF FOUND THEN
        -- We have not exceeded the bib slots at the target destination.
        -- Have we exceeded the copy location slots?
        PERFORM TRUE 
            FROM evergreen.float_target_location_counts ftlc
            WHERE ftlc.circ_lib = to_ou
                AND ftlc.copy_location_name = copy_location_code -- KCLS
                AND ftlc.location_slots_filled < ftlc.location_slots;

        IF FOUND THEN
            -- We have room at the destination/checkin branch.  Float to it.
            RETURN to_ou;
        END IF;
    END IF;

    -- No room at the inn... Find the best float target.

END;
$FUNK$ LANGUAGE PLPGSQL;


------------------------------------------------------------------------------
-- make some sample data
INSERT INTO config.org_unit_float_policy 
    (active, org_unit, max_per_bib, copy_location, max_items)
SELECT TRUE, aou.id, 2, acpl.id, 10
FROM actor.org_unit aou
JOIN asset.copy_location acpl ON acpl.owning_lib = aou.id;

REFRESH MATERIALIZED VIEW evergreen.float_target_bib_counts;

COMMIT;

