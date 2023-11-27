#!/usr/bin/perl
# ---------------------------------------------------------------
# Copyright © 2013,2014 Merrimack Valley Library Consortium
# Jason Stephenson <jstephenson@mvlc.org>
#
# Heavily modified by Bill Erickson
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# ---------------------------------------------------------------
# This guy parallelizes a reingest.
use strict;
use warnings;
use DBI;
use Getopt::Long;
use DateTime;
use Sys::Syslog qw(syslog openlog);

# Globals for the command line options: --

# You will want to adjust the next two based on your database size,
# i.e. number of bib records as well as the number of cores on your
# database server.  Using roughly number of cores/2 doesn't seem to
# have much impact in off peak times.
my $batch_size = 1000; # records processed per batch
my $max_child  = 2;   # max number of parallel worker processes

my $delay_dym;    # Delay DYM symspell dictionary reification.
my $skip_browse;  # Skip the browse reingest.
my $skip_attrs;   # Skip the record attributes reingest.
my $skip_search;  # Skip the search reingest.
my $skip_facets;  # Skip the facets reingest.
my $skip_display; # Skip the display reingest.
my $rebuild_rmsr; # Rebuild reporter.materialized_simple_record.
my $min_id;       # start processing at this bib ID.
my $max_id;       # stop processing when this bib ID is reached.
my $max_duration; # max processing duration in seconds
my $newest_first; # Process records in descending order of edit_date
my $sort_id_desc; # Sort by record ID descending
my $log_stdout;   # Clone log messages to stdout
my $help;         # show help text
my $record_attrs; # Record attributes for metabib.reingest_record_attributes.
my $week_batch;   # True if perfming a one-week reingest cycle

my $syslog_facility = 'LOCAL6'; # matches Evergreen gateway
my $syslog_ops      = 'pid';
my $syslog_ident    = 'pingest';

GetOptions(
    'batch-size=i'   => \$batch_size,
    'max-child=i'    => \$max_child,
    'delay-symspell' => \$delay_dym,
    'skip-browse'    => \$skip_browse,
    'skip-attrs'     => \$skip_attrs,
    'skip-search'    => \$skip_search,
    'skip-facets'    => \$skip_facets,
    'skip-display'   => \$skip_display,
    'rebuild-rmsr'   => \$rebuild_rmsr,
    'max-duration=i' => \$max_duration,
    'attr=s@'        => \$record_attrs,
    'min-id=i'       => \$min_id,
    'max-id=i'       => \$max_id,
    'newest-first'   => \$newest_first,
    'sort-id-desc'   => \$sort_id_desc,
    'log-stdout'     => \$log_stdout,
    'week-batch'     => \$week_batch,
    'help'           => \$help
);

sub help {
    print <<HELP;

    $0 --batch-size $batch_size --max-child $max_child \
        --min-id 1 --max-id 500000 --duration 14400

    --week-batch
        Process 1/7th of the bib records by limiting each run of this script
        to records whose ID falls in a dow matching the current day of the 
        week.

    --batch-size
        Number of records to process per batch

    --max-child
        Max number of worker processes

    --delay-symspell
        Delay reification of symspell dictionary entries
        This can provide a significant speedup for large ingests.
        NOTE:  This will cause concurrent, unrelated symspell
        updates to be delayed as well.  This is usually not a
        concern in an existing database as the dictionary is
        generally complete and only the details of use counts
        will change due to reingests and record inserts/updates.

    --skip-browse
    --skip-attrs
    --skip-search
    --skip-facets
    --skip-display
        Skip the selected reingest component

    --attr
        Specify a record attribute for ingest
        This option can be used more than once to specify multiple
        attributes to ingest.
        This option is ignored if --skip-attrs is also given.
    --rebuild-rmsr
        Rebuild the reporter.materialized_simple_record table.

    --sort-id-desc
        Process records in descending order of record ID.  This is a
        rough approximation of sorting by most recently created record
        first, but is better suited for multiple runs of the script,
        where batches of records are processed in ID groups.

    --newest-first
        During the initial bib record query, sort records by edit
        date in descending order, so that records more recently
        modified/created are processed before older records.
        This takes precedence over --sort-id-desc.

    --max-duration
        Stop processing after this many total seconds have passed.

    --min-id
        Only process records whose ID is equal to or greater than min-id.

    --max-id
        Only process records whose ID is equal to or less than max-id.

    --log-stdout
        Clone debug and error messages to STDOUT.  Beware that the 
        contents of 'print' calls from daemonized child process may not 
        reach STDOUT of the controlling terminal.

        All messages are logged to syslog.

    --help
        Show this help text.

HELP
    exit;
}

help() if $help;

openlog($syslog_ident, $syslog_ops, $syslog_facility);

# options for level match syslog options: DEBUG,INFO,WARNING,ERR
sub announce {
    my ($level, $msg, $die) = @_;
    syslog("LOG_$level", "$level $msg");

    my $date_str = DateTime->now(time_zone => 'local')->strftime('%F %T');
    my $msg_str = "$date_str [$$] $level $msg\n";

    if ($die) {
        die $msg_str;

    } else {
        if ($level eq 'ERR' or $level eq 'WARNING') {
            # always clone error messages to stdout
            warn $msg_str; # avoid dupe messages
        } elsif ($log_stdout) {
            print $msg_str;
        }
    }
}

announce('DEBUG', 
    "pingest starting with batch-size $batch_size and max_child $max_child");

my $where = "WHERE deleted = 'f'";
if ($min_id && $max_id) {
    $where .= " AND id BETWEEN $min_id AND $max_id";
} elsif ($min_id) {
    $where .= " AND id >= $min_id";
} elsif ($max_id) {
    $where .= " AND id <= $max_id";
}

my $order_by = 'ORDER BY ';
if ($newest_first) {
    $order_by .= 'edit_date DESC, id DESC';
} elsif ($sort_id_desc) {
    $order_by .= 'id DESC';
} else {
    $order_by .= 'id ASC';
}

# "Gimme the keys!  I'll drive!"
my $q = <<END_OF_Q;
SELECT id
FROM biblio.record_entry
$where
$order_by
END_OF_Q

# Stuffs needed for looping, tracking how many lists of records we
# have, storing the actual list of records, and the list of the lists
# of records.
my ($count, $lists, $records) = (0,0,[]);
my @lol = ();
# To do the browse-only ingest:
my @blist = ();

my $start_epoch = time;

sub duration_expired {
    return 1 if $max_duration && (time - $start_epoch) >= $max_duration;
    return 0;
}

# All of the DBI->connect() calls in this file assume that you have
# configured the PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD
# variables in your execution environment.  If you have not, you have
# two options:
#
# 1) configure them
#
# 2) edit the DBI->connect() calls in this program so that it can
# connect to your database.
my $dbh = DBI->connect('DBI:Pg:');
my $dow_start_pos = 0;
my $dow_end_pos;

# When processing a week batch, first find the dow cut-off boundaries
if ($week_batch) {
    my $count_query = "SELECT COUNT(id) FROM biblio.record_entry $where";
    my $result = $dbh->selectall_arrayref($count_query);
    my $bib_count = $result->[0][0];
    my $buk_size = int($bib_count / 7);
    my $dow = DateTime->now->day_of_week - 1; # Monday is 1
    my $day = 0;
    while ($day <= $dow) {
        $dow_start_pos = $day * $buk_size;
        $dow_end_pos = $dow_start_pos + $buk_size;
        $day++;
    }

    announce('INFO', "Processing bib ID dow start_pos=$dow_start_pos ".
        "to end_pos=$dow_end_pos");
}

my $results = $dbh->selectall_arrayref($q);
my $week_counter = -1;
foreach my $r (@$results) {

    if ($week_batch) {
        $week_counter++;
        if ($week_counter < $dow_start_pos ||
            $week_counter > $dow_end_pos) {
            # In weekly batch mode ignore records that do not fall in the
            # day-of-week dow.
            next;
        }
    }

    my $record = $r->[0];
    push(@blist, $record); # separate list of browse-only ingest
    push(@$records, $record);
    if (++$count == $batch_size) {
        $lol[$lists++] = $records;
        $count = 0;
        $records = [];
    }
}
$lol[$lists++] = $records if ($count); # Last batch is likely to be small.
$dbh->disconnect();

announce('INFO', 'Processing '.scalar(@blist).' bib records');

# We're going to reuse $count to keep track of the total number of
# batches processed.
$count = 0;

# Disable inline reification of symspell data during the main ingest process
if ($delay_dym) {
    my $dbh = DBI->connect("DBI:Pg:database=$db_db;host=$db_host;port=$db_port;application_name=pingest",
                           $db_user, $db_password);
    $dbh->do('SELECT search.disable_symspell_reification()');
    $dbh->disconnect();
}

# @running keeps track of the running child processes.
my @running = ();

# We start the browse-only ingest before starting the other ingests.
browse_ingest(@blist) unless ($skip_browse);

# We loop until we have processed all of the batches stored in @lol
# or the maximum processing duration has been reached.
my $last_record;
while ($count < $lists) {
    my $duration_expired = duration_expired();

    if (scalar(@lol) && scalar(@running) < $max_child && !$duration_expired) {
        # Reuse $records for the lulz.
        $records = shift(@lol);
        $last_record = $records->[-1];
        if ($skip_search && $skip_facets && $skip_attrs && $skip_display) {
            $count++;
        } else {
            reingest($records);
        }
    } else {
        my $pid = wait();
        if (grep {$_ == $pid} @running) {
            @running = grep {$_ != $pid} @running;
            $count++;
            announce('DEBUG', "reingest() processed $count of ".
                "$lists batches; last record = $last_record");
        }
    }

    if ($duration_expired && scalar(@running) == 0) {
        announce('INFO', 
            "reingest() stopping on $last_record at max duration");
        exit(0);
    }
}

# Incorporate symspell updates if they were delayed
symspell_reification() if ($delay_dym);

# Rebuild reporter.materialized_simple_record after the ingests.
rmsr_rebuild() if ($rebuild_rmsr);

# This sub should be called at the end of the run if symspell updates
# were delayed using the --delay-dym command line flag.
sub symspell_reification {
    my $dbh = DBI->connect("DBI:Pg:database=$db_db;host=$db_host;port=$db_port;application_name=pingest",
                           $db_user, $db_password);
    $dbh->do('SELECT search.enable_symspell_reification()');
    $dbh->do('SELECT search.symspell_dictionary_full_reify()');

    # There might be a race condition above if non-pingest record updates
    # were started before the first of the two statements above, but ended
    # after the second one, so we'll wait a few seconds and then look again.
    sleep(5);

    # This count will always be 0 when symspell reification is done inline
    # rather than delayed, because it is handled by a trigger that runs
    # inside the transaction that causes inline reification.
    my ($recheck) = $dbh->selectrow_array('SELECT COUNT(*) FROM search.symspell_dictionary_updates');
    $dbh->do('SELECT search.symspell_dictionary_full_reify()') if ($recheck);
    $dbh->disconnect();
}

# This subroutine forks a process to do the browse-only ingest on the
# @blist above.  It cannot be parallelized, but can run in parrallel
# to the other ingests.
sub browse_ingest {
    my @list = @_;
    my $pid = fork();
    if (!defined($pid)) {
        die "failed to spawn child";
    } elsif ($pid > 0) {
        # Add our browser to the list of running children.
        push(@running, $pid);
        # Increment the number of lists, because this list was not
        # previously counted.
        $lists++;
    } elsif ($pid == 0) {
        my $dbh = DBI->connect('DBI:Pg:');
        my $sth = $dbh->prepare(<<SQL);
SELECT metabib.reingest_metabib_field_entries(
    bib_id := ?, 
    skip_facet := TRUE, 
    skip_browse := FALSE, 
    skip_search := TRUE, 
    skip_display := TRUE
)
SQL
        my $total = scalar(@list);
        my $count = 0;
        foreach (@list) {
            if ($sth->execute($_)) {
                my $crap = $sth->fetchall_arrayref();
            } else {
                announce('WARNING', "Browse ingest failed for record $_");
            }
            if (duration_expired()) {
                announce('INFO', 
                    "browse_ingest() stopping on record $_ on max duration");
                last;
            }

            announce('DEBUG', "browse_ingest() processed $count ".
                "of $total records; last record = $_") 
                if ++$count % $batch_size == 0;
        }
        $dbh->disconnect();
        exit(0);
    }
}

# Fork a child to do the other reingests:

sub reingest {
    my $list = shift;
    my $pid = fork();
    if (!defined($pid)) {
        die "Failed to spawn a child";
    } elsif ($pid > 0) {
        push(@running, $pid);
    } elsif ($pid == 0) {
        my $dbh = DBI->connect('DBI:Pg:');
        reingest_attributes($dbh, $list) unless ($skip_attrs);
        reingest_field_entries($dbh, $list) 
            unless ($skip_facets && $skip_search && $skip_display);
        $dbh->disconnect();
        exit(0);
    }
}

# Reingest metabib field entries on a list of records.
sub reingest_field_entries {
    my $dbh = shift;
    my $list = shift;
    my $sth = $dbh->prepare(<<SQL);
SELECT metabib.reingest_metabib_field_entries(
    bib_id := ?, 
    skip_facet := ?, 
    skip_browse := TRUE, 
    skip_search := ?, 
    skip_display := ?
)
SQL
    # Because reingest uses "skip" options we invert the logic of do variables.
    $sth->bind_param(2, ($skip_facets) ? 1 : 0);
    $sth->bind_param(3, ($skip_search) ? 1 : 0);
    $sth->bind_param(4, ($skip_display) ? 1: 0);
    foreach (@$list) {
        $sth->bind_param(1, $_);
        if ($sth->execute()) {
            my $crap = $sth->fetchall_arrayref();
        } else {
            announce('WARNING', 
                "metabib.reingest_metabib_field_entries failed for record $_");
        }
    }
}

# Reingest record attributes on a list of records.
sub reingest_attributes {
    my $dbh = shift;
    my $list = shift;
    my $sth = $dbh->prepare(<<END_OF_INGEST
SELECT metabib.reingest_record_attributes(rid := id, prmarc := marc, pattr_list := ?, rdeleted := deleted)
FROM biblio.record_entry
WHERE id = ?
END_OF_INGEST
    );
    $sth->bind_param(1, $record_attrs);
    foreach (@$list) {
        $sth->bind_param(2, $_);
        if ($sth->execute()) {
            my $crap = $sth->fetchall_arrayref();
        } else {
            announce('WARNING', 
                "metabib.reingest_record_attributes failed for record $_");
        }
    }
}

# Rebuild/refresh reporter.materialized_simple_record
#sub rmsr_rebuild {
    #print("Rebuilding reporter.materialized_simple_record\n");
    #my $dbh = DBI->connect("DBI:Pg:database=$db_db;host=$db_host;port=$db_port;application_name=pingest",
                           #$db_user, $db_password);
    #$dbh->selectall_arrayref("SELECT reporter.refresh_materialized_simple_record();");
    #$dbh->disconnect();
#}
