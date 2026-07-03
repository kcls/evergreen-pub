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
BATCH_SIZE=${BATCH_SIZE:-1000}

echo -n "Aging copy transits at "
date +"%F %T"

total=0

while true; do
    count=$(echo "$TIMEOUT; CALL action.age_copy_transits('$AGE_AGE', $BATCH_SIZE);" \
        | $PSQL -t -A | tail -1)

    total=$((total + count))

    echo "Aged $count transits ($total total)"

    if [ "$count" -eq 0 ] || [ "$total" -ge "$BATCH_LIMIT" ]; then
        break
    fi
done

echo -n "Done aging $total copy transits at "
date +"%F %T"
