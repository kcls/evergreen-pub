#!/bin/bash
# Process the nightly collection of notifications, one after the other.
# This script is launched from CRON.
#
# Passive event defs that process daily are created "today", so the end-date
# for those has to be set to tomorrow (essentially, midnight tonight) to pick
# up the events generated today.
TODAY=$(date +'%F');
TOMORROW=$(date --date '+1 day' +'%F');
SEND_XML="--send-xml"

while [ "$#" -gt 0 ]; do
    case $1 in
        '--no-send-xml') SEND_XML=""; shift;;
        *) echo "Unknown option: $1"; exit;;
    esac
    shift;
done

# Remove all A/T lockfiles before we kick off.  This helps guarantee a
# previous failure does not prevent the batch from running.  NOTE: this
# will also remove the generic, regularly running A/T lockfile, but only
# once, before the next run creates its own lockfile.  Chances are very 
# that it will matter.
rm -fv /tmp/action-trigger-LOCK*

# EMAIL
./generate-notices.sh $SEND_XML --granularity Hold-Ready-Email
./generate-notices.sh $SEND_XML --granularity Hold-Shelf-Expire-Email
./generate-notices.sh $SEND_XML --granularity Hold-Shelf-Pre-Expire-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Hold-Shelf-Pre-Expire-Locker-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Daily-Export-Hold-Cancel
./generate-notices.sh $SEND_XML --granularity 7-Day-Overdue-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity 14-Day-Overdue-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity 30-Day-Overdue-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity 90-Day-Overdue-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Due-Today-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity 60-Day-Overdue-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Predue-2-Day-Email --end-date $TOMORROW --file-date $TODAY

# PRINT
./generate-notices.sh $SEND_XML --granularity Daily-Export-Ecard-Print
./generate-notices.sh $SEND_XML --granularity Daily-Export-Hold-Ready-Print
./generate-notices.sh $SEND_XML --granularity Daily-Export-OD2-14-Print --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Daily-Export-OD-7-Print --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Daily-Export-OD-60-Print --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Daily-Export-OD-90-Print --end-date $TOMORROW --file-date $TODAY

# TEXT
./generate-notices.sh $SEND_XML --granularity Hold-Ready-Text
./generate-notices.sh $SEND_XML --granularity Hold-Shelf-Pre-Expire-Text --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Hold-Shelf-Pre-Expire-Locker-Text --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Predue-0-Day-Text --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Predue-2-Day-Text --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity 7-Day-Overdue-Text --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Due-Today-Text --end-date $TOMORROW --file-date $TODAY

# PHONE
./generate-notices.sh $SEND_XML --granularity Hold-Ready-Phone
./generate-notices.sh $SEND_XML --granularity 7-Day-Overdue-Phone --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity 60-Day-Overdue-Phone --end-date $TOMORROW --file-date $TODAY

# --------------------------------------------------------------------------
# RUN LAST
# Some notices happen last so they allow time for related jobs 
# (autorenew, hold targeter, auto-lost) to complete first.
# --------------------------------------------------------------------------
./generate-notices.sh $SEND_XML --granularity Hold-Cancel-No-Target
./generate-notices.sh $SEND_XML --granularity Auto-Renew-Email --end-date $TOMORROW --file-date $TODAY

# Auto-Lost notices run against circs that were marked lost earlier this 
# evening, hence the --end/file-date requirements, and why they run last.
./generate-notices.sh $SEND_XML --granularity Auto-Lost-Email --end-date $TOMORROW --file-date $TODAY
./generate-notices.sh $SEND_XML --granularity Auto-Lost-Print --end-date $TOMORROW --file-date $TODAY

