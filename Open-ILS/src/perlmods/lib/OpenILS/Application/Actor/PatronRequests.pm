package OpenILS::Application::Actor::PatronRequests;
use strict; use warnings;
use base 'OpenILS::Application';
use OpenSRF::Utils::Logger q/$logger/;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor q/:funcs/;
use OpenILS::Utils::Fieldmapper;
use OpenSRF::Utils::JSON;
use OpenILS::Event;
my $U = "OpenILS::Application::AppUtils";

my @REQ_FIELDS = qw/identifier format language title author pubdate publisher notes route_to/; 

__PACKAGE__->register_method(
    method      => 'create_request',
    api_name    => 'open-ils.actor.patron-request.create',
    signature => {
        desc => q/Create a new patron request./,
        params => [
            {desc => 'Patron authtoken', type => 'string'},
            {desc => 'Hash of request values.', type => 'hash'}
        ],
        return => {
            desc => q/
                Hash of results info, including the success status
                of the creation request and the ID of the newly created
                request.
                /,
            type => 'hash'
        }
    }
);

sub create_request {
    my ($self, $client, $auth, $values) = @_;

    return OpenILS::Event->new('BAD_PARAMS')
        unless ref $values eq 'HASH' && $values->{title};

    my $e = new_editor(xact => 1, authtoken => $auth);

    return $e->die_event unless $e->checkauth;
    return $e->die_event unless $e->allowed('OPAC_LOGIN');

    my $request = Fieldmapper::actor::user_item_request->new;
    $request->usr($e->requestor->id);

    for my $field (@REQ_FIELDS) {
        # Avoid propagating empty strings, esp for numeric values.
        $request->$field($values->{$field}) if $values->{$field};
    }

    $e->create_actor_user_item_request($request) or return $e->die_event;

    $e->commit;

    return {
        request_id => $request->id
    };

}

__PACKAGE__->register_method (
    method      => 'get_requests',
    api_name    => 'open-ils.actor.patron-request.retrieve.pending',
    signature => {
        desc => q/Return patron requests/,
        params => [
            {desc => 'Patron authtoken', type => 'string'},
            {desc => 'Hash of options.', type => 'hash'}
        ],
        return => {
            desc => q/
                List of patron requests.
                /,
            type => 'hash'
        }
    }
);

sub get_requests {
    my ($self, $client, $auth, $options) = @_;

    my $e = new_editor(authtoken => $auth);

    return $e->die_event unless $e->checkauth;
    return $e->die_event unless $e->allowed('OPAC_LOGIN');

    my $filter = {usr => $e->requestor->id};
    if ($self->api_name =~ /pending/) {
        $filter->{cancel_date} = undef;
        $filter->{complete_date} = undef;
    }

    my $requests = $e->search_actor_user_item_request([
        $filter, {order_by => {auir => 'create_date DESC'}}
    ]);

    return [ map { $_->to_bare_hash } @$requests ];
}

__PACKAGE__->register_method (
    method      => 'cancel_request',
    api_name    => 'open-ils.actor.patron-request.cancel',
    signature => {
        desc => q/Cancel a patron requests/,
        params => [
            {desc => 'Patron authtoken', type => 'string'},
            {desc => 'Request ID', type => 'number'}
        ],
        return => {
            desc => q/Event/,
            type => 'hash'
        }
    }
);

sub cancel_request {
    my ($self, $client, $auth, $req_id) = @_;
    my $e = new_editor(authtoken => $auth, xact => 1);

    return $e->die_event unless $e->checkauth;
    return $e->die_event unless $e->allowed('OPAC_LOGIN');

    my $req = $e->retrieve_actor_user_item_request($req_id)
        or return $e->die_event;

    # Only the request creator can cancel it.
    return OpenILS::Event->new('BAD_PARAMS') unless $req->usr eq $e->requestor->id;

    $req->cancel_date('now');

    $e->update_actor_user_item_request($req) or return $e->die_event;
    $e->commit;

    return OpenILS::Event->new('SUCCESS');
}

__PACKAGE__->register_method (
    method      => 'record_search',
    api_name    => 'open-ils.actor.patron-request.record.search',
    signature => {
        desc => q/Search for matching records/,
        params => [
            {desc => 'Patron authtoken', type => 'string'},
            {desc => 'Search Object', type => 'object'}
        ],
        return => {
            desc => q/List of matched records as hashes/,
            type => 'array'
        }
    }
);

sub record_search {
    my ($self, $client, $auth, $search) = @_;
    return [] unless $search;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;

    my $records = [];

    if (my $ident = $search->{identifier}) {

        # Start with a local catalog search.
        my $query = {
            size => 5,
            from => 0,
            sort => [{_score => "desc"}, {id => "desc"}],
            query => {
                bool => {
                    must => {
                        query_string => {
                            query => "id:$ident",
                        }
                    }
                }
            }
        };

        # .staff because we're not checking availability, just existence.
        my $results = $U->simplereq(
            'open-ils.search',
            'open-ils.search.elastic.bib_search.staff', 
            $query
        );


        my $bre_ids = [ map {$_->[0]} @{$results->{ids}} ];

        # Get the hashified attributes
        my $attrs = $U->get_bre_attrs($bre_ids, $e);

        if (@$bre_ids) {
            my $details = $U->simplereq(
                'open-ils.search',
                'open-ils.search.biblio.record.catalog_summary.staff.atomic',
                $U->get_org_tree->id,
                $bre_ids
            );

            for my $record (@$details) {
                $record->{source} = 'local';
                # Get the hash-ified attrs
                $record->{attributes} = $attrs->{$record->{id}};
                delete $record->{record};
                push(@$records, $record);
            }
        }
    }

    return $records;
}

__PACKAGE__->register_method(
    method   => 'create_allowed',
    api_name => 'open-ils.actor.patron-request.create.allowed',
    signature => q/
        Returns true if the user (by auth token) has permission
        to create item requests.
    /
);

sub create_allowed {
    my ($self, $conn, $auth, $org_id) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;

    my $user = $e->requestor;
    $org_id ||= $user->home_ou;

    my $penalties = $e->json_query({
        select => {ausp => ['id']},
        from => {ausp => 'csp'},
        where => {
            '+ausp' => {
                usr => $user->id,
                '-or' => [
                    {stop_date => undef},
                    {stop_date => {'>' => 'now'}}
                ],
                org_unit => $U->get_org_full_path($org_id),
            },
            '+csp' => {
                '-not' => {
                    '-or' => [
                        {block_list => ''},
                        {block_list => undef}
                    ]
                }
            }
        }
    });

    # As of writing, requests are allowed if the user can login
    # and has no blocking penalties.  (Note auth prevents login of 
    # barred accounts).
    return @$penalties == 0;
}

1;
