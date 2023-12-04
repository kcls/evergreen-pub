#!/bin/bash
source ~/.bashrc

TODAY=$(date +'%F');
YESTERDAY=$(date --date "1 day ago" +'%F');

cd /openils/var/data/xml-notices/

# Summary for this morning's daily notices
message=""
printf -v message "Daily Notices For Today\n"

for file in $(ls | grep "$TODAY" | grep -v 'T' | xargs); do
    count=$(grep -c '<notice' $file);
    count=$(printf "%-5s" $count)
    printf -v message "$message\n$count : $file"
done;

printf -v message "$message\n\nFrequent Notice Summary For Yesterday\n"

for file in $(ls | grep "$YESTERDAY" | grep 'T' | cut -d 'T' -f1 | sort | uniq | xargs); do
    count=$(cat $file* | grep -c '<notice');
    count=$(printf "%-5s" $count)
    printf -v message "$message\n$count : $file"
done;

echo "$message"


