-- Deploy kcls-evergreen:ZZZZ-float-balancing to pg
-- requires: YYYY-patron-requests

BEGIN;

SET STATEMENT_TIMEOUT = 0;

CREATE SCHEMA IF NOT EXISTS kcls;

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

CREATE OR REPLACE FUNCTION kcls.float_members(
	float_member INTEGER,
	from_ou INTEGER,
	to_ou INTEGER
) RETURNS SETOF INTEGER AS $FUNK$
DECLARE
    float_member config.floating_group_member%ROWTYPE;
    shared_ou_depth INT;
    to_ou_depth INT;
    tmp_ou INT;
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

        FOR tmp_ou IN (
            SELECT id FROM actor.org_unit_descendants(float_member.org_unit)) LOOP
            RETURN NEXT tmp_ou;
        END LOOP;
    END LOOP;
END
$FUNK$ LANGUAGE PLPGSQL;

CREATE OR REPLACE VIEW kcls.on_shelf_items AS 
    -- All circulable copies in a "shelf occupying" status across
    -- all branches and shelf locations.
    SELECT 
        acp.id,
        acp.call_number,
        acp.circ_lib,
        acpl.name AS copy_location_code,
        acpl.id AS copy_location
    FROM asset.copy acp
    JOIN config.copy_status ccs ON ccs.id = acp.status
    JOIN asset.copy_location acpl ON acpl.id = acp.location
    WHERE 
        NOT acp.deleted
        AND acp.call_number > 0
        -- Items that are on or en route to a shelf.  This may change.
        AND ccs.is_available -- esp. not in transit (see below)
        AND NOT acpl.deleted
;

CREATE OR REPLACE VIEW kcls.in_transit_to_shelf_items AS 
    -- All in-transit copies copies that will end up with a "shelf occupying" 
    -- status across all branches and shelf locations.
    SELECT 
        acp.id,
        acp.call_number,
        -- Transit destionation branch.
        atc.dest AS circ_lib,
        dest_acpl.name AS copy_location_code,
        dest_acpl.id AS copy_location
    FROM action.transit_copy atc
    JOIN asset.copy acp ON acp.id = atc.target_copy
    JOIN config.copy_status ccs ON ccs.id = atc.copy_status
    JOIN asset.copy_location copy_acpl ON copy_acpl.id = acp.location
    JOIN asset.copy_location dest_acpl ON (
        dest_acpl.owning_lib = atc.dest
        AND dest_acpl.name = copy_acpl.name
    )
    WHERE 
        NOT acp.deleted
        AND acp.status = 6
        AND acp.call_number > 0
        AND ccs.is_available -- destination status
        AND atc.dest_recv_time IS NULL
        AND atc.cancel_time IS NULL
        AND NOT dest_acpl.deleted
;


CREATE OR REPLACE VIEW kcls.all_shelf_items AS
    -- Copies that are on a shelf or in-transit to the shelf.
    SELECT * FROM kcls.on_shelf_items
    UNION
    SELECT * FROM kcls.in_transit_to_shelf_items
;

-- We need a view for this data so we can sort on the slot
-- availability across the spectrum of branches.
CREATE MATERIALIZED VIEW kcls.float_target_counts AS 
    -- Count of on/to-shelf items by circ lib and copy location.
    SELECT 
        COUNT(items.id) AS location_slots_filled,
        items.circ_lib,
        items.copy_location_code,
        policy.max_items AS location_slots,
        policy.max_per_bib
    FROM kcls.all_shelf_items items
    JOIN config.org_unit_float_policy policy ON (
        policy.copy_location = items.copy_location
        AND policy.org_unit = items.circ_lib
    )
    GROUP BY 2, 3, 4, 5
;

CREATE UNIQUE INDEX ON kcls.float_target_counts (circ_lib, copy_location_code);
CREATE INDEX ON kcls.float_target_counts (copy_location_code);

CREATE OR REPLACE FUNCTION kcls.float_target_has_bib_slot(
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
        FROM kcls.all_shelf_items items
        JOIN asset.call_number acn ON acn.id = items.call_number
        JOIN config.org_unit_float_policy policy ON (
            policy.copy_location = items.copy_location
            AND policy.org_unit = items.circ_lib
        )
        WHERE 
            items.circ_lib = target_ou
            AND items.copy_location_code = target_location_code
            AND acn.record = target_bib
        GROUP BY 2;

    IF NOT FOUND THEN
        RAISE NOTICE 'Branch %s has zero floatable copies for bib % on shelf %s',
            target_ou, target_bib, target_location_code;
        -- Bib record in question has no copies at the specified location.
        RETURN TRUE;
    END IF;

    RETURN bib_slots_taken < bib_slots;
END;
$FUNK$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION kcls.float_copy_slots(
    copy_id INTEGER,
    target_ou INTEGER
) RETURNS SETOF kcls.float_target_counts AS $FUNK$
DECLARE
    copy asset.copy%ROWTYPE;
    location_code TEXT;
    target_counts kcls.float_target_counts%ROWTYPE;
    -- Org units within this copy's float member group.
    member_orgs INTEGER[];
BEGIN
    -- Generates a float destinatino branches + copy locations
    -- sorted by those sites with most availability.
    SELECT INTO copy * FROM asset.copy WHERE id = copy_id;

    IF copy.floating IS NULL OR copy.call_number < 0 OR copy.circ_lib = target_ou THEN
        RETURN;
    END IF;

    SELECT INTO member_orgs ARRAY(
        SELECT * FROM kcls.float_members(copy.floating, copy.circ_lib, target_ou));

    IF ARRAY_LENGTH(member_orgs, 1) = 0 THEN
        RETURN;
    END IF;

    SELECT INTO location_code name FROM asset.copy_location WHERE id = copy.location;

    FOR target_counts IN 
        SELECT ftc.* FROM kcls.float_target_counts ftc
        WHERE 
            ftc.copy_location_code = location_code
            AND ftc.circ_lib = ANY (member_orgs)
        ORDER BY (ftc.location_slots - ftc.location_slots_filled) DESC
    LOOP
        RETURN NEXT target_counts;
    END LOOP;
END;
$FUNK$ LANGUAGE PLPGSQL;


CREATE OR REPLACE FUNCTION kcls.float_destination(
    copy_id INTEGER,
	target_ou INTEGER
) RETURNS INTEGER AS $FUNK$
DECLARE
    copy asset.copy%ROWTYPE;

    -- Org units within this copy's float member group.
    member_orgs INTEGER[];

    target_bib INTEGER;

    has_bib_slots BOOLEAN;

    target_counts kcls.float_target_counts%ROWTYPE;

    -- KCLS matches copy location by their code names since each branch
    -- maintains its own version of (practically) every copy location, 
    -- i.e. locations are not shared by the consortium.
    location_code TEXT;
BEGIN
    SELECT INTO copy * FROM asset.copy WHERE id = copy_id;

    IF copy.floating IS NULL OR copy.call_number < 0 OR copy.circ_lib = target_ou THEN
        -- This copy doesn't float, is at home, or it's a precat.
        -- Send it back to the circ lib.
        RETURN copy.circ_lib;
    END IF;

    SELECT INTO member_orgs ARRAY(
        SELECT * FROM kcls.float_members(copy.floating, copy.circ_lib, target_ou));

    IF ARRAY_LENGTH(member_orgs, 1) = 0 THEN
        -- Likely excluded from floating in this group.
        RAISE NOTICE 'Copy % is excluded from floating', copy_id;
        RETURN copy.circ_lib;
    END IF;

    SELECT INTO location_code name FROM asset.copy_location WHERE id = copy.location;

    SELECT INTO target_bib acn.record 
        FROM asset.copy acp
        JOIN asset.call_number acn ON acn.id = acp.call_number
        WHERE acp.id = copy_id;

    -- Float to the destination (checkin) branch if possible.

    -- Do we have space on the target shelf?
    PERFORM TRUE
        FROM kcls.float_target_counts ftc
        WHERE ftc.circ_lib = target_ou
            AND ftc.copy_location_code = location_code
            AND ftc.location_slots_filled < ftc.location_slots;

    IF FOUND THEN
        RAISE NOTICE 'Copy % has room on shelf %s at target branch %', 
            copy_id, location_code, target_ou;

        -- We have space on the target shelf.
        -- Do have space for this specific bib record?
        SELECT INTO has_bib_slots * FROM 
            kcls.float_target_has_bib_slot(target_ou, location_code, target_bib);
    
        IF has_bib_slots THEN
            RAISE NOTICE 'Copy % has room on shelf %s for bib % at target branch %', 
                copy_id, location_code, target_bib, target_ou;

            -- All clear to float to the checkin branch.
            RETURN target_ou;
        ELSE
            RAISE NOTICE 'Copy % has NO room on shelf %s for bib % at target branch %',
                copy_id, location_code, target_bib, target_ou;
        END IF;
    ELSE
        RAISE NOTICE 'Copy % has NO room on shelf %s at target branch %',
            copy_id, location_code, target_ou;
    END IF;

    -- NO room at the inn... Find the best float target.

    FOR target_counts IN 
        SELECT ftc.* FROM kcls.float_target_counts ftc
        WHERE 
            ftc.copy_location_code = location_code
            AND ftc.circ_lib = ANY (member_orgs)
            AND ftc.circ_lib NOT IN (copy.circ_lib, target_ou)
        ORDER BY (ftc.location_slots - ftc.location_slots_filled) DESC
    LOOP
        RAISE NOTICE 'Copy % has room on shelf %s at branch %', 
            copy_id, location_code, target_counts.circ_lib;

        -- This branch has room at the desire copy location.
        -- Make sure it doesn't have too many copies of the same bib.
        SELECT INTO has_bib_slots * FROM 
            kcls.float_target_has_bib_slot(target_counts.circ_lib, location_code, target_bib);
    
        IF has_bib_slots THEN
            RAISE NOTICE 'Copy % has room on shelf %s for bib % at branch %', 
                copy_id, location_code, target_bib, target_counts.circ_lib;

            -- All clear to float to this branch.
            RETURN target_counts.circ_lib;
        END IF;

        -- Bib record count exceeded.  Loop and try the next best location.
    END LOOP;

    RAISE NOTICE 'Copy % has NO room on any shelves, floating here', copy_id;

    RETURN target_ou;
END;
$FUNK$ LANGUAGE PLPGSQL;


-- DATA TIME
DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN

RAISE NOTICE '% Creating seed data', CLOCK_TIMESTAMP();

-- Create a new separate floating group so we can avoid modifying
-- existing copy float setups, of which there are some.
INSERT INTO config.floating_group (name, manual) VALUES ('Everywhere Balanced', FALSE);

INSERT INTO config.floating_group_member 
    (floating_group, org_unit, stop_depth, max_depth, exclude)
VALUES (
    (SELECT id FROM config.floating_group WHERE name = 'Everywhere Balanced'),
    1, 0, NULL, FALSE
);


RAISE NOTICE '% Apply copy floats', CLOCK_TIMESTAMP();

UPDATE asset.copy 
SET floating = (SELECT id FROM config.floating_group WHERE name = 'Everywhere Balanced')
WHERE 
    floating IS NULL 
    AND NOT deleted 
    AND circulate
    AND call_number > 0;


RAISE NOTICE '% Creating float policies', CLOCK_TIMESTAMP();

INSERT INTO config.org_unit_float_policy
    (active, org_unit, max_per_bib, copy_location, max_items)
WITH counts AS (
    SELECT 
        COUNT(item.id) copy_count,
        item.circ_lib,
        item.copy_location
    FROM kcls.on_shelf_items item
    GROUP BY 2, 3
)
SELECT 
    TRUE,
    c.circ_lib, 
    2, -- ?
    c.copy_location,
    c.copy_count + c.copy_count / 2 -- 2/3 + (2/3)/2 == 1/1
FROM counts c
;


RAISE NOTICE '% Applying float target counts', CLOCK_TIMESTAMP();

REFRESH MATERIALIZED VIEW kcls.float_target_counts;


/*
------------------------------------------------------------------------------
-- make some sample data
INSERT INTO config.org_unit_float_policy 
    (active, org_unit, max_per_bib, copy_location, max_items)
SELECT TRUE, aou.id, 2, acpl.id, 10
FROM actor.org_unit aou
JOIN asset.copy_location acpl ON acpl.owning_lib = aou.id;

UPDATE asset.copy SET floating = 1;
------------------------------------------------------------------------------

REFRESH MATERIALIZED VIEW kcls.float_target_counts;

SELECT * FROM kcls.float_destination(7618495, 1492);
SELECT * FROM kcls.float_destination(7618495, 1516);

SELECT                                                                     
COUNT(items.id) AS bib_slots_taken,                                    
policy.max_per_bib AS bib_slots                                        
FROM kcls.on_shelf_items items                     
JOIN asset.call_number acn ON acn.id = items.call_number               
JOIN config.org_unit_float_policy policy ON policy.id = items.float_policy
WHERE                                                                  
items.circ_lib = 1516
AND items.copy_location_code = 'erd'
AND acn.record = 627503
GROUP BY 2;    
*/

END IF; END $INSERT$;

COMMIT;

