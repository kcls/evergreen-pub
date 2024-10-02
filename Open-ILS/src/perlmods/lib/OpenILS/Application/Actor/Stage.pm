package OpenILS::Application::Actor::Stage;
use strict; use warnings;
use base 'OpenILS::Application';
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor q/:funcs/;
use OpenSRF::Utils::Logger q/$logger/;
use OpenILS::Utils::Fieldmapper;
my $U = "OpenILS::Application::AppUtils";


__PACKAGE__->register_method (
    method      => 'create_user_stage',
    api_name    => 'open-ils.actor.user.stage.create',
    signature => {
        desc => q/
            Creates a new pending user account including addresses, statcats, and
            settings.
            Users are added to staging tables pending staff review.
        /,
        params => [
            {desc => 'user', type => 'object', class => 'stgu'},
            {desc => 'Mailing address.  Optional', type => 'object', class => 'stgma'},
            {desc => 'Billing address.  Optional', type => 'object', class => 'stgba'},
            {desc => 'Statcats.  Optional.  This is an array of "stgsc" objects', type => 'array'},
            {desc => 'Settings.  Optional.  This is an array of "stgs" objects', type => 'array'},
        ],
        return => {
            desc => 'username on success, Event on error',
            type => ''
        }

    }
);

sub create_user_stage {
    my($self, $conn, $user, $mail_addr, $bill_addr, $statcats, $settings) = @_; # more?

    return OpenILS::Event->new('BAD_PARAMS') unless $user;
    return 0 unless $U->ou_ancestor_setting_value($user->home_ou, 'opac.allow_pending_user');

    my $e = new_editor(xact => 1);

    my $uname = $user->usrname || $U->create_uuid_string;
    $user->usrname($uname);

    # see if this username is already taken
    return OpenILS::Event->new('USERNAME_EXISTS') if
        $e->search_staging_user_stage({usrname => $uname})->[0];

    $e->create_staging_user_stage($user) or return $e->die_event;

    if($mail_addr) {
        $mail_addr->usrname($uname);
        $e->create_staging_mailing_address_stage($mail_addr) or return $e->die_event;
    }

    if($bill_addr) {
        $bill_addr->usrname($uname);
        $e->create_staging_billing_address_stage($bill_addr) or return $e->die_event;
    }

    if($statcats) {
        foreach (@$statcats) {
            $_->usrname($uname);
            $e->create_staging_statcat_stage($_) or return $e->die_event;
        }
    }

    if($settings) {
        foreach (@$settings) {
            $_->usrname($uname);
            $e->create_staging_setting_stage($_) or return $e->die_event;
        }
    }

    $e->commit;
    $conn->respond_complete($uname);

    $U->create_events_for_hook('stgu.created', $user, $user->home_ou);
    return undef;
}

__PACKAGE__->register_method (
    method      => 'user_stage_by_org',
    api_name    => 'open-ils.actor.user.stage.retrieve.by_org',
    stream      => 1
);

sub user_stage_by_org {
    my($self, $conn, $auth, $org_id, $limit, $offset) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;
    $org_id ||= $e->requestor->ws_ou;
    if (ref $org_id eq 'ARRAY') {
        return $e->event unless $e->allowed('VIEW_USER');
    } else {
        return $e->event unless $e->allowed('VIEW_USER', $org_id);
    }

    $limit ||= 1000;
    $offset ||= 0;

    my $stage_ids = $e->search_staging_user_stage(
        [
            {   home_ou => $org_id, complete => 'f'}, 
            {   limit => $limit, 
                offset => $offset, 
                order_by => {stgu => 'row_date DESC'}
            }
        ],
        {idlist => 1}
    );

    $conn->respond(flesh_user_stage($e, $_)) for @$stage_ids;
    return undef;
}

sub flesh_user_stage {
    my($e, $row_id) = @_;
    my $user = $e->retrieve_staging_user_stage($row_id) or return undef;
    return {
        user => $user,
        billing_addresses => $e->search_staging_billing_address_stage({usrname => $user->usrname}),
        mailing_addresses => $e->search_staging_mailing_address_stage({usrname => $user->usrname}),
        cards => $e->search_staging_card_stage({usrname => $user->usrname}),
        statcats => $e->search_staging_statcat_stage({usrname => $user->usrname}),
        settings => $e->search_staging_setting_stage({usrname => $user->usrname}),
    };
}


__PACKAGE__->register_method (
    method      => 'user_stage_by_uname',
    api_name    => 'open-ils.actor.user.stage.retrieve.by_username',
);

sub user_stage_by_uname {
    my($self, $conn, $auth, $username) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;

    my $user = $e->search_staging_user_stage({
        usrname => $username, 
        complete => 'f'
    })->[0] or return $e->event;

    return $e->event unless $e->allowed('VIEW_USER', $user->home_ou);
    return flesh_user_stage($e, $user->row_id);
}




__PACKAGE__->register_method (
    method      => 'delete_user_stage', 
    api_name    => 'open-ils.actor.user.stage.delete',
);

sub delete_user_stage {
    my($self, $conn, $auth, $row_id) = @_;

    my $e = new_editor(authtoken => $auth, xact => 1);
    return $e->die_event unless $e->checkauth;
    my $data = flesh_user_stage($e, $row_id) or return $e->die_event;

    return $e->die_event unless $e->allowed('UPDATE_USER', $data->{user}->home_ou);

    $e->delete_staging_user_stage($data->{user}) or return $e->die_event;

    for my $addr (@{$data->{mailing_addresses}}) {
        $e->delete_staging_mailing_address_stage($addr) or return $e->die_event;
    }

    for my $addr (@{$data->{billing_addresses}}) {
        $e->delete_staging_billing_address_stage($addr) or return $e->die_event;
    }

    for my $card (@{$data->{cards}}) {
        $e->delete_staging_card_stage($card) or return $e->die_event;
    }

    for my $statcat (@{$data->{statcats}}) {
        $e->delete_staging_statcat_stage($statcat) or return $e->die_event;
    }

    for my $setting (@{$data->{settings}}) {
        $e->delete_staging_setting_stage($setting) or return $e->die_event;
    }

    $e->commit;
    return 1;
}

__PACKAGE__->register_method (
    method      => 'search_user_stage',
    api_name    => 'open-ils.actor.user.stage.search',
    signature => {
        desc => 'Performs a keyword search for staged (pending) users',
        params => [
            {desc => 'authtoken', type => 'string'},
            {desc => 'query', type => 'object'},
        ],
        return => {
            desc => 'Stream of matched stage user objects',
        }

    }
);

sub search_user_stage {
    my ($self, $client, $auth, $org_id, $query) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;

    $org_id ||= $e->requestor->ws_ou;
    return $e->event unless $e->allowed('VIEW_USER', $org_id);

    $query = {} unless ref $query eq 'HASH';

    my $keywords = $query->{keywords} || '';

    # Scrub the input so it plays nicely with like searches, etc.
    $keywords =~ s/[^\w\s\.'-@]//g;

    my @term_groups;
    for my $term (split(/\s+/, $keywords)) {
        my @field_term_matches;
        for my $field (qw/first_given_name second_given_name family_name day_phone email/) {
            push(@field_term_matches, {$field => {ilike => "$term%"}});
        }
        push(@term_groups, {'-or' => \@field_term_matches});
    }

    return OpenILS::Event->new('BAD_PARAMS') unless @term_groups;

    my $search = {
        home_ou => {
            in => {
                select => {aou => [{
                    column => 'id', 
                    transform => 'actor.org_unit_descendants', 
                    result_field => 'id'
                }]},
                from => 'aou',
                where => {id => $org_id}
            }
        },
        '-and' => \@term_groups
    };

    # TODO support paging
    my $users = $e->search_staging_user_stage([
        $search, 
        {limit => 500, order_by => {stgu => 'family_name ASC'}}
    ]);

    $client->respond(flesh_user_stage($e, $_)) for map { $_->row_id } @$users;

    undef
}



1;

