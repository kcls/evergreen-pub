#!/bin/bash
# -------------------------------------------------------------------------
# Populate a single tag-based record attribute (e.g. marc_915d, see
# sqitch change 0034) on existing bibs without a full reingest.
#
# Only non-deleted bibs that actually carry the attribute's MARC tag /
# subfield are touched, and metabib.reingest_record_attributes() is
# told to process just the one attribute.  Each batch commits on its
# own, so the script can be stopped and re-run safely.
#
# Set PGHOST, PGPASSWORD, PGUSER environment variables!
# -------------------------------------------------------------------------
set -euo pipefail
PSQL="psql -X -q -v ON_ERROR_STOP=1"

ATTR=${ATTR:-marc_915d}
BATCH_SIZE=${BATCH_SIZE:-1000}

# 1 hour backstop per batch
TIMEOUT="SET STATEMENT_TIMEOUT = 3600000"

IDS=$(mktemp)
trap 'rm -f "$IDS"' EXIT

echo -n "Collecting bibs for attribute '$ATTR' at "
date +"%F %T"

# Resolve the attribute's tag / subfield list up front so the query
# below uses constants and the (tag, subfield) index on real_full_rec.
DEF=$($PSQL -At -F ' ' -v attr="$ATTR" <<'SQL'
SELECT tag, COALESCE(sf_list, '')
FROM config.record_attr_definition
WHERE name = :'attr' AND tag IS NOT NULL;
SQL
)

if [ -z "$DEF" ]; then
    echo "'$ATTR' is not a tag-based attribute in config.record_attr_definition" >&2
    exit 1
fi

read -r TAG SF_LIST <<< "$DEF"

# Mirror the tag / subfield matching used by reingest_record_attributes()
# so we only visit bibs that can produce a value.
$PSQL -At -v tag="$TAG" -v sf_list="$SF_LIST" > "$IDS" <<'SQL'
SELECT DISTINCT bre.id
FROM biblio.record_entry bre
JOIN metabib.real_full_rec mfr ON mfr.record = bre.id
WHERE NOT bre.deleted
    AND mfr.tag LIKE :'tag'
    AND (:'sf_list' = '' OR POSITION(mfr.subfield IN :'sf_list') > 0)
ORDER BY 1;
SQL

TOTAL=$(wc -l < "$IDS")

if [ "$TOTAL" -eq 0 ]; then
    echo "No bibs carry tag '$TAG' for '$ATTR'; nothing to do."
    exit 0
fi

echo "Reingesting '$ATTR' on $TOTAL bibs in batches of $BATCH_SIZE"

DONE=0
while read -r batch; do
    ids=${batch// /,}

    # rdeleted => FALSE is required; TRUE makes the function recompute
    # every attribute for the record.
    $PSQL -c "$TIMEOUT;
        SELECT metabib.reingest_record_attributes(id, ARRAY['$ATTR'], NULL, FALSE)
        FROM UNNEST(ARRAY[$ids]::BIGINT[]) AS id;" > /dev/null

    DONE=$((DONE + $(wc -w <<< "$batch")))
    echo "$DONE / $TOTAL"
done < <(xargs -n "$BATCH_SIZE" < "$IDS")

echo -n "Done at "
date +"%F %T"
