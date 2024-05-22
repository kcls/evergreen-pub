#!/bin/bash
source ~/.bashrc
set -eu

OUTPUT_DIR="/openils/var/data/xml-notices"
AT_FILTERS=/openils/conf/a_t_filters/
AT_BASE_COMMAND="/openils/bin/action_trigger_runner.pl --osrf-config /openils/conf/opensrf_core.xml"
GENERATOR_SCRIPT="./create-notice-file.pl"
export OSRF_LOG_CLIENT=1

FILE_NAME=""
if [ -n "$FILE_DATE" ]; then
    FILE_NAME="${NOTICE_TAG}-${FILE_DATE}.xml"
else
    FILE_NAME="${NOTICE_TAG}-${END_DATE}.xml"
fi;

LOCAL_FILE="$OUTPUT_DIR/$FILE_NAME"

function announce {                                                            
    echo "$(date +'%F %T') $(hostname): $1"
}

if [ $(whoami) != 'opensrf' ]; then
    announce "Run me as 'opensrf'"
    exit 1;
fi;

if [ -z "$SKIP_ACTION_TRIGGER" ]; then

    announce "Processing A/T Events for $GRANULARITY"

    $AT_BASE_COMMAND $PROCESS_HOOKS $CUSTOM_FILTERS --run-pending \
        --granularity $GRANULARITY --granularity-only;
fi

if [ -z "$NO_GENERATE_XML" -o "$FORCE_GENERATE_XML" ]; then

    announce "Generating XML notice file for for $END_DATE def=$EVENT_DEF => $NOTICE_TAG"

    set +e # allow non-zero exit
    $GENERATOR_SCRIPT --verbose $FORCE_GENERATE_XML --output-dir $OUTPUT_DIR \
        --notice-type "$NOTICE_TYPE" --notify-interval "$NOTIFY_INTERVAL" \
        --end-date "$END_DATE" --event-def $EVENT_DEF --event-tag $NOTICE_TAG \
        $FOR_EMAIL $FOR_NO_EMAIL --window "$WINDOW" --file-date "$FILE_DATE" "$FOR_TEXT"

    if [ $? != 0 ]; then
        set -e
        announce "Notice generation failed for def=$EVENT_DEF => $NOTICE_TAG";
        exit 1;
    fi;

    set -e

    announce "Notice generation completed for def=$EVENT_DEF => $NOTICE_TAG";

    FILE_SIZE=$(stat --format=%s "$LOCAL_FILE");

    if [ $FILE_SIZE == 0 ]; then
        announce "No notices to generate for def=$EVENT_DEF => $NOTICE_TAG";
    else
        announce "Generated $FILE_SIZE bytes for notice def=$EVENT_DEF => $NOTICE_TAG";
    fi;

fi;


if [ -n "$SEND_XML" ]; then

    FILE_SIZE=$(stat --format=%s "$LOCAL_FILE");

    if [ $FILE_SIZE == 0 ]; then
        announce "No content to deliver for $LOCAL_FILE";
    else

        announce "SCP'ing $LOCAL_FILE => $SCP_DEST/$FILE_NAME"
        scp "$LOCAL_FILE" "$SCP_DEST/$FILE_NAME"

        if [ $? == 0 ]; then
            announce "SCP Succeeded for $FILE_NAME";
        else
            announce "SCP Failed for $FILE_NAME";
        fi;
    fi;
fi;

