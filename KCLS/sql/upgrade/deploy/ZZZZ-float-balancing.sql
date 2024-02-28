-- Deploy kcls-evergreen:ZZZZ-float-balancing to pg
-- requires: YYYY-patron-requests

BEGIN;

CREATE TABLE config.org_unit_float_policy (
    -- Policies are linked directly to org units, not
    -- config.floating_group_member entries, on the assumption that an org
    -- unit wants a set number of items at a location regardless of
    -- the floating group at play.
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
END
$FUNK$ LANGUAGE PLPGSQL;

CREATE VIEW evergreen.on_shelf_float_balanced_items AS 
    -- All copies which live at a float-balanced shelf location and are
    -- in a status that suggests they are in fact on or en route to the
    -- shelf.
    SELECT 
        acp.*,
        acpl.name AS copy_location_code, -- KCLS
        coufp.id AS float_policy
    FROM asset.copy acp
    JOIN config.copy_status ccs ON ccs.id = acp.status
    JOIN asset.copy_location acpl ON acpl.id = acp.location
    JOIN config.org_unit_float_policy coufp ON (
        coufp.org_unit = acp.circ_lib 
        AND coufp.copy_location = acp.location
    )
    WHERE 
        NOT acp.deleted
        -- No pre-cats
        AND acp.call_number > 0
        -- Items that are on or en route to a shelf.  This may change.
        AND ccs.is_available
        AND coufp.active
;

-- We need a view for this data so we can sort on the slot
-- availability across the spectrum of branches.
CREATE MATERIALIZED VIEW evergreen.float_target_counts AS 
    -- Count of float-balanced items by circ lib and copy location.
    SELECT 
        COUNT(items.id) AS slots_filled,
        items.circ_lib,
        items.location,
        items.copy_location_code,
        policy.max_items,
        policy.max_per_bib
    FROM evergreen.on_shelf_float_balanced_items items
    JOIN config.org_unit_float_policy policy ON policy.id = items.float_policy
    GROUP BY 2, 3, 4, 5, 6
;

CREATE UNIQUE INDEX ON evergreen.float_target_counts (circ_lib, copy_location_code);

CREATE OR REPLACE FUNCTION evergreen.float_target_has_bib_slot(
    target_ou INTEGER,
    target_location_code TEXT,
    target_bib INTEGER
) RETURNS BOOLEAN AS $FUNK$
DECLARE
    bib_slots_taken INTEGER;
    bib_slots INTEGER;
BEGIN
    -- Returns true if the shelf location in question has room for an
    -- additional copy of the specific bib record.
    SELECT INTO bib_slots_taken, bib_slots
        COUNT(items.id) AS bib_slots_taken,
        policy.max_per_bib AS bib_slots
        FROM evergreen.on_shelf_float_balanced_items items
        JOIN asset.call_number acn ON acn.id = items.call_number
        JOIN config.org_unit_float_policy policy ON policy.id = items.float_policy
        WHERE 
            items.circ_lib = target_ou
            AND items.copy_location_code = target_location_code
            AND acn.record = target_bib
        GROUP BY 2;

    IF NOT FOUND THEN
        -- Bib record in question has no copies at the specified location.
        RETURN TRUE;
    END IF;

    RETURN bib_slots_taken < bib_slots;
END;
$FUNK$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION evergreen.float_destination(
    copy_id INTEGER,
	target_ou INTEGER
) RETURNS INTEGER AS $FUNK$
DECLARE
    copy asset.copy%ROWTYPE;

    -- Org units within this copy's float member group.
    member_orgs INTEGER[];

    target_bib INTEGER;

    has_bib_slots BOOLEAN;

    target_counts evergreen.float_target_counts%ROWTYPE;

    -- KCLS matches copy location by their code names since each branch
    -- maintains its own version of (practically) every copy location, 
    -- i.e. locations are not shared by the consortium.
    copy_location_code TEXT;
BEGIN
    SELECT INTO copy * FROM asset.copy WHERE id = copy_id;

    IF copy.floating IS NULL OR copy.call_number < 0 THEN
        -- This copy doesn't float and/or it's a precat copy.
        RETURN copy.circ_lib;
    END IF;

    SELECT INTO member_orgs ARRAY(
        SELECT * FROM evergreen.float_members(copy.floating, copy.circ_lib, target_ou));

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

    -- Do we have space on the target shelf?
    PERFORM TRUE
        FROM evergreen.float_target_counts ftc
        WHERE ftc.circ_lib = target_ou
            AND ftc.copy_location_code = copy_location_code -- KCLS
            AND ftc.location_slots_filled < ftc.location_slots;

    IF FOUND THEN
        -- We have space on the target shelf.
        -- Do have space for this specific bib record?
        SELECT INTO has_bib_slots FROM 
            evergreen.float_target_has_bib_slot(target_ou, copy_location_code, target_bib);
    
        IF has_bib_slots THEN
            -- All clear to float to the checkin branch.
            RETURN target_ou;
        END IF;
    END IF;

    -- No room at the inn... Find the best float target.

    FOR target_counts IN 
        SELECT ftc.* FROM evergreen.float_target_counts
        WHERE 
            ftc.copy_location_code = copy_location_code
            AND ftc.circ_lib = ANY (member_orgs)
            AND ftc.circ_lib NOT IN (copy.circ_lib, target_ou)
        ORDER BY (ftc.location_slots - ftc.location_slots_filled) DESC
    LOOP
        -- This branch has room at the desire copy location.
        -- Make sure it doesn't have too many copies of the same bib.
        SELECT INTO has_bib_slots FROM 
            evergreen.float_target_has_bib_slot(ftc.circ_lib, copy_location_code, target_bib);
    
        IF has_bib_slots THEN
            -- All clear to float to this branch.
            RETURN ftc.circ_lib;
        END IF;

        -- Bib record count exceeded.  Loop and try the next best location.
    END LOOP;

    RETURN target_ou;
END;
$FUNK$ LANGUAGE PLPGSQL;


------------------------------------------------------------------------------
-- make some sample data
INSERT INTO config.org_unit_float_policy 
    (active, org_unit, max_per_bib, copy_location, max_items)
SELECT TRUE, aou.id, 2, acpl.id, 10
FROM actor.org_unit aou
JOIN asset.copy_location acpl ON acpl.owning_lib = aou.id;

REFRESH MATERIALIZED VIEW evergreen.float_target_counts;

COMMIT;

