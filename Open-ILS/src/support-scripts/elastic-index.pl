#!/usr/bin/perl
use strict;
use warnings;
use Getopt::Long;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils::Logger qw/:logger/;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::CStoreEditor;
use OpenILS::Elastic::BibSearch;

my $lockfile;
my $batch_size = 500;
my $osrf_config = '/openils/conf/opensrf_core.xml';
my $cluster = 'main';
my @nodes;
my $index_class = 'bib-search';
my $bib_transform;
my $es_config_file;
my $create_index;
my $delete_index;
my $index_name;
my $activate_index;
my $populate;
my $index_record;
my $start_record;
my $stop_record;
my $modified_since;
my $created_since;
my $max_duration;
my $list_indices;
my $no_opensrf;
my $force;
my $help;

# Database settings read from ENV by default.
my $db_host = $ENV{PGHOST} || 'localhost';
my $db_port = $ENV{PGPORT} || 5432;
my $db_user = $ENV{PGUSER} || 'evergreen';
my $db_pass = $ENV{PGPASSWORD} || 'evergreen';
my $db_name = $ENV{PGDATABASE} || 'evergreen';
my $db_appn = 'Elastic Indexer';

GetOptions(
    'help'              => \$help,
    'osrf-config=s'     => \$osrf_config,
    'lockfile=s'        => \$lockfile,
    'cluster=s'         => \$cluster,
    'node=s'            => \@nodes,
    'create-index'      => \$create_index,
    'delete-index'      => \$delete_index,
    'index-name=s'      => \$index_name,
    'index-class=s'     => \$index_class,
    'index-record=s'    => \$index_record,
    'activate-index'    => \$activate_index,
    'start-record=s'    => \$start_record,
    'stop-record=s'     => \$stop_record,
    'modified-since=s'  => \$modified_since,
    'created-since=s'   => \$created_since,
    'max-duration=s'    => \$max_duration,
    'batch-size=s'      => \$batch_size,
    'bib-transform=s'   => \$bib_transform,
    'es-config-file=s'  => \$es_config_file,
    'list-indices'      => \$list_indices,
    'no-opensrf'        => \$no_opensrf,
    'force'             => \$force,
    'db-name=s'         => \$db_name,
    'db-host=s'         => \$db_host,
    'db-port=s'         => \$db_port,
    'db-user=s'         => \$db_user,
    'db-pass=s'         => \$db_pass,
    'db-appn=s'         => \$db_appn,
    'populate'          => \$populate
) || die "\nSee --help for more\n";

$index_name = "$index_class-$index_name" if $index_name;

sub help {
    print <<HELP;
        Synopsis:
            
            $0 --index-class bib-search --index-name bib-search-take-2 \
                --create-index --populate --activate-index

        Options:

            --osrf-config <file-path>

            --lockfile <path-to-file>
                Enables lock file controls over the process.  If unset,
                no lock file is created.

            --db-name <$db_name>
            --db-host <$db_host>
            --db-port <$db_port>
            --db-user <$db_user>
            --db-pass <PASSWORD>
            --db-appn <$db_appn>
                Database connection values.  This is the Evergreen database
                where values should be extracted for elastic search indexing.

                Beware that data loaded through Evergreen, e.g. elasticsearch
                configuration data, will be loaded from the DB used by the
                running Evergreen instance, regardless of these --db-*
                settings.

                Values default to their PG* environment variable equivalent.

            --no-opensrf
                Avoid connecting to OpenSRF.  Requires passing at least
                one --node.

            --bib-transform <path_to_file>
                Override the configured global config value for
                'elastic.bib_search.transform_file'

            --es-config-file <path_to_file>
                Override the default ES configuration XML file.

            --cluster <name>
                Specify a cluster name.  Defaults to 'main'.

            --node <URL> [repeatable]
                Override the configured ES nodes.

            --index-class <class>
                Specifies which data set the current index manages (e.g. bib-search)
                Must match a well-known index class with backing code.

            --index-name <name>
                The index name will be automatically prepended with the
                index class. e.g. "my-index" becomes "bib-search-my-index"
                on the backend for the "bib-search" index class.

            --delete-index
                Delete the specified index and all of its data. 

            --create-index
                Create an index whose name equals --index-name.

            --activate-index
                Activate the selected index while deactivating all other
                indexes of the same index_class and cluster.

            --batch-size <number>
                Index at most this many records per batch.
                Default is 500.

            --index-record <id>
                Index a specific record by identifier.

            --start-record <id>
                Start indexing at the record with this ID.

            --stop-record <id>
                Stop indexing after the record with this ID has been indexed.

            --modified-since <YYYY-MM-DD[Thh::mm:ss]>
                Index new records and reindex existing records whose last
                modification date falls after the date provided.  Use this
                at regular intervals to keep the ES-indexed data in sync 
                with the EG data.

            --created-since <YYYY-MM-DD[Thh::mm:ss]>
                Index new records whose create time falls after the date 
                provided.  

            --max-duration <duration>
                Stop indexing once the process has been running for this
                amount of time.

            --populate
                Populate the selected index with data.  If no filters
                are provided (e.g. --index-start-record) then all 
                applicable values will be indexed.

            --list-indices
                List all Elasticsearch indices represented in the 
                Evergreen database.

            --force
                Force various actions.

HELP
    exit(0);
}

help() if $help;

if ($lockfile) {

    die "I seem to be running already. If not remove $lockfile, try again\n" 
        if -e $lockfile;

    open(LOCK, ">$lockfile") or die "Cannot open lock file: $lockfile : $@\n";
    print LOCK $$ or die "Cannot write to lock file: $lockfile : $@\n";
    close LOCK;
}

# We only need to connect to opensrf to look up the nodes in the database.
# If the nodes are provided and --no-opensrf is set, avoid the connection
# and log to stdout.
if (@nodes && $no_opensrf) {
    $logger->set_log_stdout(1);
    $logger->set_log_level($logger->INFO);

} else {
    OpenSRF::System->bootstrap_client(config_file => $osrf_config);
    Fieldmapper->import(
        IDL => OpenSRF::Utils::SettingsClient->new->config_value("IDL"));
    OpenILS::Utils::CStoreEditor::init();
}

my $es;

if ($index_class eq 'bib-search') {
    $es = OpenILS::Elastic::BibSearch->new(
        db_name => $db_name,
        db_host => $db_host,
        db_port => $db_port,
        db_user => $db_user,
        db_pass => 'REDACTED',
        db_appn => $db_appn,
        cluster => $cluster, 
        nodes => \@nodes,
        xsl_file => $bib_transform,
        index_name => $index_name,
        maintenance_mode => 1,
        es_config_file => $es_config_file
    );
}

if (!$es) {
    die "Unknown index class: $index_class\n";
}

$es->connect;

if ($delete_index) {

    if (!$index_name) {
        die "Index name required\n";
    }

    if (!$force) {
        my $active = $es->active_index;
        if ($active && $active eq $index_name) {
            die "Index '$index_name' is active!  " . 
                "Use --force to delete an active index.\n";
        }
    }

    $es->delete_index or die "Index delete failed.\n";
}

if ($create_index) {

    if (!$index_name) {
        die "Index name required\n";
    }


    if ($index_name eq $index_class) {
        die "An index name cannot match its index_class [$index_class]\n";
    }

    $es->create_index or die "Index create failed.\n";
}

if ($populate) {

    my $settings = {
        index_record   => $index_record,
        start_record   => $start_record,
        stop_record    => $stop_record,
        modified_since => $modified_since,
        created_since  => $created_since,
        max_duration   => $max_duration,
        batch_size     => $batch_size
    };

    print "Commencing index populate with settings: " . 
        OpenSRF::Utils::JSON->perl2JSON($settings) . "\n";

    # Apply after logging $settings
    $settings->{db_pass} = $db_pass;

    $es->populate_index($settings) or die "Index populate failed.\n";
}

if ($activate_index) {
    $es->activate_index or die "Index activation failed.\n";
}

if ($list_indices) {
    my $indices = $es->indices;

    for my $name (keys %{$indices}) {
        my $index_def = $indices->{$name};

        my @aliases;
        if ($index_def) {
            @aliases = keys(%{$index_def->{$name}->{aliases}});
        } else {
            warn "ES has no index named $name\n";
        }

        print sprintf(
            "index_class=%s index_name=%s active=%s aliases=@aliases\n",
            $es->index_class, $name, 
            $es->index_is_active($name) ? 'yes' : 'no');
    }
}

unlink $lockfile if $lockfile;



