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
    aged_count INTEGER := 0;
BEGIN
    FOR transit IN
        -- Walk the prev_hop chain forward from the root to find
        -- all transits in the group, then process newest-first
        -- so child transits are deleted before their parents
        -- (respecting the prev_hop FK).
        -- LEFT JOINs pull hold/reservation in a single query.
        WITH RECURSIVE chain AS (
            SELECT id FROM action.transit_copy WHERE id = root_transit_id
            UNION ALL
            SELECT tc.id
            FROM action.transit_copy tc
            JOIN chain c ON tc.prev_hop = c.id
        )
        SELECT tc.id, tc.source_send_time, tc.dest_recv_time,
            tc.target_copy, tc.source, tc.dest, tc.prev_hop,
            tc.copy_status, tc.persistant_transfer, tc.prev_dest,
            tc.cancel_time, htc.hold, rtc.reservation
        FROM chain c
        JOIN action.transit_copy tc ON tc.id = c.id
        LEFT JOIN action.hold_transit_copy htc ON htc.id = c.id
        LEFT JOIN action.reservation_transit_copy rtc ON rtc.id = c.id
        ORDER BY tc.source_send_time DESC
    LOOP
        IF transit.dest_recv_time IS NULL AND transit.cancel_time IS NULL THEN
            RAISE EXCEPTION 'Transit % is still active', transit.id;
        END IF;

        INSERT INTO action.aged_copy_transit (
            id, source_send_time, dest_recv_time, target_copy,
            source, dest, prev_hop, copy_status, persistant_transfer,
            prev_dest, cancel_time, hold, reservation
        ) VALUES (
            transit.id, transit.source_send_time, transit.dest_recv_time,
            transit.target_copy, transit.source, transit.dest,
            transit.prev_hop, transit.copy_status, transit.persistant_transfer,
            transit.prev_dest, transit.cancel_time, transit.hold, transit.reservation
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

SET STATEMENT_TIMEOUT = 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS transit_copy_prev_hop_idx
    ON action.transit_copy (prev_hop);

CREATE INDEX CONCURRENTLY IF NOT EXISTS transit_copy_root_send_time_idx
    ON action.transit_copy (source_send_time)
    WHERE prev_hop IS NULL;
