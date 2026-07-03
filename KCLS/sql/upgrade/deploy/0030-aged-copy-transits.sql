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

CREATE OR REPLACE FUNCTION action.age_copy_transit_group(root_transit_id INTEGER)
RETURNS INTEGER AS $f$
DECLARE
    transit RECORD;
    old_transit RECORD;
    hold_id INTEGER;
    reservation_id INTEGER;
    aged_count INTEGER := 0;
BEGIN
    FOR transit IN
        -- Walk the prev_hop chain forward from the root to find
        -- all transits in the group, then process newest-first
        -- so child transits are deleted before their parents
        -- (respecting the prev_hop FK).
        WITH RECURSIVE chain AS (
            SELECT id FROM action.transit_copy WHERE id = root_transit_id
            UNION ALL
            SELECT tc.id
            FROM action.transit_copy tc
            JOIN chain c ON tc.prev_hop = c.id
        )
        SELECT c.id FROM chain c
        JOIN action.transit_copy tc ON tc.id = c.id
        ORDER BY tc.source_send_time DESC
    LOOP
        SELECT * INTO old_transit
            FROM action.transit_copy WHERE id = transit.id;

        IF old_transit.dest_recv_time IS NULL AND old_transit.cancel_time IS NULL THEN
            RAISE EXCEPTION 'Transit % is still active', transit.id;
        END IF;

        hold_id := NULL;
        reservation_id := NULL;

        SELECT hold INTO hold_id
            FROM action.hold_transit_copy WHERE id = transit.id;

        IF NOT FOUND THEN
            SELECT reservation INTO reservation_id
                FROM action.reservation_transit_copy WHERE id = transit.id;
        END IF;

        INSERT INTO action.aged_copy_transit (
            id, source_send_time, dest_recv_time, target_copy,
            source, dest, prev_hop, copy_status, persistant_transfer,
            prev_dest, cancel_time, hold, reservation
        ) VALUES (
            old_transit.id, old_transit.source_send_time, old_transit.dest_recv_time,
            old_transit.target_copy, old_transit.source, old_transit.dest,
            old_transit.prev_hop, old_transit.copy_status, old_transit.persistant_transfer,
            old_transit.prev_dest, old_transit.cancel_time, hold_id, reservation_id
        );

        DELETE FROM action.transit_copy WHERE id = transit.id;

        aged_count := aged_count + 1;
    END LOOP;

    RETURN aged_count;
END;
$f$ LANGUAGE PLPGSQL;

CREATE OR REPLACE PROCEDURE action.age_copy_transits(
    age INTERVAL,
    batch_limit INTEGER,
    INOUT aged_count INTEGER DEFAULT 0
) AS $f$
DECLARE
    root RECORD;
    cutoff TIMESTAMPTZ := NOW() - age;
BEGIN
    FOR root IN
        -- Starting from root transits (prev_hop IS NULL) that are
        -- old enough, recurse forward via prev_hop to collect all
        -- members of each transit series.
        WITH RECURSIVE series AS (
            SELECT tc.id, tc.id AS root_id
            FROM action.transit_copy tc
            WHERE tc.prev_hop IS NULL
            AND (
                (tc.dest_recv_time IS NOT NULL AND tc.dest_recv_time < cutoff)
                OR (tc.cancel_time IS NOT NULL AND tc.cancel_time < cutoff)
            )

            UNION ALL

            SELECT tc.id, s.root_id
            FROM action.transit_copy tc
            JOIN series s ON tc.prev_hop = s.id
        ),
        -- Only keep series where every member is closed and old
        -- enough.  If any transit in the series is still active
        -- or too recent, the entire series is skipped.
        eligible AS (
            SELECT s.root_id
            FROM series s
            JOIN action.transit_copy tc ON tc.id = s.id
            GROUP BY s.root_id
            HAVING BOOL_AND(
                (tc.dest_recv_time IS NOT NULL AND tc.dest_recv_time < cutoff)
                OR (tc.cancel_time IS NOT NULL AND tc.cancel_time < cutoff)
            )
            LIMIT batch_limit
        )
        -- Process oldest series first.
        SELECT e.root_id AS id
        FROM eligible e
        JOIN action.transit_copy tc ON tc.id = e.root_id
        ORDER BY tc.source_send_time
    LOOP
        aged_count := aged_count +
            action.age_copy_transit_group(root.id);
        COMMIT;
    END LOOP;
END;
$f$ LANGUAGE PLPGSQL;

COMMIT;
