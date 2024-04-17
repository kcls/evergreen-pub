#!/bin/bash
# -------------------------------------------------------------------------
# Refreshes the dynamic floating copy stats
# Set PGHOST, PGPASSWORD, PGUSER environment variables!
# -------------------------------------------------------------------------
set -eu

echo -n "Refreshing Floating Copy Counts"
date +"%F %T" 

echo "REFRESH MATERIALIZED VIEW kcls.float_target_counts;" | psql

echo -n "Refreshing Floating Copy Counts Done at"
date +"%F %T" 

