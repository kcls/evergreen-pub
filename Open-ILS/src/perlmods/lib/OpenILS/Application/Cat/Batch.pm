package OpenILS::Application::Cat::Batch;
use base qw/OpenILS::Application/;
use strict; use warnings;

use DateTime;
use MARC::Record;
use MARC::File::XML (BinaryEncoding => 'utf8', RecordFormat => 'UNIMARC');
use Text::Diff;

use OpenSRF::Utils::Logger qw($logger);
use OpenILS::Utils::CStoreEditor q/:funcs/;
use OpenILS::Utils::MARCBreaker;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Const qw/:const/;
use OpenILS::Event;

my $U = 'OpenILS::Application::AppUtils';
my $MARC_NAMESPACE = 'http://www.loc.gov/MARC21/slim';

__PACKAGE__->register_method(
    method    => 'marc_batch_update',
    api_name  => 'open-ils.cat.biblio.marc.batch_update',
    stream    => 1,
    max_bundle_count => 1,
    signature => {
        desc   => q/MARC Batch Updater/,
        params => [
            {desc => 'Auth Token', type => 'string'},
            {desc => 'Options Hash', type => 'hash'}
        ],
        return => {
            desc => 'Stream of MARC URL objects, one collection object per record',
            type => 'object'
        }
    }
);

sub marc_batch_update {
    my ($self, $client, $auth, $options) = @_;
    $options ||= {};

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;
    return $e->event unless $e->allowed('ADMIN_MARC_BATCH');

    my $record_id = $options->{record_id};
    my $bucket_id = $options->{bucket_id};

    my @rec_ids = ($record_id);

    if (!$record_id) {
        my $ids = $e->json_query({
            select => {cbrebi => ['target_biblio_record_entry']},
            from => 'cbrebi',
            where => {bucket => $bucket_id}
        });

        @rec_ids = map {$_->{target_biblio_record_entry}} @$ids;
    }

    my $resp = {
        progress => 0,
        modified => 0,
        complete => 0,
        bucket_id => $bucket_id,
        total => scalar(@rec_ids)
    };

    $client->respond($resp);

    for my $rec_id (@rec_ids) {
        my $evt = batch_process_one($client, $e, $rec_id, $resp, $options);
        return $evt if $evt;
    }

    $resp->{complete} = 1;

    return $resp;
}

sub batch_process_one {
    my ($client, $e, $record_id, $resp, $options) = @_;

    my $rec = $e->retrieve_biblio_record_entry($record_id);

    my $marc_doc = MARC::Record->new_from_xml($rec->marc);

    my $breaker = my $breaker_before = 
        OpenILS::Utils::MARCBreaker->to_breaker($marc_doc);

    my $breaker_after = perform_search_replace(
        $breaker, $options->{search}, $options->{replace});

    $resp->{progress}++;
    $resp->{record_id} = $record_id;
    $resp->{breaker_before} = $breaker_before;
    $resp->{breaker_after} = $breaker_after;
    $resp->{record_modified} = undef;

    if ($breaker_after eq $breaker_before) {
        # No changes applied by the search/replace rule.  All done
        # with this record.
        $client->respond($resp);
        return;
    }

    $logger->info("MB modified record $record_id");

    $resp->{record_modified} = 1;
    $resp->{modified}++;

    if ($options->{apply}) {
        $logger->info("MB applying changes to record $record_id");

        eval { $marc_doc = OpenILS::Utils::MARCBreaker->from_breaker($breaker_after) };

        if ($@) {
            return OpenILS::Event->new('REGEX_FAILED',
                desc => "The regular expression produced an unusable MARC record: $@");
        }

        $rec->marc($U->entityize($marc_doc->as_xml_record('USMARC')));
        $rec->edit_date('now');
        $rec->editor($e->requestor->id);

        # Each record is processed within its own transaction so we can
        # avoid long-running transactions that might lock rows.
        $e->xact_begin;
        $e->update_biblio_record_entry($rec) or return $e->die_event;
        $e->commit;

    } else {

        # Only return the diff for dry-run (non-apply) api variants.
        $resp->{diff} = diff(\$breaker_before, \$breaker_after, {STYLE => 'Unified'});
    }

    $client->respond($resp);

    return;
}

sub perform_search_replace {
    my ($breaker, $search, $replace) = @_;

    return $breaker unless $search && defined $replace;

    $replace = '"' . $replace . '"'; # for eval
    $breaker =~ s/$search/$replace/gmee;

    # Remove empty lines
    $breaker =~ s/(^|\n)[\n\s]*/$1/g;

    return $breaker;
}


__PACKAGE__->register_method(
    method    => 'marc_batch_record_count',
    api_name  => 'open-ils.cat.biblio.marc.batch_update.record_count',
    stream    => 1,
    max_bundle_count => 1,
    signature => {
        desc   => q/Returns the number of records linked to a bucket/,
        params => [
            {desc => 'Auth Token', type => 'string'},
            {desc => 'Bucket ID', type => 'number'},
        ],
        return => {
            desc => 'Count of records',
            type => 'number'
        }
    }
);

sub marc_batch_record_count {
    my ($self, $client, $auth, $bucket_id) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;
    return $e->event unless $e->allowed('ADMIN_MARC_BATCH');

    my $count = $e->json_query({
        select => {cbrebi => [{column => 'id', transform => 'count', aggregate => 1}]},
        from => 'cbrebi',
        where => {bucket => $bucket_id}
    })->[0];

    return $count->{id};
}


1;

