#!/bin/bash
# ----------------------------------------------------------------
# Backstage file processing utility functions.
# 
# Environment variables BACKSTAGE_USER and BACKSTAGE_PASSWORD
# must be set. 
#
# PGHOST and PGPASSWORD may also need to be set.
# ----------------------------------------------------------------
BACKSTAGE_PUT_URL="ftp://ftp.bslw.com/in"
BACKSTAGE_GET_URL_FTP="ftp://ftp.bslw.com/out"
# HTTP site appears to only be used for demo purposes.
# All connections now use FTP.  Leaving for reference.
BACKSTAGE_GET_URL_HTTP="http://mars.bslw.com/ftpfiles/NTG"
WORKING_DIR_BASE="/openils/var/data/authority-control/backstage"
REPORTS_DIR_BASE="/openils/var/web/standalone/backstage"

# see bs_make_dirs()
REPORTS_DIR=""
WORKING_DIR=""

# collisions file processing
MERGE_PROFILE=104 # "Backstage Field Protection"
BIB_QUEUE=5413 # "Backstage Quarterly" 
WORKSTATION="SV-Backstage-Merge"

SCRIPT_DIR=$PWD
CURL="curl --silent --show-error --user $BACKSTAGE_USER:$BACKSTAGE_PASSWORD";

CUR_MONTH=$(date +'%m')
CUR_YEAR2=$(date +'%y')
CUR_YEAR4=$(date +'%Y')
CUR_QTR=$(( ($(date +%-m)-1)/3+1 ))
PREV_QTR_START_DATE=""
PREV_QTR_END_DATE=""

# TODO use environment variable instead of inline recipient.
EMAIL_RECIP=opensrf@localhost

function die { echo "$@" 1>&2 ; exit 1; } # thanks, internet.

# Confirm Backstage username and password are provided.
function bs_check_creds {

    [ -z "${BACKSTAGE_USER+x}" -o -z "${BACKSTAGE_PASSWORD+x}" ] && \
        die "ENV variables BACKSTAGE_USER and BACKSTAGE_PASSWORD required."

    echo "Connecting to backstage as user $BACKSTAGE_USER"
}

# Fetch a file from the Backstage FTP server.
# FILE_NAME is the name of the file on the Backstage server -- no path.
function bs_get_file {
    FILE_NAME="$1"
    DEST_DIR="$2"
    PROTO="$3"

    [ -z "$FILE_NAME" -o -z "$DEST_DIR" ] && \
        die "bs_get_file() requires file name and destination directory"

    [ ! -w "$DEST_DIR" ] && \
        die "Destination directory is not writable: $DEST_DIR"

    bs_check_creds;

    # curl doens't have an output directory option, so go there, 
    # get the file, then return.
    cd $DEST_DIR;

    if [ "$PROTO" = "HTTP" ]; then
        URL="$BACKSTAGE_GET_URL_HTTP/$FILE_NAME"
    else
        URL="$BACKSTAGE_GET_URL_FTP/$FILE_NAME"
    fi

    if [ -f $FILE_NAME ]; then
        echo "Backstage file already retrieved: $FILE_NAME"

    else
        echo "Fetching Backstage file $FILE_NAME"

        $CURL -O "$URL"

        [ "$?" != 0 ] && die "curl failed to retrieve file: $URL"
    fi;

    cd $SCRIPT_DIR;
}

# Put a file onto the Backstage FTP server.
# FILE_NAME is the local file name.  May be relative to PWD or path-qualified.
function bs_put_file {
    FILE_NAME="$1"

    [ -z "$FILE_NAME" ] && \
        die "bs_put_file() requires a file name"

    bs_check_creds;

    echo "Putting Backstage file: $(ls -l $FILE_NAME)"

    $CURL -T "$FILE_NAME" "$BACKSTAGE_PUT_URL/"

    [ "$?" != 0 ] && \
        die "curl failed to send file: $BACKSTAGE_PUT_URL/$FILE_NAME"
}


# Fetch the monthly authority update file and process the results.
function bs_import_monthly_auths {
    bs_make_dirs "monthly"

    FILE="NTG${CUR_YEAR2}${CUR_MONTH}N.zip"

    bs_get_file "$FILE" "$WORKING_DIR" "FTP"

    echo "Processing file $WORKING_DIR/$FILE ..."

    perl ./process-backstage-files.pl \
        --verbose \
        --auth-only \
        --zip-file $WORKING_DIR/$FILE \
        --working-dir $WORKING_DIR \
        --reports-dir $REPORTS_DIR \
        > $WORKING_DIR/process.log
}

function bs_import_qtrly_results {
    bs_set_qtr_dates;
    bs_make_dirs "quarterly"

    EXPORT_DATE="$(cat $WORKING_DIR/EXPORT_DATE)"

    [ -z "$EXPORT_DATE" ] && \
        die "No quarterly export data found at $WORKING_DIR/EXPORT_DATE"

    FILE="NTG${CUR_YEAR2}${CUR_MONTH}C.zip"

    bs_get_file "$FILE" "$WORKING_DIR" "FTP"

    echo "Processing file $WORKING_DIR/$FILE ..."

    perl ./process-backstage-files.pl \
        --verbose \
        --export-date $EXPORT_DATE \
        --zip-file $WORKING_DIR/$FILE \
        --working-dir $WORKING_DIR \
        --reports-dir $REPORTS_DIR \
        > $WORKING_DIR/process.log

}

function bs_export_qtrly_bibs {
    bs_set_qtr_dates;
    bs_make_dirs "quarterly"
    # check and exit early if needed.
    bs_check_creds;

    BASE_FILE="bib-export-qtrly.$CUR_YEAR4-$CUR_MONTH"
    EXPORT_FILE="$WORKING_DIR/$BASE_FILE.mrc"
    EXPORT_TCNS_FILE="$REPORTS_DIR/$BASE_FILE.tcns.txt"

    # First run lists ID's only.
    perl ./export-bibs.pl \
        --ids-only \
        --start-date $PREV_QTR_START_DATE \
        --end-date $PREV_QTR_END_DATE \
        --out-file $EXPORT_TCNS_FILE

    perl ./export-bibs.pl \
        --start-date $PREV_QTR_START_DATE \
        --end-date $PREV_QTR_END_DATE \
        --out-file $EXPORT_FILE

    if [ -f $EXPORT_FILE ]; then
        if [ "$(stat -c '%b' $EXPORT_FILE)" == 0 ]; then
            die "Empty bib export file created"
        else
            bs_put_file $EXPORT_FILE

            # Put a file into the working directory with the export 
            # date so the importer can refer to it later.
            echo "$(date +'%F')" > "$WORKING_DIR/EXPORT_DATE"

            # count the number of MARC record separator characters
            count=$(cat $EXPORT_FILE | perl -e '$/="\x1D";$c = 0;$c++ while (<>);print "$c";')
            echo "" | mailx -s \
                "Exported $count Bibs for Backstage Q$CUR_QTR $CUR_YEAR4" \
                $EMAIL_RECIP
        fi
    else 
        die "No MARC export file was created at $EXPORT_FILE"
    fi
}


function bs_import_bib_collisions {
    bs_set_qtr_dates;
    bs_make_dirs "quarterly"
    CFILE="$WORKING_DIR/bib-collisions.mrc";

    echo "Processing bib collisions files $CFILE"

    if [ ! -f "$CFILE" ]; then
        echo "No bib collisions file to process."
        return;
    fi;

    if [ ! -s "$CFILE" ]; then
        echo "Bib collisions file is empty"
        return;
    fi;
    
    if [ ! -f "$WORKING_DIR/bib-collisions.bak.mrc" ]; then
        echo "Making collisions file backup."
        cp $CFILE "$WORKING_DIR/bib-collisions.bak.mrc";
    else
        echo "Collisions file backup already exists"
    fi;

    cd /openils/bin/
    perl ./marc_stream_importer.pl      \
        --spoolfile $CFILE              \
        --user admin                    \
        --workstation $WORKSTATION      \
        --bib-auto-overlay-exact        \
        --bib-queue $BIB_QUEUE          \
        --merge-profile $MERGE_PROFILE

    cd $SCRIPT_DIR;
}


# Sets the start and end dates of 2 quarters back.
# Probably a more elegant way to do this, oh well.
function bs_set_qtr_dates {

    # Q1 of this year, maps to Q3 processing.
    YEAR=$CUR_YEAR4
    START_MONTH="01"
    END_DAY=31

    if [ $CUR_QTR == 1 ]; then
        # Q3 of last year
        let YEAR=$CUR_YEAR4-1
        START_MONTH="07"
        END_DAY=30

    elif [ $CUR_QTR == 2 ]; then
        # Q4 of last year
        let YEAR=$CUR_YEAR4-1
        START_MONTH="10"

    elif [ $CUR_QTR == 4 ]; then
        # Q2 of this year
        START_MONTH="04"
        END_DAY=30
    fi

    let END_MONTH=$START_MONTH+2
    PREV_QTR_START_DATE="$YEAR-$START_MONTH-01"
    PREV_QTR_END_DATE="$YEAR-$(printf '%0.2d' $END_MONTH)-$END_DAY"

    echo "Prev quarter dates: $PREV_QTR_START_DATE..$PREV_QTR_END_DATE"
}


# Create working and report files directories.
function bs_make_dirs {
    TYPE="$1" # monthly, quarterly

    WORKING_DIR="$WORKING_DIR_BASE/$TYPE/$CUR_YEAR4-$CUR_MONTH"
    REPORTS_DIR="$REPORTS_DIR_BASE/$TYPE/$CUR_YEAR4-$CUR_MONTH"

    echo "Creating working directory: $WORKING_DIR"

    mkdir -p $WORKING_DIR

    [ ! -w $WORKING_DIR ] && 
        die "Working directory is not writeable: $WORKING_DIR"

    echo "Creating reports directory: $REPORTS_DIR"

    mkdir -p $REPORTS_DIR

    [ ! -w $REPORTS_DIR ] && 
        die "Reports directory is not writeable: $REPORTS_DIR"
}

function usage {
    cat <<USAGE
        $0

        Options
            -d <db-host> - overrides global PGHOST for this script.
                MAKE THIS THE FIRST SCRIPT PARAMETER IF SET.

            -a Import monthly authority update file.

            -b Create and upload quarterly bib export
            -q Process quarterly bib export results.

            -h Show this help message.
USAGE
    exit;
}


while getopts "abqhd:p:c" opt; do
    case $opt in
        d) export PGHOST=$OPTARG;;
        a) bs_import_monthly_auths;;
        q) bs_import_qtrly_results;;
        b) bs_export_qtrly_bibs;;
        c) bs_import_bib_collisions;;
        h) usage;;
    esac
done;



