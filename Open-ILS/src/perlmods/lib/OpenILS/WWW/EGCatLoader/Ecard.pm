package OpenILS::WWW::EGCatLoader;
use strict; use warnings;
use Apache2::Const -compile => qw(OK FORBIDDEN HTTP_INTERNAL_SERVER_ERROR);
use JSON;
use OpenSRF::Utils::Logger qw/$logger/;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils qw/:datetime/;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Event;
use Data::Dumper;
use LWP::UserAgent;
use OpenILS::Utils::KCLSNormalize;
use DateTime;
use Digest::MD5 qw(md5_hex);
$Data::Dumper::Indent = 0;
my $U = 'OpenILS::Application::AppUtils';


my $PROVISIONAL_ECARD_GRP = 951;
my $FULL_ECARD_GRP = 952;
my $ECARD_VERIFY_IDENT = 102;

my @api_fields = (
    {name => 'vendor_username', required => 1},
    {name => 'vendor_password', required => 1},
    {name => 'first_given_name', class => 'au', required => 1},
    {name => 'second_given_name', class => 'au'},
    {name => 'family_name', class => 'au', required => 1},
    {name => 'pref_first_given_name', class => 'au'},   # Legal Name
    {name => 'pref_second_given_name', class => 'au'},  # Legal Name
    {name => 'pref_family_name', class => 'au'},        # Legal Name
    {name => 'email', class => 'au', required => 1},
    {name => 'passwd', class => 'au', required => 1},
    {name => 'day_phone', class => 'au', required => 1},
    {name => 'dob', class => 'au', required => 1},
    {name => 'home_ou', class => 'au', required => 1},
    {name => 'ident_value2', 
     class => 'au', 
     notes => "AKA parent/guardian",
     required_if => 'Patron is less than 18 years old'
    },
    {name => 'billing_street1', class => 'aua', required => 1},
    {name => 'billing_street1_name'},
    {name => 'billing_street2', class => 'aua'},
    {name => 'billing_city', class => 'aua', required => 1},
    {name => 'billing_post_code', class => 'aua', required => 1},
    {name => 'billing_county', class => 'aua', required => 1},
    {name => 'billing_state', class => 'aua', required => 1},
    {name => 'billing_country', class => 'aua', required => 1},
    {name => 'mailing_street1', class => 'aua'},
    {name => 'mailing_street1_name'},
    {name => 'mailing_street2', class => 'aua'},
    {name => 'mailing_city', class => 'aua'},
    {name => 'mailing_post_code', class => 'aua'},
    {name => 'mailing_county', class => 'aua'},
    {name => 'mailing_state', class => 'aua'},
    {name => 'mailing_country', class => 'aua'},
    {name => 'events_mailing', class => 'asc'},
    {name => 'foundation_mailing', class => 'asc'}
);

# Random 6-character alpha-numeric code that avoids look-alike characters
# https://ux.stackexchange.com/questions/53341/are-there-any-letters-numbers-that-should-be-avoided-in-an-id
# Also exclude vowels to avoid creating any real (potentially offensive) words.
my @code_chars = ('C','D','F','H','J'..'N','P','R','T','V','W','X','3','4','7','9');
sub generate_verify_code {
    my $string = '';
    $string .= $code_chars[rand @code_chars] for 1..6;
    return $string;
}

sub load_ecard_form {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;

    $self->collect_header_footer;
    return Apache2::Const::OK;
}


sub load_ecard_verify {
    my $self = shift;
    my $cgi = $self->cgi;
    $self->collect_header_footer;

    # Loading the form.
    return Apache2::Const::OK if $cgi->request_method eq 'GET';

    $self->verify_ecard;
    return Apache2::Const::OK;
}

sub verify_ecard {
    my $self = shift;
    my $cgi = $self->cgi;
    my $ctx = $self->ctx;
    $self->log_params;

    my $verify_code = $ctx->{verify_code} = $cgi->param('verification_code');
    my $barcode = $ctx->{barcode} = $cgi->param('barcode');

    $ctx->{verify_failed} = 1;

    my $e = new_editor();

    my $au = $e->search_actor_user({
        profile => $PROVISIONAL_ECARD_GRP,
        ident_type => $ECARD_VERIFY_IDENT,
        ident_value => $verify_code
    })->[0];

    if (!$au) {
        $logger->warn(
            "ECARD: No provisional ecard found with code $verify_code");
        sleep 2; # Mitigate brute-force attacks
        return;
    }

    my $card = $e->search_actor_card({
        usr => $au->id,
        barcode => $barcode
    })->[0];

    if (!$card) {
        $logger->warn("ECARD: Failed to match verify code ".
            "($verify_code) with provided barcode ($barcode)");
        sleep 2; # Mitigate brute-force attacks
        return;
    }

    # Verification looks good.  Update the account.

    my $grp = new_editor()->retrieve_permission_grp_tree($FULL_ECARD_GRP);

    $au->profile($grp->id);
    $au->expire_date(
        DateTime->now(time_zone => 'local')->add(
            seconds => interval_to_seconds($grp->perm_interval))->iso8601()
    );

    $e->xact_begin;

    unless ($e->update_actor_user($au)) {
        $logger->error("ECARD update failed for $barcode: " . $e->die_event);
        return;
    }
    
    $e->commit;
    $logger->info("ECARD: Update to full ecard succeeded for $barcode");

    $ctx->{verify_success} = 1;
    $ctx->{verify_failed} = 0;

    return;
}


sub log_params {
    my $self = shift;
    my $cgi = $self->cgi;
    my @params = $cgi->param;

    my $msg = '';
    for my $p (@params) {
        next if $p =~ /pass/;
        $msg .= "|" if $msg; 
        $msg .= "$p=".$cgi->param($p);
    }

    $logger->info("ECARD: Submit params: $msg");
}

sub handle_testmode_api {
    my $self = shift;
    my $ctx = $self->ctx;

    # Strip data we don't want to publish.
    my @doc_fields;
    for my $field_info (@api_fields) {
        my $doc_info = {};
        for my $info_key (keys %$field_info) {
            $doc_info->{$info_key} = $field_info->{$info_key} 
                unless $info_key eq 'class';
        }
        push(@doc_fields, $doc_info);
    }

    $ctx->{response}->{messages} = [fields => \@doc_fields];
    $ctx->{response}->{status} = 'API_OK';
    return $self->compile_response;
}

sub handle_datamode_api {
    my $self = shift;
    my $datamode = shift;
    my $ctx = $self->ctx;

    if ($datamode =~ /org_units/) {
        my $orgs = new_editor()->search_actor_org_unit({opac_visible => 't'});
        my $list = [
            map { 
                {name => $_->name, id => $_->id, parent_ou => $_->parent_ou} 
            } @$orgs
        ];
        $ctx->{response}->{messages} = [org_units => $list];
    }

    $ctx->{response}->{status} = 'DATA_OK';
    return $self->compile_response;
}


sub load_ecard_submit {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;

    $self->log_params;

    my $testmode = $cgi->param('testmode') || '';
    my $datamode = $cgi->param('datamode') || '';

    my $e = $ctx->{editor} = new_editor();
    $ctx->{response} = {messages => []};

    if ($testmode eq 'CONNECT') {
        $ctx->{response}->{status} = 'CONNECT_OK';
        return $self->compile_response;
    }

    return Apache2::Const::FORBIDDEN unless 
        $cgi->request_method eq 'POST' &&
        $self->verify_vendor_host &&
        $self->login_vendor;

    if ($testmode eq 'AUTH') {
        # If we got this far, the caller is authorized.
        $ctx->{response}->{status} = 'AUTH_OK';
        return $self->compile_response;
    }

    return $self->handle_testmode_api if $testmode eq 'API';
    return $self->handle_datamode_api($datamode) if $datamode;

    return $self->compile_response unless $self->make_user;
    return $self->compile_response unless $self->add_billing_address;
    return $self->compile_response unless $self->add_mailing_address;
    return $self->compile_response unless $self->add_stat_cats;
    return $self->compile_response unless $self->check_dupes;
    return $self->compile_response unless $self->add_card;
    return $self->compile_response unless $self->save_user;
    return $self->compile_response unless $self->apply_settings;
    return $self->compile_response if $ctx->{response}->{status};

    $U->create_events_for_hook(
        'au.create.ecard', $ctx->{user}, $ctx->{user}->home_ou);

    $ctx->{response}->{status} = 'OK';
    $ctx->{response}->{barcode} = $ctx->{user}->card->barcode;

    return $self->compile_response;
}

# E-card vendor is not a regular account.  They must have an entry in 
# the password table with password type ecard_vendor.
sub login_vendor {
    my $self = shift;
    my $username = $self->cgi->param('vendor_username');
    my $password = $self->cgi->param('vendor_password');

    my $e = new_editor();
    my $vendor = $e->search_actor_user({usrname => $username})->[0];
    return 0 unless $vendor;

    return unless $U->verify_user_password(
        $e, $vendor->id, $password, 'ecard_vendor');

    # Auth checks out OK.  Manually create an authtoken

    my $auth = $U->simplereq(
        'open-ils.auth_internal',
        'open-ils.auth_internal.session.create',
        {user_id => 1, org_unit => 4, login_type => 'temp'}
    );

    return unless $auth && $auth->{textcode} eq 'SUCCESS';

    $self->ctx->{authtoken} = $auth->{payload}->{authtoken};

    return 1;
}

sub verify_vendor_host {
    my $self = shift;
    # TODO
    # Confirm calling host matches AOUS ecard.vendor.host
    # NOTE: we may not have that information inside the firewall.
    return 1;
}

sub compile_response {
    my $self = shift;
    my $ctx = $self->ctx;
    $self->apache->content_type("application/json; charset=utf-8");
    $ctx->{response} = OpenSRF::Utils::JSON->perl2JSON($ctx->{response});
    $logger->info("ECARD responding with " . $ctx->{response});
    return Apache2::Const::OK;
}

my %keep_case = (usrname => 1, passwd => 1, email => 1);
sub upperclense {
    my $self = shift;
    my $field = shift;
    my $value = shift;
    $value = uc($value) unless $keep_case{$field};
    $value = lc($value) if $field eq 'email'; # force it
    $value =~ s/(^\s*|\s*$)//g;
    return $value;
}


# Create actor.usr perl object and populate column data
sub make_user {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;

    my $au = Fieldmapper::actor::user->new;

    $au->isnew(1);
    $au->ident_type($ECARD_VERIFY_IDENT); # Ecard Verification
    $au->net_access_level(101); # No Access
    $au->ident_value(generate_verify_code());

    $au->profile($PROVISIONAL_ECARD_GRP);
    my $grp = new_editor()->retrieve_permission_grp_tree($PROVISIONAL_ECARD_GRP);

    $au->expire_date(
        DateTime->now(time_zone => 'local')->add(
            seconds => interval_to_seconds($grp->perm_interval))->iso8601()
    );

    for my $field_info (@api_fields) {
        my $field = $field_info->{name};
        next unless $field_info->{class} eq 'au';

        my $val = $cgi->param($field);

        # Map to guardian field on the actor.usr object.
        $field = 'guardian' if $field eq 'ident_value2';

        if ($field_info->{required} && !$val) {
            my $msg = "Value required for field: '$field'";
            $ctx->{response}->{status} = 'INVALID_PARAMS';
            push(@{$ctx->{response}->{messages}}, $msg);
            $logger->error("ECARD $msg");
        }

        $self->verify_dob($val) if $field eq 'dob' && $val;
        $au->$field($self->upperclense($field, $val));
    }

    # Usename defaults to the user barcode
    return undef if $ctx->{response}->{status}; 
    return $ctx->{user} = $au;
}

# Card generation must occur after the user is saved in the DB.
sub add_card {
    my $self = shift;
    my $ctx = $self->ctx;
    my $user = $ctx->{user};

    my $bc = new_editor()->json_query({from => [
        'actor.generate_barcode', 
        '934', # ecard prefix
        7, # length of autogenated portion
        'actor.auto_barcode_ecard_seq' # base sequence for autogeneration.
    ]})->[0];

    my $barcode = $bc->{'actor.generate_barcode'};

    $logger->info("ECARD using generated barcode: $barcode");

    my $card = Fieldmapper::actor::card->new;
    $card->id(-1);
    $card->isnew(1);
    $card->usr($user->id);
    $card->barcode($barcode);

    # username defaults to barcode
    $user->usrname($barcode);
    $user->card($card);
    $user->cards([$card]);

    return 1;
}


# Returns 1 on success, undef on error.
sub verify_dob {
    my $self = shift;
    my $dob = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;

    my @parts = split(/-/, $dob);
    my $dob_date;

    eval { # avoid dying on funky dates
        $dob_date = DateTime->new(
            year => $parts[0], month => $parts[1], day => $parts[2]);
    };

    if (!$dob_date || $dob_date > DateTime->now) {
        my $msg = "Invalid dob: '$dob'";
        $ctx->{response}->{status} = 'INVALID_PARAMS';
        push(@{$ctx->{response}->{messages}}, $msg);
        $logger->error("ECARD $msg");
        return undef;
    }

    my $comp_date = DateTime->now;
    $comp_date->set_hour(0);
    $comp_date->set_minute(0);
    $comp_date->set_second(0);
    $comp_date->subtract(years => 18); # juv age

    if (
        $dob_date > $comp_date # less than 18 years old
        && !$cgi->param('ident_value2')) {

        my $msg = "Parent/Guardian (ident_value2) is required for patrons ".
            "under 18 years of age. dob=$dob";
        $ctx->{response}->{status} = 'INVALID_PARAMS';
        push(@{$ctx->{response}->{messages}}, $msg);
        $logger->error("ECARD $msg");
        return undef;
    }

    return 1;
}

# returns true if the addresses contain all of the same values.
sub addrs_match {
    my ($self, $addr1, $addr2) = @_;
    for my $field ($addr1->real_fields) {
        return 0 if ($addr1->$field() || '') ne ($addr2->$field() || '');
    }
    return 1;
}


sub add_billing_address {
    my $self = shift;
    my $cgi = $self->cgi;
    my $ctx = $self->ctx;
    my $e = $ctx->{editor};
    my $user = $ctx->{user};

    my $bill_addr = Fieldmapper::actor::user_address->new;
    $bill_addr->isnew(1);
    $bill_addr->usr($user->id);
    $bill_addr->address_type('RESIDENTIAL');
    $bill_addr->within_city_limits('f');

    # Use as both billing and mailing via virtual ID.
    $bill_addr->id(-1);
    $user->billing_address(-1);
    $user->mailing_address(-1);

    my ($s1, $s2) = 
        OpenILS::Utils::KCLSNormalize::normalize_address_street(
            $cgi->param('billing_street1'),
            $cgi->param('billing_street2')
        );

    # Toss the normalized values back into CGI to simplify the steps below.
    $cgi->param('billing_street1', $s1);

    if ($s2) {
        $cgi->param('billing_street2', $s2);
    } else {
        $cgi->delete('billing_street2');
    }

    # Confirm we have values for all of the required fields.
    # Apply values to our in-progress address object.
    for my $field_info (@api_fields) {
        my $field = $field_info->{name};
        next unless $field =~ /^billing_/;
        next if $field =~ /billing_street1_/;

        my $val = $cgi->param($field);

        if ($field_info->{required} && !$val) {
            my $msg = "Value required for field: '$field'";
            $ctx->{response}->{status} = 'INVALID_PARAMS';
            push(@{$ctx->{response}->{messages}}, $msg);
            $logger->error("ECARD $msg");
        }

        (my $col_field = $field) =~ s/billing_//g;
        $bill_addr->$col_field($self->upperclense($col_field, $val));
    }

    # exit if there were any errors above.
    return undef if $ctx->{response}->{status}; 

    $user->billing_address($bill_addr);
    $user->addresses([$bill_addr]);

    return 1;
}

sub add_mailing_address {
    my $self = shift;
    my $cgi = $self->cgi;
    my $ctx = $self->ctx;
    my $e = $ctx->{editor};
    my $user = $ctx->{user};

    # Mailing address is optional.  Make sure we have sufficient
    # data to add one before continuing.
    return 1 unless
        $cgi->param('mailing_street1') &&
        $cgi->param('mailing_country') &&
        $cgi->param('mailing_post_code');

    my $mail_addr = Fieldmapper::actor::user_address->new;
    $mail_addr->isnew(1);
    $mail_addr->usr($user->id);
    $mail_addr->address_type('MAILING');
    $mail_addr->within_city_limits('f');

    # Use as both mailing and mailing via virtual ID.
    $mail_addr->id(-2);
    $user->mailing_address(-2);

    my ($s1, $s2) = 
        OpenILS::Utils::KCLSNormalize::normalize_address_street(
            $cgi->param('mailing_street1'),
            $cgi->param('mailing_street2')
        );

    # Toss the normalized values back into CGI to simplify the steps below.
    $cgi->param('mailing_street1', $s1);

    if ($s2) {
        $cgi->param('mailing_street2', $s2);
    } else {
        $cgi->delete('mailing_street2');
    }

    # Confirm we have values for all of the required fields.
    # Apply values to our in-progress address object.
    for my $field_info (@api_fields) {
        my $field = $field_info->{name};
        next unless $field =~ /^mailing_/;
        next if $field =~ /mailing_street1_/;

        my $val = $cgi->param($field);

        if ($field_info->{required} && !$val) {
            my $msg = "Value required for field: '$field'";
            $ctx->{response}->{status} = 'INVALID_PARAMS';
            push(@{$ctx->{response}->{messages}}, $msg);
            $logger->error("ECARD $msg");
        }

        (my $col_field = $field) =~ s/mailing_//g;
        $mail_addr->$col_field($self->upperclense($col_field, $val));
    }

    # exit if there were any errors above.
    return undef if $ctx->{response}->{status}; 

    $user->mailing_address($mail_addr);
    push(@{$user->addresses}, $mail_addr);

    return 1;
}

sub add_stat_cats {
    my $self = shift;
    my $cgi = $self->cgi;
    my $user = $self->ctx->{user};

    my $ds_map = Fieldmapper::actor::stat_cat_entry_user_map->new;
    $ds_map->isnew(1);
    $ds_map->stat_cat(12);
    $ds_map->stat_cat_entry(' KCLS');

    my $events = $cgi->param('events_mailing');
    my $em_map = Fieldmapper::actor::stat_cat_entry_user_map->new;
    $em_map->isnew(1);
    $em_map->stat_cat(3);
    $em_map->stat_cat_entry($events ? 'Y' : 'N');

    my $foundation = $cgi->param('foundation_mailing');
    my $fm_map = Fieldmapper::actor::stat_cat_entry_user_map->new;
    $fm_map->isnew(1);
    $fm_map->stat_cat(4);
    $fm_map->stat_cat_entry($foundation ? 'Y' : 'N');

    $user->stat_cat_entries([$ds_map, $em_map, $fm_map]);
    return 1;
}

# Returns true if no dupes found, false if dupes are found.
sub check_dupes {
    my $self = shift;
    my $ctx  = $self->ctx;
    my $user = $ctx->{user};
    my $addr = $user->addresses->[0];
    my $e = new_editor();

    my @dupe_patron_fields = 
        qw/first_given_name family_name dob/;

    my $search = {
        first_given_name => {value => $user->first_given_name, group => 0},
        family_name => {value => $user->family_name, group => 0},
        dob => {value => substr($user->dob, 0, 4), group => 0} # birth year
    };

    my $root_org = $e->search_actor_org_unit({parent_ou => undef})->[0];

    my $ids = $U->storagereq(
        "open-ils.storage.actor.user.crazy_search", 
        $search,
        1000,           # search limit
        undef,          # sort
        1,              # include inactive
        $root_org->id,  # ws_ou
        $root_org->id   # search_ou
    );

    return 1 if @$ids == 0;

    $logger->info("ECARD found potential duplicate patrons: @$ids");

    if (my $streetname = $self->cgi->param('billing_street1_name')) {
        # We found matching patrons.  Perform a secondary check on the
        # address street name only.

        $logger->info("ECARD secondary search on street name: $streetname");

        my $addr_ids = $e->search_actor_user_address(
            {   usr => $ids,
                street1 => {'~*' => "(^| )$streetname( |\$)"}
            }, {idlist => 1}
        );

        if (@$addr_ids) {
            # we don't really care what patrons match at this point,
            # only whether a match is found.
            $ids = [1];
            $logger->info("ECARD secondary address check match(es) ".
                "found on address(es) @$addr_ids");

        } else {
            $ids = [];
            $logger->info(
                "ECARD secondary address check found no matches");
        }

    } else {
        $ids = [];
        # unclear if this is a possibility -- err on the side of allowing
        # the registration.
        $logger->info("ECARD found possible patron match but skipping ".
            "secondary street name check -- no street name was provided");
    }

    return 1 if @$ids == 0;

    $ctx->{response}->{status} = 'DUPLICATE';
    $ctx->{response}->{messages} = ['first_given_name', 
        'familiy_name', 'dob_year', 'billing_street1_name'];
    return undef;
}


sub save_user {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;
    my $user = $ctx->{user};

    my $resp = $U->simplereq(
        'open-ils.actor',
        'open-ils.actor.patron.update',
        $self->ctx->{authtoken}, $user
    );

    $resp = {textcode => 'UNKNOWN_ERROR'} unless $resp;

    if ($U->is_event($resp)) {

        my $msg = "Error creating user account: " . $resp->{textcode};
        $logger->error("ECARD: $msg");

        $ctx->{response}->{status} = 'CREATE_ERR';
        $ctx->{response}->{messages} = [{msg => $msg, pid => $$}];

        return 0;
    }

    $ctx->{user} = $resp;

    return 1;
}

sub apply_settings {
    my $self = shift;
    my $ctx = $self->ctx;
    my $user = $ctx->{user};

    my $settings = {'circ.autorenew.opt_in' => JSON::true};

    my $resp = $U->simplereq(
        'open-ils.actor',
        'open-ils.actor.patron.settings.update',
        $self->ctx->{authtoken}, $user->id, $settings
    );

    if ($U->is_event($resp)) {
        # At this point, the account is created, so just log the error.
        my $msg = "Error applying user settings: " . $resp->{textcode};
        $logger->error("ECARD: $msg");
    }

    return 1;
}


1;

