package OpenILS::Utils::KCLSScriptUtil;
# ---------------------------------------------------------------------
# Script utility functions.
#
# 1. Assumes a single DB connection per Perl process.
#
# 2. Keep imports at a minimum so utility scripts can be run from
#    non-Evergreen servers (e.g. beefy DB servers).
# ---------------------------------------------------------------------
use strict;
use warnings;
use DBI;
use DateTime;
use Sys::Syslog qw(syslog openlog);
my $KU = 'OpenILS::Utils::KCLSScriptUtil';

# ---------------------------------------------------------------------
# LOGGING
# ---------------------------------------------------------------------
our $syslog_facility = 'LOCAL6'; # matches Evergreen gateway
our $syslog_ops      = 'pid';
our $syslog_ident    = 'KCLSScriptUtil';
my  $syslog_opened   = 0;
my  $verbose         = 0;

sub syslog_facility { 
    my $cls = shift;
    my $val = shift;
    $syslog_facility = $val if defined $val;
    return $syslog_facility;
}

sub syslog_ops { 
    my $cls = shift;
    my $val = shift;
    $syslog_ops = $val if defined $val;
    return $syslog_ops;
}

sub syslog_ident { 
    my $cls = shift;
    my $val = shift;
    $syslog_ident = $val if defined $val;
    return $syslog_ident;
}

sub syslog_opened { 
    my $cls = shift;
    my $val = shift;
    $syslog_opened = $val if defined $val;
    return $syslog_opened;
}

sub verbose { 
    my $cls = shift;
    my $val = shift;
    $verbose = $val if defined $val;
    return $verbose;
}



# Send messages to syslog
# Send INFO, DEBUG messages to STDOUT if $verbose is true
# Send ERR, WARNING messages to STDERR
# Finishes with die() if $die is true
sub announce {
    my $cls = shift; # class ref; unused
    my $lvl = shift; # syslog level (minus the LOG_ part)
    my $msg = shift; # message string to log
    my $die = shift; # true if this should cause the script to die

    if (!$syslog_opened) {
        openlog($syslog_ident, $syslog_ops, $syslog_facility);
        $syslog_opened = 1;
    }

    syslog("LOG_$lvl", $msg);

    my $date_str = DateTime->now(time_zone => 'local')->strftime('%F %T');
    my $msg_str = "$date_str [$$] $lvl $msg\n";

    if ($die) {
        die $msg_str;
        return;
    }

    if ($lvl eq 'ERR' or $lvl eq 'WARNING') {
        # always copy problem messages to stdout
        warn $msg_str; # avoid dupe messages
    } else {
        print $msg_str if $verbose;
    }
}

# ---------------------------------------------------------------------
# DATABASE
# ---------------------------------------------------------------------
our $db_user = $ENV{PGUSER}     || 'evergreen';
our $db_name = $ENV{PGDATABASE} || 'evergreen';
our $db_host = $ENV{PGHOST}     || 'localhost';
our $db_port = $ENV{PGPORT}     || '5432';
our $db_pass = $ENV{PGPASSWORD};
our $db_handle;
our $db_handle_ops = 0;
our @db_statements;

sub connect_db {
    my $dsn = "dbi:Pg:db=$db_name;host=$db_host;port=$db_port";
    $KU->announce('DEBUG', "Connecting to DB $dsn");
    $db_handle_ops = 0;

    $db_handle = DBI->connect(
        #"$dsn;options='--statement-timeout=0'",
        $dsn,
        $db_user, $db_pass, { 
            RaiseError => 1,
            PrintError => 0,
            AutoCommit => 1,
            pg_expand_array => 0,
            pg_enable_utf8 => 1,
            Callbacks => {
                ChildCallbacks => {
                    # Track the number of execute() operations
                    execute => sub { $db_handle_ops++; return; }
                }
            } 
        }
    ) or $KU->announce('ERR', 
        "Connection to database failed: $DBI::err : $DBI::errstr", 1);

    return $db_handle;
}

sub db_handle {
    return $db_handle;
}

sub db_handle_ops {
    return $db_handle_ops;
}

sub disconnect_db {
    return unless $db_handle;
    $KU->announce('DEBUG', 'Disconnecting DB handle and cleaning up statements');
    $_->finish for @db_statements;
    $db_handle->disconnect;
    @db_statements = ();
}

sub reset_db_handle {
    $KU->announce('DEBUG', 'Resetting DB connection') if $db_handle;
    disconnect_db();
    connect_db();
}

sub prepare_statement {
    my ($cls, $sql) = @_;
    my $sth = $db_handle->prepare($sql);
    push(@db_statements, $sth);
    return $sth;
}


1;
