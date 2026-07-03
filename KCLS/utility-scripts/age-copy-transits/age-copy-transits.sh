#!/bin/bash
# -------------------------------------------------------------------------
# Move old copy transits to the action.aged_copy_transit table.
# Set PGHOST, PGPASSWORD, PGUSER environment variables!
# -------------------------------------------------------------------------
set -eu
PSQL="psql"

# 1 hour backstop
TIMEOUT="SET STATEMENT_TIMEOUT = 36000000" 

AGE_AGE=${AGE_AGE:-"5 years"}
BATCH_LIMIT=${BATCH_LIMIT:-50000}

echo -n "Aging copy transits (limit=$BATCH_LIMIT) at "
date +"%F %T"

# NOTE the DB function ages each group of transits within its own transaction,
# so there's no need to loop on batches here to prevent long-running transactions
# and row locks.
echo "$TIMEOUT; CALL action.age_copy_transits('$AGE_AGE', $BATCH_LIMIT);" | $PSQL;

echo -n "Done aging copy transits at "
date +"%F %T"
