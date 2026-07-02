
BEGIN;

CREATE OR REPLACE FUNCTION action.relay_copy_transit(
    old_transit_id INTEGER,
    relay_org INTEGER
) RETURNS INTEGER AS $f$
DECLARE
    old_transit RECORD;
    new_transit_id INTEGER;
    hold_id INTEGER;
    reservation_id INTEGER;
BEGIN
    SELECT * INTO old_transit
        FROM action.transit_copy WHERE id = old_transit_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transit % not found', old_transit_id;
    END IF;

    IF old_transit.dest_recv_time IS NOT NULL THEN
        RAISE EXCEPTION 'Transit % is already closed', old_transit_id;
    END IF;

    IF old_transit.cancel_time IS NOT NULL THEN
        RAISE EXCEPTION 'Transit % is cancelled', old_transit_id;
    END IF;

    IF old_transit.dest = relay_org THEN
        RAISE EXCEPTION 'Transit % has arrived; cannot relay', old_transit_id;
    END IF;

    IF old_transit.source = relay_org THEN
        -- Item is transiting from the original transit source.
        -- Re-use the original transit.
        RETURN old_transit_id;
    END IF;

    -- Determine if this is a hold or reservation transit
    SELECT hold INTO hold_id
        FROM action.hold_transit_copy WHERE id = old_transit_id;

    IF NOT FOUND THEN
        SELECT reservation INTO reservation_id
            FROM action.reservation_transit_copy WHERE id = old_transit_id;
    END IF;

    -- Close out the old transit:
    -- dest becomes the relay point, prev_dest preserves the original dest
    UPDATE action.transit_copy SET
        dest_recv_time = NOW(),
        prev_dest = dest,
        dest = relay_org
    WHERE id = old_transit_id;

    -- Create the new transit leg in the appropriate table
    IF hold_id IS NOT NULL THEN

        INSERT INTO action.hold_transit_copy (
            source_send_time, target_copy, source, dest,
            prev_hop, copy_status, persistant_transfer, hold
        ) VALUES (
            NOW(), old_transit.target_copy, relay_org, old_transit.dest,
            old_transit_id, old_transit.copy_status, old_transit.persistant_transfer,
            hold_id
        ) RETURNING id INTO new_transit_id;

    ELSIF reservation_id IS NOT NULL THEN

        INSERT INTO action.reservation_transit_copy (
            source_send_time, target_copy, source, dest,
            prev_hop, copy_status, persistant_transfer, reservation
        ) VALUES (
            NOW(), old_transit.target_copy, relay_org, old_transit.dest,
            old_transit_id, old_transit.copy_status, old_transit.persistant_transfer,
            reservation_id
        ) RETURNING id INTO new_transit_id;

    ELSE

        INSERT INTO action.transit_copy (
            source_send_time, target_copy, source, dest,
            prev_hop, copy_status, persistant_transfer
        ) VALUES (
            NOW(), old_transit.target_copy, relay_org, old_transit.dest,
            old_transit_id, old_transit.copy_status, old_transit.persistant_transfer
        ) RETURNING id INTO new_transit_id;

    END IF;

    RETURN new_transit_id;
END;
$f$ LANGUAGE PLPGSQL;

COMMIT;
