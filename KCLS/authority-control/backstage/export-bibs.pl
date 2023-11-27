#!/usr/bin/env perl
# -----------------------------------------------------------------------
# Export bib records for Backstage processing.
#
# The UTF-8 encoded USMARC string for each record is printed to STDOUT.
# 
# Exported bibs meet the following criteria:
#
# 1. Delete flag must be false.
# 2. Record cannot contain any 086, 092, or 099 tags containing the phrase 'on order'
# 3. cat_date_in_range
# 3. Boolean filter:
# ( ( ( 001_test OR 035_test ) AND has_holdings ) OR 998_test )
# -----------------------------------------------------------------------
use strict; 
use warnings;
use DBI;
use Getopt::Long;
use MARC::Record;                                                              
use MARC::File::XML (BinaryEncoding => 'UTF-8');         
use OpenILS::Utils::KCLSScriptUtil;
my $KU = 'OpenILS::Utils::KCLSScriptUtil';

my $start_date;
my $end_date;
my $ids_only;
my $id_file;
my $count_only;
my $out_file;
my $help;

GetOptions(
    'start-date=s'  => \$start_date,
    'end-date=s'    => \$end_date,
    'ids-only'      => \$ids_only,
    'count-only'    => \$count_only,
    'out-file=s'    => \$out_file,
    'id-file=s'    => \$id_file,
    'help'          => \$help
) || help();

sub help {
    print <<HELP;

Export bib records for uploading to Backstage for processing.
MARC data is sent to STDOUT.  Redirect as needed.

$0 --start-date 2015-06-01 --end-date 2016-06-01 --out-file /tmp/foo.marc

Options

    --start-date <YYYY-MM-DD>
    --end-date <YYYY-MM-DD>
        Export bib records whose cataloging_date (for physical records) or
        create_date (for electronic records) value is between the provided
        start and end dates.

    --out-file </path/to/file>
        Write MARC records (or IDs) to this file.

    --ids-only
        Write bib record IDs to the output file instead of the full MARC 
        record.

    --count-only
        Only print the number of bibs that would be exported to STDOUT.

    --id-file </path/to/file>
        Export bibs based on IDs found in this file.  This bypasses the
        normal date-filtered query.  IDs listed one per line.

HELP
    exit;
}

help() if $help;

if (!$id_file) {

    $KU->announce('ERR', "--start-date and --end-date required", 1)
        unless $start_date && $end_date;

    $KU->announce('ERR', "Invalid date format", 1) unless
        $start_date =~ /^\d{4}-\d{2}-\d{2}$/ &&
        $end_date =~ /^\d{4}-\d{2}-\d{2}$/;
}

$KU->announce('ERR', "--out-file <filename> required", 1)
    unless $out_file || $count_only;

# Returns a SQL query which returns a set of bib record IDs
sub bib_query {

    if ($id_file) {
        open(ID_FILE, $id_file) 
            or die "Cannot open --id-file '$id_file': $!\n";

        my $ids = join(',', map { chomp $_; $_ } <ID_FILE>);

        close(ID_FILE);

        return "SELECT id FROM biblio.record_entry WHERE id IN ($ids)";
    }

    my $sql = <<SQL;

-- viable_records include filters applied to all records.
-- not deleted
-- is not on order (086/092/099 test)
-- cataloging date in range
WITH viable_records AS (

    SELECT bre.id
    FROM biblio.record_entry bre
    WHERE NOT deleted
        AND NOT EXISTS (
            SELECT 1 FROM metabib.real_full_rec
            WHERE record = bre.id 
                AND tag IN ('086', '092', '099') 
                AND value ILIKE '%on order%'
        )
        AND bre.cataloging_date BETWEEN '$start_date' AND '$end_date'

-- electronic_records have a valid 998d value for electronic records
), electronic_records AS (  

    SELECT vr.id
    FROM viable_records vr
    JOIN metabib.real_full_rec mrfr ON (vr.id = mrfr.record)
    WHERE 
        mrfr.tag = '998' AND 
        mrfr.subfield = 'd' AND
        mrfr.value IN ('d','t','v','w','x','y','1','6') 

-- physical records are non-electronic, have at least one viable
-- linked copy, have a valid 001 OR 035 field
), physical_records AS (

    SELECT vr.id
    FROM viable_records vr
    JOIN metabib.real_full_rec mfr ON (
        mfr.record = vr.id AND (
            (
                mfr.tag = '001' AND (
                    mfr.value ILIKE 'oc%' OR 
                    mfr.value ILIKE 'on%' OR 
                    mfr.value ILIKE 'wln%'
                )
            ) OR (
                mfr.tag = '035' AND 
                mfr.subfield = 'a' AND 
                mfr.value ILIKE '%WaOLN%'
            )
        )
    )
    WHERE EXISTS (
        -- bib has at least one non-deleted copy
        SELECT acp.id
        FROM asset.copy acp
        JOIN asset.call_number acn ON (acn.id = acp.call_number)
        WHERE
            acn.record = vr.id
            AND NOT acn.deleted
            AND NOT acp.deleted
        LIMIT 1
    )
) 
SELECT DISTINCT(x.id) FROM (
    SELECT id FROM electronic_records 
    UNION 
    SELECT id FROM physical_records
) x
SQL

    return $sql;
}
 

# Finds bibs to export and prints their MARC to STDOUT
sub export_marc {

    if ($out_file) {
        open(MARCFILE, ">$out_file") 
            or die "Cannot open file for writing: $out_file\n";
        binmode(MARCFILE, ':utf8');
    }

    my $sth = $KU->prepare_statement(bib_query());
    $sth->execute;

    my $count = 0;
    my @skipped;
    while (my $bib = $sth->fetchrow_hashref) {
        $count++;
        next if $count_only;

        my $bib_id = $bib->{id};

        if ($ids_only) {
            print MARCFILE "$bib_id\n";
            $KU->announce('INFO', "$count records written...")
                if ($count % 1000) == 0;
            next;
        }

        my $rec = $KU->db_handle->selectall_arrayref(
            "SELECT marc FROM biblio.record_entry WHERE id = $bib_id");

        my $marc = $rec->[0]->[0];
        my $marcdoc = MARC::Record->new_from_xml($marc, 'UTF-8', 'USMARC');

        if (my @warnings = $marcdoc->warnings) {
            $KU->announce('WARNING', 
                "Skipping record $bib_id on warnings: @warnings");
            push(@skipped, $bib_id);
        } else {
            print MARCFILE $marcdoc->as_usmarc;
        }

        $KU->announce('INFO', "$count records processed...")
            if ($count % 1000) == 0;
    }

    close(MARCFILE) if $out_file;

    my $skip_count = scalar(@skipped);

    $KU->announce('INFO', "total bibs = $count");
    $KU->announce('INFO', "skipped bibs = $skip_count");
    $KU->announce('INFO', "exported bibs = ".($count - $skip_count));
    $KU->announce('INFO', "skipped bibs: @skipped") if @skipped;
}

$KU->connect_db;
export_marc();
$KU->disconnect_db;

