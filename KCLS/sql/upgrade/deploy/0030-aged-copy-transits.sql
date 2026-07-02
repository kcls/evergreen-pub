BEGIN;

CREATE TABLE action.aged_copy_transit (
    id                  INTEGER         NOT NULL,
    source_send_time    TIMESTAMPTZ,
    dest_recv_time      TIMESTAMPTZ,
    target_copy         BIGINT          NOT NULL,
    source              INTEGER         NOT NULL,
    dest                INTEGER         NOT NULL,
    prev_hop            INTEGER,
    copy_status         INTEGER         NOT NULL,
    persistant_transfer BOOLEAN         NOT NULL DEFAULT FALSE,
    prev_dest           INTEGER,
    cancel_time         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    hold                INTEGER,
    reservation         INTEGER
);

ALTER TABLE action.aged_copy_transit ADD PRIMARY KEY (id);

CREATE INDEX aged_copy_transit_source_send_idx ON action.aged_copy_transit (source_send_time);
CREATE INDEX aged_copy_transit_dest_recv_idx ON action.aged_copy_transit (dest_recv_time);
CREATE INDEX aged_copy_transit_source_idx ON action.aged_copy_transit (source);
CREATE INDEX aged_copy_transit_dest_idx ON action.aged_copy_transit (dest);
CREATE INDEX aged_copy_transit_prev_hop_idx ON action.aged_copy_transit (prev_hop);
CREATE INDEX aged_copy_transit_target_copy_idx ON action.aged_copy_transit (target_copy);

CREATE OR REPLACE FUNCTION action.age_copy_transit(old_transit_id INTEGER)
RETURNS VOID AS $f$
DECLARE
    old_transit RECORD;
    hold_id INTEGER;
    reservation_id INTEGER;
BEGIN
    SELECT * INTO old_transit
        FROM action.transit_copy WHERE id = old_transit_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transit % not found', old_transit_id;
    END IF;

    SELECT hold INTO hold_id
        FROM action.hold_transit_copy WHERE id = old_transit_id;

    IF NOT FOUND THEN
        SELECT reservation INTO reservation_id
            FROM action.reservation_transit_copy WHERE id = old_transit_id;
    END IF;

    INSERT INTO action.aged_copy_transit (
        id, source_send_time, dest_recv_time, target_copy,
        source, dest, prev_hop, copy_status, persistant_transfer,
        prev_dest, cancel_time, created_at, hold, reservation
    ) VALUES (
        old_transit.id, old_transit.source_send_time, old_transit.dest_recv_time,
        old_transit.target_copy, old_transit.source, old_transit.dest,
        old_transit.prev_hop, old_transit.copy_status, old_transit.persistant_transfer,
        old_transit.prev_dest, old_transit.cancel_time, old_transit.created_at,
        hold_id, reservation_id
    );

    DELETE FROM action.transit_copy WHERE id = old_transit_id;
END;
$f$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION action.batch_age_copy_transits(
    age INTERVAL,
    batch_limit INTEGER
) RETURNS INTEGER AS $f$
DECLARE
    transit RECORD;
    aged_count INTEGER := 0;
BEGIN
    FOR transit IN
        SELECT id FROM action.transit_copy
        WHERE dest_recv_time < NOW() - age
           OR cancel_time < NOW() - age
        ORDER BY COALESCE(dest_recv_time, cancel_time)
        LIMIT batch_limit
    LOOP
        PERFORM action.age_copy_transit(transit.id);
        aged_count := aged_count + 1;
    END LOOP;

    RETURN aged_count;
END;
$f$ LANGUAGE PLPGSQL;

COMMIT;
