#!/bin/bash
set -euo pipefail

NOW_TIME=$(date +'%FT%T%z');
PREV_TIME="";

while true; do

    if [ -z "$PREV_TIME" ]; then
        # On the first iteration, index all records created within the
        # last minute.
        PREV_TIME=$(date --date '-1 min' +'%FT%T%z');
    else
        PREV_TIME="$NOW_TIME";
    fi;

    NOW_TIME=$(date +'%FT%T%z');

    # Pipe to /dev/null to avoid loop of Elastic deprecation warnings
    ./elastic-index.pl --created-since "$PREV_TIME" --populate > /dev/null 2>&1;

    sleep 2;  # avoid a tight loop

done;
