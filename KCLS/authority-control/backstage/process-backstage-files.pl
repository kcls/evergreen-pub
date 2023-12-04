#!/usr/bin/env perl
# -----------------------------------------------------------------------
# TODO: summary
#
# TODO: 
#   Disable auth record change propagation during auth record updates.
# -----------------------------------------------------------------------
use strict; 
use warnings;
use DBI;
use DateTime;
use Getopt::Long;
use MARC::Record;                                                              
use MARC::File::XML (BinaryEncoding => 'UTF-8');         
use MARC::File::USMARC;
use Archive::Zip qw(:ERROR_CODES :CONSTANTS);
use File::Basename;
use Sys::Syslog qw(syslog openlog);
use OpenILS::Utils::Normalize qw(clean_marc);
use OpenILS::Utils::KCLSScriptUtil;
binmode(STDOUT, ':utf8');

my $KU = 'OpenILS::Utils::KCLSScriptUtil';

# Reset the DB handle have this many operations to avoid memory leaks.
my $db_handle_reset = 500;
my $log_mod = 500;  # log every 500th of each type of event (see verbose)

my $marc_file;
my $zip_file;
my $export_date;
my $working_dir = '.',
my $reports_dir;
my $auth_only;
my $verbose;
my $bib_collision_file = 'bib-collisions.mrc'; # in --working-dir

my $new_auth_sth;
my $mod_auth_sth;
my $del_auth_sth;
my $delmod_auth_sth;
my $mod_bibs_sth;
my $match_auth_sth;
my $match_auth_001_sth;
my $new_auth_ctr = 0;
my $mod_auth_ctr = 0;
my $del_auth_ctr = 0;
my $mod_bibs_ctr = 0;
my $col_bibs_ctr = 0;
my $help;

GetOptions(
    'marc-file=s'   => \$marc_file,
    'zip-file=s'    => \$zip_file,
    'export-date=s' => \$export_date,
    'auth-only'     => \$auth_only,
    'working-dir=s' => \$working_dir,
    'reports-dir=s' => \$reports_dir,
    'verbose'       => \$verbose,
    'help'          => \$help
);

sub help {
    print <<HELP;

        export WORKING_DIR=/openils/var/data/authority-control/backstage/quarterly/2016-Q4
        export PGHOST=testing-db01
        $0 \
            --export-date 2016-12-09 \
            --working-dir \$WORKING_DIR
            --zip-file \$WORKING_DIR/BACKSTAGE-ZIP-FILE.zip
Options

    --export-date
        Bib records modified within EG since this time will be treated
        specially when ingesting bib records produced by Backstage to
        avoid losing change made by staff since the export.

    --auth-only
        Forces the script to ignore any bib files its asked to process.
        This also prevents the script from dying when no --export-date is
        provide, since it only affects bib records.

    --file
        Full path to a single bib or authority MARC file.

    --zip-file
        Full path to a ZIP file containing multiple authority and bib
        MARC files to process.

    --working-dir
        Directory where constituent files are extracted.
        Defaults to the CWD of this script.
HELP
    exit;
}

$KU->verbose($verbose);
$KU->syslog_ident('BACKSTAGE');

$KU->announce('ERR', "required: --export-date YYYY-MM-DD", 1)
    unless $auth_only || 
        ($export_date && $export_date =~ /^\d{4}-\d{2}-\d{2}$/);

$KU->announce('ERR', "--marc-file or --zip-file required", 1) 
    unless ($marc_file || $zip_file);

$KU->announce('ERR', "--reports-dir is not writeable", 1)
    if $reports_dir && ! -w $reports_dir;

# Log every occurrence of each event type.
$log_mod = 1 if $verbose;

sub check_db_handle {
    return if $KU->db_handle_ops < $db_handle_reset;
    $KU->reset_db_handle;
    prepare_statements();
}

sub process_zip_file {

    my $zip = Archive::Zip->new();

    $KU->announce('ERR', "Failed to read $zip_file", 1)
        unless $zip->read($zip_file) == AZ_OK;

    my %marc_files = (bib => [], auth => []);

    # Start by locating the MARC files in the ZIP file
    # All of the MARC files end in .UTF8 or MRC.
    for my $member ($zip->members) {

        my $basename = basename($member->fileName());

        if ($basename =~ /(\.UTF8|\.MRC)$/) {
            $KU->announce('INFO', "Processing MARC file $basename");

            my $local_file = "$working_dir/$basename";

            $KU->announce('ERR', "Unable to extract to file: $local_file", 1)
                unless $member->extractToFileNamed($local_file) == AZ_OK;

            if ($basename =~ /BIB/) {
                if ($auth_only) {
                    $KU->announce('WARNING', "Processing as --auth-only.  ".
                    "Skipping bib file $local_file.");
                } else {
                    push(@{$marc_files{bib}}, $local_file);
                }
            } else {
                push(@{$marc_files{auth}}, $local_file);
            }

        } elsif ($reports_dir) {
            $KU->announce('INFO', "Copying file to reports dir $basename");

            my $local_file = "$reports_dir/$basename";

            $KU->announce('ERR', "Unable to extract to file: $local_file", 1)
                unless $member->extractToFileNamed($local_file) == AZ_OK;
        }
    }

    # Then process bib files first, followed by authority files.
    process_marc_file($_) for (@{$marc_files{bib}}, @{$marc_files{auth}})
}

sub process_marc_file {
    my $local_file = shift;
    my $basename = basename($local_file);
    $KU->announce('INFO', "Processing file $basename");

    my $marc_batch = MARC::File::USMARC->in($local_file, 'UTF8')
        or $KU->announce('ERR', "Unable to read $local_file as MARC", 1);

    if ($basename =~ /BIB/) {

        handle_modified_bibs($marc_batch);

    } elsif ($basename =~ /DEL/) {

        handle_deleted_auths($marc_batch);

    } elsif ($basename =~ /CHG|NEW|AUTH/) {

        handle_modified_auths($marc_batch);

    } else {

        $KU->announce('WARNING', "Unknown file type: $basename");
    }
}

# Returns ID's of bib records that have been modified since the export date.
my @modified_bibs;
my $mod_searched = 0;
sub find_modified_bibs {

    return if $mod_searched;
    $mod_searched = 1;

    my $id_arrays = $KU->db_handle->selectall_arrayref(<<"    SQL");
        SELECT id 
        FROM biblio.record_entry 
        WHERE NOT deleted AND edit_date >= '$export_date'
    SQL

    @modified_bibs = map {$_->[0]} @$id_arrays;

    $KU->announce('INFO', scalar(@modified_bibs)." bibs modified since export");
}



# 1. Bibs that have been modified by Backstage and locally are written
#    to the --bib-collision-file as MARC for later processing.
# 2. Bibs that have only been modified by Backstage are updated
#    directly in the database.
sub handle_modified_bibs {
    my $marc_batch = shift;

    find_modified_bibs();

    while (my $record = $marc_batch->next()) {
        my $bib_id = $record->subfield('901', 'c');
        check_db_handle();

        if (!$bib_id) {
            $KU->announce('ERR', "Bib record has no 901c (ID) value.  Skipping");
            next;
        }

        if (grep {$bib_id eq $_} @modified_bibs) {
            # Bib was edited by both parties.  Save to external file
            # for later processing.

            write_bib_collision($record);

        } else {
            # Update our copy of the record.

            my $marcxml = clean_marc($record->as_xml_record());
            update_bib($marcxml, $bib_id);
        }
    }
}

sub update_bib {
    my $marcxml = shift;
    my $bib_id = shift;

    $KU->announce('INFO', "Updating bib record $bib_id");

    eval { $mod_bibs_sth->execute($marcxml, $bib_id) };

    if ($@) {
        $KU->announce('ERR', "Error updating biblio record: $@ : $marcxml");
        return;
    }

    $mod_bibs_ctr++;

    $KU->announce('INFO', "Updated $mod_bibs_ctr bib records") 
        if $mod_bibs_ctr % $log_mod == 0;
}

sub write_bib_collision {
    my $record = shift;

    my $filename = "$working_dir/$bib_collision_file";

    open(BIBS_FILE, ">>$filename") or 
        $KU->announce('ERR', "Cannot open bib collision file: $filename : $!", 1);

    binmode(BIBS_FILE, ":utf8");

    print BIBS_FILE $record->as_usmarc();

    close BIBS_FILE or
        $KU->announce('WARNING', "Error closing bib collision file: $filename : $!");

    $col_bibs_ctr++;

    $KU->announce('INFO', "Dumped $col_bibs_ctr bib collisions to file")
        if $col_bibs_ctr % $log_mod == 0;
}

sub handle_deleted_auths {
    my $marc_batch = shift;

    while (my $record = $marc_batch->next()) {
        my @matches = find_matching_auths($record);
        check_db_handle();

        for my $auth_id (@matches) {

            $KU->announce('INFO', "Deleting auth record $auth_id");

            eval {
                # 2 mods.. wrap in transaction? (see autocommit)
                $del_auth_sth->execute($auth_id);
                $delmod_auth_sth->execute($auth_id);
            };

            if ($@) {
                $KU->announce(
                    'ERR', "Error deleting authority record: $@ : $auth_id");
                next;
            }

            $del_auth_ctr++;

            $KU->announce('INFO', "Deleted $del_auth_ctr authority records") 
                if $del_auth_ctr % $log_mod == 0;
        }
    }
}

sub handle_modified_auths {
    my $marc_batch = shift;

    while (my $record = $marc_batch->next()) {
        check_db_handle();

        modify_auth_005($record);

        my @matches = find_matching_auths($record);
        push(@matches, find_replaced_auths($record));

        my $marcxml = clean_marc($record->as_xml_record());

        if (@matches) {
            update_auth($marcxml, $_) for @matches;
        } else {
            insert_auth($marcxml);
        }
   }
}

# Update the 005 field to the current date
sub modify_auth_005 {
    my $record = shift;
    my $field_005 = $record->field('005');

    # MARC 005-formatted date value
    my $now_date = DateTime->now(
        time_zone => 'local')->strftime('%Y%m%d%H%M%S.0');

    if ($field_005) {
        $field_005->update($now_date);

    } else {
        $field_005 = MARC::Field->new('005', $now_date);
        $record->insert_fields_ordered($field_005);
    }
}


sub update_auth {
    my $marcxml = shift;
    my $auth_id = shift;

    $KU->announce('INFO', "Updating authority record $auth_id");

    eval { $mod_auth_sth->execute($marcxml, $auth_id) };

    if ($@) {
        $KU->announce('ERR', "Error updating authority record: $@ : $marcxml");
        return;
    }

    $mod_auth_ctr++;

    $KU->announce('INFO', "Updated $mod_auth_ctr authority records") 
        if $mod_auth_ctr % $log_mod == 0;
}

sub insert_auth {
    my $marcxml = shift;

    eval { $new_auth_sth->execute($marcxml, "IMPORT-" . time) };

    if ($@) {
        $KU->announce('ERR', 
            "Error creating new authority record: $@ : $marcxml");
        return;
    }

    $new_auth_ctr++;

    $KU->announce('INFO', "Created $new_auth_ctr authority records") 
        if $new_auth_ctr % $log_mod == 0;
}

# Return ID's of authority records that should be replaced by the
# current record.  Checks for records whose 010$a equals the 010$z of
# the current record.
# 010$z == Canceled/invalid LC control number
sub find_replaced_auths {
    my $record = shift;

    my $subfield = $record->subfield('010', 'z');
    return () unless $subfield;

    $match_auth_sth->execute('010', $subfield);
    my $matches = $match_auth_sth->fetchall_arrayref;
    my @ids = map {$_->[0]} @$matches;

    $KU->announce('INFO', "Auth 010z=$subfield matched records: @ids") 
        if $verbose && @ids;

    return @ids;
}

# Return ID's of matching authority records.  Matching tries:
# 001 -> 010a -> 035a.
sub find_matching_auths {
    my $record = shift;

    my $tag = '001';
    my $subfield;

    # 001 test requires its own SQL query
    if (my $field = $record->field($tag)) {
        if ($subfield = $field->data) {

            $match_auth_001_sth->execute($subfield);
            my $matches = $match_auth_001_sth->fetchall_arrayref;
            my @ids = map {$_->[0]} @$matches;
            $KU->announce('INFO', "Auth 001=$subfield matched records: @ids") 
                if $verbose && @ids;
            return @ids;
        }
    }

    $tag = '010';
    $subfield = $record->subfield($tag, 'a');

    if (!$subfield) {
        $tag = '035';
        $subfield = $record->subfield($tag, 'a');
    }

    return () unless $subfield;

    $match_auth_sth->execute($tag, $subfield);
    my $matches = $match_auth_sth->fetchall_arrayref;

    my @ids = map {$_->[0]} @$matches;
    $KU->announce('INFO', "Auth ${tag}a=$subfield matched records: @ids") 
        if $verbose && @ids;

    return @ids;
}

sub prepare_statements {

    $del_auth_sth = $KU->prepare_statement(<<"    SQL");
        DELETE FROM authority.record_entry WHERE id = ?
    SQL

    $delmod_auth_sth = $KU->prepare_statement(<<"    SQL");
        UPDATE authority.record_entry 
        SET edit_date = NOW() WHERE id = ?
    SQL

    $mod_bibs_sth = $KU->prepare_statement(<<"    SQL");
        UPDATE biblio.record_entry 
        SET marc = ?, edit_date = NOW() 
        WHERE id = ?
    SQL

    $mod_auth_sth = $KU->prepare_statement(<<"    SQL");
        UPDATE authority.record_entry 
        SET marc = ?, edit_date = NOW() 
        WHERE id = ?
    SQL

    $new_auth_sth = $KU->prepare_statement(<<"    SQL");
        INSERT INTO authority.record_entry (marc, last_xact_id) 
        VALUES (?, ?)
    SQL

    $match_auth_sth = $KU->prepare_statement(<<"    SQL");
        SELECT DISTINCT(rec.id)
        FROM authority.record_entry rec
            JOIN authority.full_rec frec ON (frec.record = rec.id)
        WHERE 
            NOT rec.deleted
            AND frec.tag = ? 
            AND frec.subfield = 'a' 
            AND frec.value = NACO_NORMALIZE(?, 'a')
    SQL

    $match_auth_001_sth = $KU->prepare_statement(<<"    SQL");
        SELECT DISTINCT(rec.id)
        FROM authority.record_entry rec
            JOIN authority.full_rec frec ON (frec.record = rec.id)
        WHERE 
            NOT rec.deleted
            AND frec.tag = '001' 
            AND frec.value = ?
    SQL
}

$KU->connect_db;
prepare_statements();
process_zip_file() if $zip_file;
process_marc_file($marc_file) if $marc_file;
$KU->disconnect_db;

