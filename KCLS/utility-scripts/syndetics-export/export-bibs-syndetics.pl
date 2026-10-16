#!/usr/bin/env perl
# -----------------------------------------------------------------------
# Export plain USMARC bib records to the selected file.
#
# Exports all non-deleted records created since the provided --created-since
# date or all records if no date is provided.
# -----------------------------------------------------------------------
use strict; 
use warnings;
use DBI;
use Getopt::Long;
use MARC::Record;
use MARC::File::XML (BinaryEncoding => 'UTF-8');
use OpenILS::Utils::KCLSScriptUtil;
my $KU = 'OpenILS::Utils::KCLSScriptUtil';

my $help = 0;
my $verbose = 0;
my $created_since = '2010-01-01';
my $out_file;

my $BIBS_SQL = <<SQL;
    SELECT id, marc FROM biblio.record_entry 
    WHERE NOT deleted AND create_date >= ?
    ORDER BY id
SQL

GetOptions(
    'created-since=s' => \$created_since,
    'out-file=s'      => \$out_file,
    'verbose'         => \$verbose,
    'help'            => \$help
) || help();

sub help {
    print <<HELP;

Export bib records for Syndetics

$0 --created-since 2026-10-16 --out-file /tmp/foo.marc

Options

    --out-file </path/to/file>
        Write MARC records to this file.

    --created-since
        Only export bibs created on or after the provided date.
        Examples:
            --created-since "2026-10-16"
            --created-since "2026-10-16 07:40:10.086124-07"

HELP
    exit;
}

help() if $help;

$KU->verbose($verbose);

$KU->announce('ERR', "--out-file <filename> required", 1) unless $out_file;

# Writes bib MARC to --out-file
sub export_marc {

    open(my $marcfile, '>', $out_file) 
        or die "Cannot open file for writing: $out_file\n";

    binmode($marcfile, ':utf8');

    my $sth = $KU->prepare_statement($BIBS_SQL);
    $sth->execute($created_since);

    my $count = 0;
    my $exported = 0;
    while (my $bib = $sth->fetchrow_hashref) {
        $count++;

        my $bib_id = $bib->{id};

        # Translate the in-db MARCXML to USMARC
        my $marcdoc = eval {
            MARC::Record->new_from_xml($bib->{marc}, 'UTF-8', 'USMARC');
        };

        if ($@ || !$marcdoc) {
            $KU->announce('WARNING', "Skipping record $bib_id on parse error: $@");
        } elsif (my @warnings = $marcdoc->warnings) {
            $KU->announce('WARNING',
                "Skipping record $bib_id on warnings: @warnings");
        } else {
            print $marcfile $marcdoc->as_usmarc;
            $exported++;
        }

        $KU->announce('INFO', "$count records processed...") if ($count % 10000) == 0;
    }

    close($marcfile);

    $KU->announce('INFO', 
        "Exported $exported of $count records created since $created_since to $out_file");
}

$KU->connect_db;
export_marc();
$KU->disconnect_db;
