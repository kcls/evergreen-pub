-- Deploy kcls-evergreen:0028-retain-transit-data to pg
-- requires: 0027-tote-checkin-sip-configs

-- PHASE I
-- No transaction needed/wanted for the first section of the update.

SET STATEMENT_TIMEOUT = 0;

SELECT 'Creating columns', CLOCK_TIMESTAMP();

ALTER TABLE action.transit_copy
    ADD COLUMN orig_source INTEGER REFERENCES actor.org_unit(id),
    ADD COLUMN created_at TIMESTAMPTZ;

-- PHASE II
-- Backfill data for all transits.
-- ~135M rows — each batch commits independently to avoid
-- long-running transactions and excessive DB churn.

DO $$
DECLARE
    batch_size INTEGER := 25000;
    rows_updated INTEGER;
    total_updated INTEGER := 0;
BEGIN
    LOOP
        UPDATE action.transit_copy
            SET orig_source = source,
                created_at = source_send_time
            WHERE id IN (
                SELECT id FROM action.transit_copy
                WHERE created_at IS NULL
                LIMIT batch_size
            );

        GET DIAGNOSTICS rows_updated = ROW_COUNT;

        EXIT WHEN rows_updated = 0;

        -- DO blocks run in a transaction. 
        -- commit during each iteration so the full update is not 
        -- run within a single transaction
        COMMIT;

        total_updated := total_updated + rows_updated;

        RAISE NOTICE '% Updated % rows (% total)', CLOCK_TIMESTAMP(), rows_updated, total_updated;
    END LOOP;

    RAISE NOTICE '% Backfill complete. Total rows updated: %', CLOCK_TIMESTAMP(), total_updated;
END $$;

-- Phase III

BEGIN;

SELECT 'Applying non-null changes', CLOCK_TIMESTAMP();

ALTER TABLE action.transit_copy
    ALTER COLUMN orig_source SET NOT NULL,
    ALTER COLUMN orig_source SET DEFAULT NULL,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT NOW();

SELECT 'Applying foreign keys', CLOCK_TIMESTAMP();

ALTER TABLE action.transit_copy
    DROP CONSTRAINT IF EXISTS transit_copy_orig_source_fkey,
    ADD CONSTRAINT transit_copy_orig_source_fkey
        FOREIGN KEY (orig_source)
        REFERENCES actor.org_unit(id)
        DEFERRABLE INITIALLY DEFERRED;

COMMIT;




