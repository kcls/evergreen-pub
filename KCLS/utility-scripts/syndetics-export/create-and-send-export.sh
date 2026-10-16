#!/bin/bash
# Exports of newly added records are generated weekly and uploaded to Syndetics.
#
# Expects PGHOST / PGUSER / etc. and SYNDETICS_USERNAME / SYNDETICS_PASSWORD
# in the environment (e.g. via ~/.bashrc).
#
# Set SINCE_DATE (e.g. 2026-10-12) to override the default of one week ago.
#
# ASIDE: handy one-liner for counting the number of bib records in a file:
# tr -cd '\035' < file.marc | wc -c
source ~/.bashrc
set -u

SYNDETICS_USERNAME=${SYNDETICS_USERNAME:-}
SYNDETICS_PASSWORD=${SYNDETICS_PASSWORD:-}

if [ -z "$SYNDETICS_USERNAME" ] || [ -z "$SYNDETICS_PASSWORD" ]; then
    echo "SYNDETICS_USERNAME and SYNDETICS_PASSWORD must be set" >&2
    exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
NOW_DATE=$(date +'%F')
SINCE_DATE=${SINCE_DATE:-$(date --date '-1 week' +'%F')}

# Syndetics supports file name additions "update", "reindiex" and "delete"
# "update" adds new/modified records to the dataset.
# "reindex" wipes and rebuilds the dataset from the uploaded files.
# "delete" removes individual records by ISBN, etc.
OUT_FILE="syndetics-export-$NOW_DATE.update.mrc"

FTP_URL="ftp://unbound-ftp.syndetics.com/"

echo "Exporting bibs created since $SINCE_DATE as $OUT_FILE to $SYNDETICS_USERNAME@$FTP_URL"

cd "$SCRIPT_DIR"

echo "Uploading $OUT_FILE..."

if ! ./export-bibs-syndetics.pl --created-since "$SINCE_DATE" --out-file "$OUT_FILE"; then
    echo "MARC export failed; Not sending file" >&2
    exit 1
fi

# Credentials are passed via a curl config on stdin so they don't appear in `ps`.
if curl --silent --show-error --config - -T "$OUT_FILE" "$FTP_URL" \
    <<< "user = \"$SYNDETICS_USERNAME:$SYNDETICS_PASSWORD\""; then
    echo "MARC file successfully uploaded"
else
    echo "MARC upload failed" >&2
    exit 1
fi
