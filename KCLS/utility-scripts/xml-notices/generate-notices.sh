#!/bin/bash
# Process XML notice Action/Trigger events, generate XML files from
# events, and send XML notices to the vendor.
# Parameters are passed to the ./process-one-notice.sh script
# via environment variables.
source ~/.bashrc
set -eu

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )" 
END_DATE=$(date +'%F');
FILE_DATE=""
SCP_DEST="kingco@sftp.unique-mgmt.com:incoming"
AT_FILTERS="/openils/conf/a_t_filters/"
WINDOW=""
SKIP_ACTION_TRIGGER=""
NO_GENERATE_XML=""
FORCE_GENERATE_XML=""
SEND_XML=""
GRANULARITY=""
FOR_EMAIL=""
FOR_NO_EMAIL=""
FOR_TEXT=""
EVENT_DEF=""
NOTICE_TAG=""
NOTICE_TYPE=""
NOTIFY_INTERVAL=""
PROCESS_HOOKS=""
CUSTOM_FILTERS=""

function usage {

    cat <<USAGE

Synopsis:

    $0 --send-xml --granularity Checkout-Locker-Email

Options:

    --granularity   
        Action/Trigger granularity string.  Each event definition should
        have its own unique granularity for maximum control.

    --end-date <YYYY-MM-DD[Thh:mm:ss]>
        Process action/trigger events with a run time during the period
        of time ending with this date / time.  The full size of the 
        time range is specified by --window (defaults to 1 day).

    --file-date <YYYY-MM-DD[Thh:mm:ss]>
        Optional.  Overrides use of --end-date when naming the output file.

    --skip-action-trigger
        Avoid any A/T event processing.  Useful for resending notices.

    --no-generate-xml
        Skip XML generation.  Useful for redelivering existing files.

    --force-generate-xml
        Generate the XML notice files even in cases where a matching
        file already exists.

    --send-xml
        Deliver XML notice files to vendor via SCP.

    --window <interval>
        For notices which run more frequently than daily, specify the 
        time window to process so the correct events can be isolated.

    --help
        Show this message

USAGE

    exit 0
}

while [ "$#" -gt 0 ]; do
    case $1 in
        '--granularity') GRANULARITY="$2"; shift;;
        '--end-date') END_DATE="$2"; shift;;
        '--file-date') FILE_DATE="$2"; shift;;
        '--skip-action-trigger') SKIP_ACTION_TRIGGER="YES";;
        '--no-generate-xml') NO_GENERATE_XML="YES";;
        '--force-generate-xml') FORCE_GENERATE_XML="--force";;
        '--send-xml') SEND_XML="YES";;
        '--window') WINDOW="$2"; shift;;
        '--help') usage;;
        *) echo "Unknown parameter: $1"; usage;;
    esac;
    shift;
done

if [ -z "$GRANULARITY" ]; then
    echo "--granularity required"
    exit 1;
fi;

# Our support scripts live in the same directory as us.
cd "$SCRIPT_DIR"

# ----- Export defaults;  Some of these will be overridden below.-----

export SKIP_ACTION_TRIGGER
export NO_GENERATE_XML
export FORCE_GENERATE_XML
export SEND_XML
export SCP_DEST
export END_DATE
export FILE_DATE
export WINDOW
export GRANULARITY
export NOTICE_TYPE
export NOTIFY_INTERVAL
export PROCESS_HOOKS
export CUSTOM_FILTERS
export FOR_EMAIL
export FOR_NO_EMAIL
export FOR_TEXT

case $GRANULARITY in

    'Auto-Lost-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=255
        export NOTICE_TAG="auto-lost-email"
        export NOTICE_TYPE="lost"
        ;;

    'Due-Today-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=253
        export NOTICE_TAG="due-today-email"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="0 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/overdue.json"
        ;;

    '7-Day-Overdue-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=239
        export NOTICE_TAG="7-day-overdue-email"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="7 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/overdue_email.json"
        ;;

    '14-Day-Overdue-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=249
        export NOTICE_TAG="14-day-overdue-email"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="14 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/overdue_email.json"
        ;;

    '30-Day-Overdue-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=257
        export NOTICE_TAG="30-day-overdue-email"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="30 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/overdue_email.json"
        ;;

    '60-Day-Overdue-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=240
        export NOTICE_TAG="60-day-overdue-email"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="60 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/outreach_od_email.json"
        ;;

    '90-Day-Overdue-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=250
        export NOTICE_TAG="90-day-overdue-email"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="90 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/outreach_od_email.json"
        ;;

    'Checkout-Locker-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=232
        export NOTICE_TAG=checkout-locker-email
        export NOTICE_TYPE="checkout locker"
        ;;

    'Hold-Ready-Locker-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=221
        export NOTICE_TAG=hold-ready-locker-email
        export NOTICE_TYPE="hold ready locker email"
        ;;


    'Hold-Ready-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=234
        export NOTICE_TAG=hold-ready-email
        export NOTICE_TYPE="hold ready email"
        ;;

   'Hold-Shelf-Pre-Expire-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=258
        export PROCESS_HOOKS="--process-hooks"
        export NOTICE_TAG=hold-shelf-pre-expire-email
        export NOTICE_TYPE="hold shelf pre-expire email"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/hold_shelf_pre_expire.json"
        ;;

    'Hold-Shelf-Pre-Expire-Locker-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=259
        export PROCESS_HOOKS="--process-hooks"
        export NOTICE_TAG=hold-shelf-pre-expire-locker-email
        export NOTICE_TYPE="hold shelf pre-expire locker email"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/hold_shelf_pre_expire_locker.json"
        ;;
 
    'Checkout-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=231
        export NOTICE_TAG=checkout-email
        export NOTICE_TYPE="checkout"
        ;;

    'Predue-2-Day-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=236
        export PROCESS_HOOKS="--process-hooks"
        export NOTICE_TAG=predue-email
        export NOTIFY_INTERVAL="2 days"
        export NOTICE_TYPE="predue"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/a_t_filters.2day_predue.json"
        ;;

    'Hold-Shelf-Expire-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=233
        export NOTICE_TAG=hold-shelf-expire-email
        export NOTICE_TYPE="hold shelf expire email"
        ;;

    'Auto-Renew-Email')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=247
        export NOTICE_TAG="autorenew-email"
        export NOTICE_TYPE="autorenew"
        ;;

    'Daily-Export-Hold-Cancel')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=220
        export NOTICE_TAG=hold-cancel-email
        export NOTICE_TYPE="hold canceled"
        ;;

    'Hold-Cancel-No-Target')
        export FOR_EMAIL="--for-email"
        export EVENT_DEF=248
        export NOTICE_TAG=hold-cancel-no-target-email
        export NOTICE_TYPE="hold canceled no target"
        ;;

    'Auto-Lost-Print')
        export EVENT_DEF=256
        export NOTICE_TAG="auto-lost-print"
        export NOTICE_TYPE="lost"
        export FOR_NO_EMAIL="--for-no-email"
        ;;

    '7-Day-Overdue-Phone')
        export EVENT_DEF=237
        export NOTICE_TAG="7-day-overdue-phone"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="7 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/a_t_filters.7_day_od.json"
        ;;

    '60-Day-Overdue-Phone')
        export EVENT_DEF=238
        export NOTICE_TAG="60-day-overdue-phone"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="60 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/a_t_filters.outreach_od.json"
        ;;

    'Hold-Ready-Locker-Phone')
        export EVENT_DEF=222
        export NOTICE_TAG=hold-ready-locker-phone
        export NOTICE_TYPE="hold ready locker phone"
        ;;

    'Hold-Ready-Phone')
        export EVENT_DEF=235
        export NOTICE_TAG=hold-ready-phone
        export NOTICE_TYPE="hold ready phone"
        ;;

    'Daily-Export-OD-90-Print')
        export EVENT_DEF=229
        export NOTICE_TAG="90-day-overdue-print"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="90 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/outreach_od_print.json"
        export FOR_NO_EMAIL="--for-no-email"
        ;;

    'Daily-Export-OD-60-Print')
        export EVENT_DEF=228
        export NOTICE_TAG="60-day-overdue-print"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="60 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/outreach_od_print.json"
        ;;
    
    'Daily-Export-Ecard-Print')
        export EVENT_DEF=227
        export NOTICE_TAG="ecard"
        export NOTICE_TYPE="ecard"
        ;;

    'Daily-Export-OD-7-Print')
        export EVENT_DEF=223
        export NOTICE_TAG="7-day-overdue-print"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="7 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/a_t_filters.7_day_od.json"
        ;;
    
    'Daily-Export-OD2-14-Print')
        export EVENT_DEF=224
        export NOTICE_TAG="14-day-overdue-print"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="14 days second"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/14_day_second_od_print.json"
        export FOR_NO_EMAIL="--for-no-email"
        ;;

    'Daily-Export-Hold-Ready-Print')
        export EVENT_DEF=225
        export NOTICE_TAG="holds-available-print"
        export NOTICE_TYPE="hold available"
        ;;

    'Due-Today-Text')
        export FOR_TEXT="--for-text"
        export EVENT_DEF=254
        export NOTICE_TAG="due-today-text"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="0 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/overdue.json"
        ;;

    'Hold-Ready-Locker-Text')
        export EVENT_DEF=244
        export NOTICE_TAG=hold-ready-locker-text
        export NOTICE_TYPE="hold ready locker text"
        export FOR_TEXT="--for-text"
        ;;

    'Predue-2-Day-Text')
        export EVENT_DEF=243
        export NOTICE_TAG="2-day-predue-text"
        export NOTICE_TYPE="predue"
        export NOTIFY_INTERVAL="2 days"
        export PROCESS_HOOKS="--process-hooks"
        export FOR_TEXT="--for-text"
        ;;

    'Hold-Ready-Text')
        export EVENT_DEF=242
        export NOTICE_TAG=hold-ready-text
        export NOTICE_TYPE="hold ready"
        export FOR_TEXT="--for-text"
        ;;

    'Hold-Shelf-Pre-Expire-Text')
        export EVENT_DEF=260
        export FOR_TEXT="--for-text"
        export PROCESS_HOOKS="--process-hooks"
        export NOTICE_TAG=hold-shelf-pre-expire-text
        export NOTICE_TYPE="hold shelf pre-expire text"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/hold_shelf_pre_expire.json"
        ;;

    'Hold-Shelf-Pre-Expire-Locker-Text')
        export EVENT_DEF=261
        export FOR_TEXT="--for-text"
        export PROCESS_HOOKS="--process-hooks"
        export NOTICE_TAG=hold-shelf-pre-expire-locker-text
        export NOTICE_TYPE="hold shelf pre-expire locker text"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/hold_shelf_pre_expire_locker.json"
        ;;

    '7-Day-Overdue-Text')
        export EVENT_DEF=241
        export NOTICE_TAG="7-day-overdue-text"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="7 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/a_t_filters.7_day_od.json"
        export FOR_TEXT="--for-text"
        ;;

    '60-Day-Overdue-Text')
        export EVENT_DEF=245
        export NOTICE_TAG="60-day-overdue-text"
        export NOTICE_TYPE="overdue"
        export NOTIFY_INTERVAL="60 days"
        export PROCESS_HOOKS="--process-hooks"
        export CUSTOM_FILTERS="--custom-filters $AT_FILTERS/a_t_filters.outreach_od.json"
        export FOR_TEXT="--for-text"
        ;;

    *)
        echo "No such granularity: '$GRANULARITY'"
        exit 1;
        ;;
esac;

echo "Processing granularity $GRANULARITY"
echo "EVENT_DEF=$EVENT_DEF"
echo "NOTICE_TAG=$NOTICE_TAG"
echo "NOTICE_TYPE=$NOTICE_TYPE"
echo "NOTIFY_INTERVAL=$NOTIFY_INTERVAL"
echo "PROCESS_HOOKS=$PROCESS_HOOKS"
echo "END_DATE=$END_DATE"
echo "FILE_DATE=$FILE_DATE"
echo "WINDOW=$WINDOW"
echo "FOR_TEXT=$FOR_TEXT"
echo "FOR_EMAIL=$FOR_EMAIL"
echo "FOR_NO_EMAIL=$FOR_NO_EMAIL"
echo "CUSTOM_FILTERS=$CUSTOM_FILTERS"

echo "Starting: $(date +'%FT%T')"
logger -p local0.info "NOTICES: Starting: $GRANULARITY $(date +'%FT%T')"

./process-one-notice.sh

logger -p local0.info "NOTICES: Completed: $GRANULARITY $(date +'%FT%T')"

