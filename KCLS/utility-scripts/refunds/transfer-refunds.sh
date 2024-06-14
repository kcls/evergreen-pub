#!/bin/bash
TODAY=$(date +'%F');
SCP_DEST=$1

[ -z "$SCP_DEST" ] && echo "SCP destination required" && exit 1;

for csv_file in /openils/var/data/auto-refunds/refund-$TODAY*; do
    echo "Transfering refund file: $csv_file to $SCP_DEST"
    scp $csv_file $SCP_DEST
done;


