#!/bin/bash
TODAY=$(date +'%F');
SCP_DEST=$1

[ -z "$SCP_DEST" ] && echo "SCP destination required" && exit 1;

for json_file in /openils/var/data/auto-refunds/refund-$TODAY*; do
    if [ -e $json_file ]; then
        echo "Transfering refund file: $json_file to $SCP_DEST"
        scp $json_file $SCP_DEST
    fi;
done;


