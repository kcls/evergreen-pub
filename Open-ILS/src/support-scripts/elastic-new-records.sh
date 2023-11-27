#!/bin/bash
set -euo pipefail

NOW_TIME=$(date +'%FT%T%z');
PREV_TIME="";

# This only needs to run while staff are adding bib records.
START_HOUR="06"
STOP_HOUR="18"
HOW_HOUR="";

while true; do

    if [ -z "$PREV_TIME" ]; then
        # On the first iteration, index all records created within the
        # last minute.
        PREV_TIME=$(date --date '-1 min' +'%FT%T%z');
    else
        PREV_TIME="$NOW_TIME";
    fi;

    NOW_TIME=$(date +'%FT%T%z');

    NOW_HOUR=$(date +'%H');

    if [ "$NOW_HOUR" -lt "$START_HOUR" -o "$NOW_HOUR" -gt "$STOP_HOUR" ]; then
        sleep 60;

    else 
        ./elastic-index.pl --created-since "$PREV_TIME" --populate > /dev/null;
    
        sleep 2;  # avoid a tight loop
    fi;
done;
