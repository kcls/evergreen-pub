#!/bin/bash
# -------------------------------------------------------------------------
# Move old copy transits to the action.aged_copy_transit table.
# Set PGHOST, PGPASSWORD, PGUSER environment variables!
# -------------------------------------------------------------------------
set -eu
PSQL="psql"

# 1 hour backstop
TIMEOUT="SET STATEMENT_TIMEOUT = 36000000" 

AGE_AGE=${AGE_AGE:-"3 years"}

# Standalone transit settings (legacy backfill)
STANDALONE_BATCH_SIZE=${STANDALONE_BATCH_SIZE:-25000}
STANDALONE_MAX=${STANDALONE_MAX:-1000000}

# Chained transit series settings
SERIES_LIMIT=${SERIES_LIMIT:-25000}

echo -n "Aging copy transits at "
date +"%F %T"

echo "Aging standalone transits (batch=$STANDALONE_BATCH_SIZE, max=$STANDALONE_MAX)..."
echo "$TIMEOUT; CALL action.age_standalone_copy_transits('$AGE_AGE', $STANDALONE_BATCH_SIZE, $STANDALONE_MAX);" | $PSQL

# Once we've aged all of the standalone transits -- no prev_hop chain --
# uncomment this version which operates on transit chains.  Note this
# version is slower so we need to wait and turn it on after the transit
# table has reached a reasonable size.
# --
# echo "Aging chained transit series (limit=$SERIES_LIMIT)..."
# echo "$TIMEOUT; CALL action.age_copy_transits('$AGE_AGE', $SERIES_LIMIT);" | $PSQL
# --
#
echo -n "Done aging copy transits at "
date +"%F %T"
