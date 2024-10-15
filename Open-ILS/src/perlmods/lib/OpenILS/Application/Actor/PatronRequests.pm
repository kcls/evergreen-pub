package OpenILS::Application::Actor::PatronRequests;
use strict; use warnings;
use base 'OpenILS::Application';
use OpenSRF::Utils::Logger q/$logger/;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor q/:funcs/;
use OpenILS::Utils::Fieldmapper;
use OpenSRF::Utils::JSON;
use OpenILS::Event;
use DateTime;
my $U = "OpenILS::Application::AppUtils";

my @REQ_FIELDS = qw/
    identifier
    format
    language
    title
    author
    pubdate
    publisher
    notes
    ill_opt_out
    id_matched
/; 

# "Books" whose publication date is older than this many years
# goes to ILL.
my $ILL_ROUTE_AGE_YEARS = 2;

# These format salways go to ILL.                                                     
my @ILL_FORMATS = ('microfilm', 'article');

sub apply_route_to {
    my ($request) = @_;

    # Avoid clobbering a route-to value which may have been applied
    # by staff.
    return if $request->route_to;

    my $route_to = 'acq';

    if ($request->format eq 'book' || $request->format eq 'large-print') {
        if ( (my $pubyear = $request->pubdate) ) {
            if ($pubyear =~ /^\d{4}$/) {
                if ($pubyear < (DateTime->now->year - $ILL_ROUTE_AGE_YEARS)) {
                    $route_to = 'ill';
                }
            }
        }
    } elsif (grep {$_ eq $request->format} @ILL_FORMATS) {
        $route_to = 'ill';
    }

    $request->route_to($route_to);
}

__PACKAGE__->register_method(
    method      => 'get_route_to',
    api_name    => 'open-ils.actor.patron-request.get_route_to',
    signature => {
        desc => q/Calculate the route-to value for a request/,
        params => [
            {desc => 'Patron authtoken', type => 'string'},
            {desc => 'Request', type => 'object'}
        ],
        return => {
            desc => q/Route to value/,
            type => 'string'
        }
    }
);

sub get_route_to {
    my ($self, $client, $auth, $request) = @_;
    my $e = new_editor(authtoken => $auth);

    return $e->event unless $e->checkauth;
    return $e->event unless $e->allowed('STAFF_LOGIN');

    apply_route_to($request);

    return $request->route_to;
}


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
    $request->requestor($e->requestor->id);

    for my $field (@REQ_FIELDS) {
        # Avoid propagating empty strings, esp for numeric values.
        $request->$field($values->{$field}) if $values->{$field};
    }

    apply_route_to($request);

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
            type => 'array'
        }
    }
);

__PACKAGE__->register_method (
    method      => 'get_requests',
    api_name    => 'open-ils.actor.patron-request.retrieve.all',
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
            type => 'array'
        }
    }
);


sub get_requests {
    my ($self, $client, $auth, $options) = @_;

    my $e = new_editor(authtoken => $auth);

    return $e->die_event unless $e->checkauth;
    return $e->die_event unless $e->allowed('OPAC_LOGIN');

    # We could also check the CREATE_PURCHASE_REQUEST permission
    # here, but for KCLS purposes the result would be the same.

    my $filter = {usr => $e->requestor->id};
    if ($self->api_name =~ /pending/) {
        $filter->{cancel_date} = undef;
        $filter->{complete_date} = undef;
    }

    my $requests = $e->search_actor_user_item_request([
        $filter, {order_by => {auir => 'create_date DESC'}}
    ]);

    return [
        map {
            {status => request_status_impl($e, $_), request => $_->to_bare_hash}
        } @$requests
    ];
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
    method      => 'request_status',
    api_name    => 'open-ils.actor.patron-request.status',
    signature => {
        desc => q/Get the status code for a request/,
        params => [
            {desc => 'Authtoken', type => 'string'},
            {desc => 'Request ID', type => 'number'}
        ],
        return => {
            desc => q/Status hash/,
            type => 'hash'
        }
    }
);

sub request_status {
    my ($self, $client, $auth, $req_id) = @_;
    my $e = new_editor(authtoken => $auth);

    return $e->die unless $e->checkauth;

    my $req = $e->retrieve_actor_user_item_request($req_id) 
        or return {status => 'not-found'};

    if ($req->usr ne $e->requestor->id) {
        # Patrons are allowed to see their own requests
        return $e->event unless $e->allowed('VIEW_USER');
    }

    return request_status_impl($e, $req);
}

sub request_status_impl {
    my ($e, $req) = @_;

    if ($req->complete_date) {
        return {status => 'completed'};
    }

    if ($req->reject_date) {
        if ($req->route_to eq 'ill') {
            return {
                status => 'ill-rejected',
                ill_denial => $req->ill_denial
            };
        } else {
            return {
                status => 'purchase-rejected',
                reject_reason => $req->reject_reason
            };
        }
    }

    # Hold placement is the final step.
    if ($req->hold) {
        my $hold = $e->retrieve_action_hold_request($req->hold)
            or return $e->die_event;

        if ($hold->shelf_time) {
            # If we're on the hold shelf but we have not yet been
            # marked as complete, go ahead and mark it while we're here.
            # Note complete_time check above.
            $req->complete_date($hold->shelf_time);
            my $e2 = new_editor(xact => 1);
            $e2->update_actor_user_item_request($req) or return $e2->die_event;
            $e2->commit;
            
            return {status => 'completed'}

        } elsif ($hold->cancel_time) {
            return {status => 'hold-canceled'};
        } else {
            return {status => 'hold-placed'};
        }
    }

    # TODO lineitem->state eq 'received' and hold canceled?

    # TODO patron-pending? staff have questions for the patron.

    if ($req->route_to eq 'acq') {
        if ($req->lineitem) {

            if (!$req->hold) {
                return {status => 'hold-failed'};
            }

            # NOTE the rest of this if block will never occur in 
            # practice, since the hold is placed at the same time
            # the lin item is linked to the request.  Keeping 
            # the code in place in case we change the behavior.
            my $li = $e->retrieve_acq_lineitem($req->lineitem) or return $e->die_event;

            if ($li->state eq 'on-order') {
                return {status => 'purchase-approved'};
            } else {
                return {status => 'purchase-review'};
            }

        } elsif ($req->claim_date) {
            return {status => 'purchase-review'};
        }

    } else { # ILL
        if ($req->illno) {
            return {status => 'ill-requested'};
        } elsif ($req->claim_date) {
            return {status => 'ill-review'};
        }
    }

    return {status => 'submitted'};
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

__PACKAGE__->register_method(
    method   => 'apply_lineitem',
    api_name => 'open-ils.actor.patron-request.lineitem.apply',
    signature => q/
        Sets the line item value of the request and creates the hold
        request.  This assumes line item assets have already been
        created.
    /
);

sub apply_lineitem {
    my ($self, $conn, $auth, $req_id, $lineitem_id) = @_;

    my $e = new_editor(authtoken => $auth, xact => 1);

    return $e->die_event unless $e->checkauth;
    return $e->die_event unless $e->allowed('MANAGE_USER_ITEM_REQUEST');

    my $lineitem = $e->retrieve_acq_lineitem($lineitem_id)
        or return $e->die_event;

    my $req = $e->retrieve_actor_user_item_request([
        $req_id,
        {flesh => 1, flesh_fields => {auir => ['usr']}}
    ]) or return $e->die_event;

    $logger->info("Linking lineitem $lineitem_id to user request $req_id");

    # Lineitem linked; now create the hold request.

    my $set = $e->search_actor_user_setting({
        usr => $req->usr->id,
        name => 'opac.default_pickup_location'
    })->[0];

    my $pickup_lib = $set ? 
        OpenSRF::Utils::JSON->JSON2perl($set->value) : $req->usr->home_ou;

    my $args = {
        patronid => $req->usr->id,
        pickup_lib => $pickup_lib,
        hold_type => 'T',
    };

    if (my $bre_id = $lineitem->eg_bib_id) {
        # Place a hold on the lineitem's bib record.

        my $resp = $U->simplereq(
            'open-ils.circ',
            'open-ils.circ.holds.test_and_create.batch',
             $auth, $args, [$bre_id]);

        if ($U->event_code($resp)) {

            $logger->info("User request $req_id hold placement failed: " . 
                OpenSRF::Utils::JSON->perl2JSON($resp));

        } else {

            $logger->info("User request $req_id successfully created hold");
            $req->hold(ref $resp ? $resp->{result} : $resp);

            # TODO action trigger event for user request hold placed.
            # see also apply_hold();
        }
    }

    $req->lineitem($lineitem_id);

    return $e->die_event unless $e->update_actor_user_item_request($req);

    $e->commit;

    return $req;
}

__PACKAGE__->register_method(
    method   => 'apply_hold',
    api_name => 'open-ils.actor.patron-request.hold.apply',
    signature => q/
        Link a hold ID to a patron request and create the notification events.
    /
);

sub apply_hold {
    my ($self, $conn, $auth, $req_id, $hold_id) = @_;

    my $e = new_editor(authtoken => $auth, xact => 1);

    return $e->die_event unless $e->checkauth;
    return $e->die_event unless $e->allowed('MANAGE_USER_ITEM_REQUEST');

    my $request = $e->retrieve_actor_user_item_request($req_id)
        or return $e->die_event;

    $request->hold($hold_id);

    # Will fail if the hold id is not valid.
    return $e->die_event unless $e->update_actor_user_item_request($request);

    $e->commit;

    # TODO create notice evens
    
    return 1;
}

__PACKAGE__->register_method(
    method   => 'search_dupes',
    api_name => 'open-ils.actor.patron-request.dupes.search',
    signature => {
        params => [
            {desc => 'Patron authtoken', type => 'string'},
            {desc => 'Patron ID / Optional', type => 'number'},
            {desc => 'Format', type => 'string'},
            {desc => 'Title', type => 'string'},
            {desc => 'Identifier', type => 'string'},
        ],
        desc => q/Search for duplicate requests for a give patron based on
            format and normalized title or identifier search./
    }
);

sub search_dupes {
    my ($self, $conn, $auth, $patron_id, $format, $title, $ident) = @_;

    my $e = new_editor(authtoken => $auth);

    return $e->die_event unless $e->checkauth;
    $patron_id ||= $e->requestor->id;

    if ($patron_id != $e->requestor->id) {
        return $e->event unless $e->allowed('MANAGE_USER_ITEM_REQUEST');
    }

    my $query = {
        select => {auir => ['id']},
        from => 'auir',
        where => {'+auir' => {format => $format}}
    };

    # Favor ident searches over title searches since they're more strict.
    my $field = $ident ? 'identifier' : 'title';
    my $value = $ident ? $ident : $title;

    # trim and lower
    $value =~ s/^\s+|\s+$//g;
    $value = lc($value);

    $query->{where}->{'+auir'}->{$field} = {"=" => {transform => 'lowercase', value => $value}};

    return $e->json_query($query)->[0] ? 1 : 0;
}





1;
