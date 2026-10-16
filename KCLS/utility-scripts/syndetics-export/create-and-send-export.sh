#!/bin/bash
# Exports of newly added records are generated weekly and uploaded to Syndetics.
#
# Expects PGHOST / PGUSER / etc. and SYNDETICS_USERNAME / SYNDETICS_PASSWORD
# in the environment (e.g. via ~/.bashrc).
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
SINCE_DATE=$(date --date '-1 week' +'%F')
OUT_FILE="syndetics-export-$NOW_DATE.marc"
FTP_URL="ftp://unbound-ftp.syndetics.com/"

echo "Exporting bibs created since $SINCE_DATE as $OUT_FILE to $SYNDETICS_USERNAME@$FTP_URL"

cd "$SCRIPT_DIR"

if ! ./export-bibs-syndetics.pl --created-since "$SINCE_DATE" --verbose --out-file "$OUT_FILE"; then
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
