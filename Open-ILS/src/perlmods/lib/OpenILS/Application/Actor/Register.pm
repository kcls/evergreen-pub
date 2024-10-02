package OpenILS::Application::Actor::Register;
use strict; use warnings;
use base 'OpenILS::Application';
use OpenSRF::Utils::Logger q/$logger/;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor q/:funcs/;
use OpenILS::Utils::Fieldmapper;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils qw/:datetime/;
use OpenILS::Event;
use OpenILS::Utils::KCLSNormalize;
use DateTime;
use JSON;
use Data::Dumper;
use OpenSRF::Utils::Cache;
$Data::Dumper::Indent = 0;
my $U = "OpenILS::Application::AppUtils";

my $CACHE_KEY_PFX = 'kcls.captcha.session.';

# District-of-residence value that denotes an in-district (KCLS) patron.
# The leading space is intentional and mirrors the value used elsewhere.
my $MAIN_DISTRICT = ' KCLS';

# Stat cat carrying the district-of-residence value in the payload.
my $DISTRICT_STAT_CAT = 12;

# We only allow certain user values to be provided by the caller.
my @USER_FIELDS = (
    'first_given_name',
    'second_given_name',
    'family_name',
    'pref_first_given_name',
    'pref_second_given_name',
    'pref_family_name',
    'dob',
    'day_phone',
    'email',
    'home_ou',
    'ident_value2', # guardian
);


my @ALLOWED_STAT_CATS = (3, 4, 10, 12);

my $PROVISIONAL_ECARD_GRP = 951;
my $ECARD_VERIFY_IDENT = 102;

my @ecard_code_chars = ('C','D','F','H','J'..'N','P','R','T','V','W','X','3','4','7','9');
sub generate_verify_code {
    my $string = '';
    $string .= $ecard_code_chars[rand @ecard_code_chars] for 1..6;
    return $string;
}

__PACKAGE__->register_method(
    method      => 'register',
    api_name    => 'open-ils.actor.register',
    signature => {
        desc => q/Register a new pending account/,
        params => [
            {desc => 'Values', type => 'object'}
        ],
        return => {
            desc => q/Hash if info including success=1|0/,
            type => 'number',
        }
    }
);

sub register {
    my ($self, $client, $token, $values) = @_;

    return OpenILS::Event->new('BAD_PARAMS') unless $token && ref $values eq 'HASH';

    # A valid CAPTCHA-minted session token is required to register.  The token
    # is created by the kcls.address service after Turnstile verification.
    my $session = OpenSRF::Utils::Cache->new('global')
        ->get_cache("$CACHE_KEY_PFX$token")
        || return OpenILS::Event->new('UNAUTHORIZED');

    if (my $evt = verify_address_values($token, $values)) {
        return $evt;
    }

    $logger->info("Patron self-reg: " . OpenSRF::Utils::JSON->perl2JSON($values));

    # TODO verify herein no existing account is present (prevent api abuse).

    my $type = $values->{requested_account_type} // '';
    my $response;

    if ($type eq 'full') {
        $response = create_pending_account($values);
    } elsif ($type eq 'ecard') {
        $response = create_ecard_account($values);
    } else {
        $logger->error("Invalid account type requested");
        return {success => 0};
    }

    # One CAPTCHA solve authorizes one registration; invalidate the token so
    # it cannot be replayed to create additional accounts.
    if ($response && $response->{success}) {
        OpenSRF::Utils::Cache->new('global')->delete_cache("$CACHE_KEY_PFX$token");
    }

    return $response;
}

sub verify_address_values {
    my ($token, $values) = @_;

    if (my $eid = $values->{address_exception_id}) {
        my $e = new_editor();

        # Verify the address exception is allowed.
        my $addr = $e->retrieve_config_usr_address_exception($eid);

        if (!$addr || !$U->is_true($addr->is_allowed)) {
            $logger->error("Attempt to register with blocked address exc=$eid");
            return OpenILS::Event->new('BAD_PARAMS');
        }

        # TODO: Verify the address exception matches the address values
        # provided by the user.

        return undef;
    }

    # Re-verify the submitted addresses server-side so the UI's checks cannot
    # be bypassed.  We call the address service with the final address values
    # rather than trusting anything the client computed.

    # 1. Residential (billing) address must be viable as a residence.
    my $res = lookup_address($token, $values->{billing_address} || {});

    if (!$res || !$U->is_true($res->{is_viable_residential})) {
        $logger->warn("Self-reg residential address is not viable");
        return OpenILS::Event->new('BAD_PARAMS');
    }

    my $lat  = $res->{metadata} ? $res->{metadata}->{latitude}  : undef;
    my $long = $res->{metadata} ? $res->{metadata}->{longitude} : undef;

    if (!defined $lat || !defined $long) {
        $logger->warn("Self-reg residential address has no coordinates");
        return OpenILS::Event->new('BAD_PARAMS');
    }

    # Derive the authoritative home org and district from the coordinates.
    my $home_ou = $U->simplereq(
        'kcls.address', 'kcls.address.home-org', $token, $lat, $long);

    my $district = $U->simplereq(
        'kcls.address', 'kcls.address.district-of-residence', $token, $lat, $long);

    # 2. Must fall within the service area (a district is required).
    unless (defined $district && $district ne '') {
        $logger->warn("Self-reg residential address has no district of residence");
        return OpenILS::Event->new('BAD_PARAMS');
    }

    # 3. District must be compatible with the requested card type: e-cards are
    # only offered to in-district (main) patrons; reciprocal districts require
    # an all-access (full) card.  Mirrors the UI rule.
    if ($district ne $MAIN_DISTRICT && ($values->{requested_account_type} // '') eq 'ecard') {
        $logger->warn("Self-reg e-card requested for reciprocal district '$district'");
        return OpenILS::Event->new('BAD_PARAMS');
    }

    # 4. The provided home org and district must match what the address
    # actually resolves to (prevent injecting different values).
    if (!defined $home_ou || ($values->{user}->{home_ou} // 0) != $home_ou) {
        $logger->warn("Self-reg home_ou does not match resolved home org");
        return OpenILS::Event->new('BAD_PARAMS');
    }

    my ($provided_district) =
        map  { $_->{value} }
        grep { $_->{stat_cat} == $DISTRICT_STAT_CAT } @{$values->{stat_cats} || []};

    if (($provided_district // '') ne $district) {
        $logger->warn("Self-reg district does not match resolved district");
        return OpenILS::Event->new('BAD_PARAMS');
    }

    # 5. Mailing address, when provided (i.e. different from residential),
    # must be viable for mail delivery.
    my $mail = $values->{mailing_address} || {};
    if ($mail->{street1}) {
        my $mres = lookup_address($token, $mail);
        if (!$mres || !$U->is_true($mres->{is_viable_mailing})) {
            $logger->warn("Self-reg mailing address is not viable");
            return OpenILS::Event->new('BAD_PARAMS');
        }
    }

    return undef;
}

# Look up an address via the kcls.address service and return the best
# candidate hash, or undef if none.  The candidate carries the is_viable_*
# flags and metadata coordinates.
sub lookup_address {
    my ($token, $addr) = @_;

    my $search = {
        street  => $addr->{street1},
        street2 => $addr->{street2},
        city    => $addr->{city},
        state   => $addr->{state},
        zipcode => $addr->{post_code},
    };

    return $U->simplereq(
        'kcls.address', 'kcls.address.lookup', $token, $search);
}

sub create_pending_account {
    my $values = shift;

    $logger->info("Creating all-access account");

    my $user = Fieldmapper::staging::user_stage->new;

    # user
    for my $field (@USER_FIELDS) {
        my $val = normalize($field, $values->{user}->{$field});
        $user->$field($val);
    }

    my ($bill_addr, $mail_addr) = handle_addresses($values);
    my $stat_cats = handle_stat_cats($values);

    my $settings = handle_user_settings($values);

    my $response = {success => 0};

    # user.stage.create will generate a temporary usrname and 
    # link the user and address objects via this username in the DB.
    my $resp = $U->simplereq(
        'open-ils.actor', 
        'open-ils.actor.user.stage.create',
        $user, $mail_addr, $bill_addr, $stat_cats, $settings
    );

    if (!$resp or ref $resp) {
        $logger->warn("Patron self-reg failed ".Dumper($resp));

    } else {
        $logger->info("Patron self-reg success; usrname $resp");
        $response->{success} = 1;
    }

    return $response;
}

sub handle_user_settings {
    my $values = shift;

    my @settings;

    for my $set (@{$values->{settings}}) {
        my $setting = Fieldmapper::staging::setting_stage->new;
        $setting->setting($set->{name});
        $setting->value($set->{value});
        push(@settings, $setting);
    }

    \@settings;
}

sub handle_addresses {
    my $values = shift;
    my $bill_addr;
    my $mail_addr;

    # billing ---
    my $addr = $values->{billing_address};
    for my $field (%$addr) {
        my $val = normalize($field, $addr->{$field}) or next; # skip empty strings
        $bill_addr = Fieldmapper::staging::billing_address_stage->new unless $bill_addr;
        $bill_addr->$field($val);
    }

    if ($bill_addr) {
        # DB requires this field
        $bill_addr->post_code('') unless $bill_addr->post_code;
        # if no street1 is entered, don't create the addres
        $bill_addr = undef unless $bill_addr->street1;
    }

    # mailing ---
    $addr = $values->{mailing_address};
    for my $field (%$addr) {
        my $val = normalize($field, $addr->{$field}) or next; # skip empty strings
        $mail_addr = Fieldmapper::staging::mailing_address_stage->new unless $mail_addr;
        $mail_addr->$field($val);
    }
   
    if ($mail_addr) {
        # DB requires this field
        $mail_addr->post_code('') unless $mail_addr->post_code;
        # if no street1 is entered, don't create the addres
        $mail_addr = undef unless $mail_addr->street1;
    }

    # only create the mailing address if it differs from the billing
    # (residential) address.  We know from the form data whether the
    # user selected mailing-matches-billing, but make the comparison
    # anyway in case the option was de-selected when the match anyway.
    $mail_addr = undef if (
        $bill_addr && 
        $mail_addr && 
        addrs_match($bill_addr, $mail_addr)
    );

    if ($bill_addr) {
        my ($bstreet1, $bstreet2) = 
            OpenILS::Utils::KCLSNormalize::normalize_address_street(
                $bill_addr->street1, $bill_addr->street2);

        $bill_addr->street1($bstreet1);

        # Normalization can result in the loss of the street2 value.
        if ($bstreet2) {
            $bill_addr->street2($bstreet2);
        } else {
            $bill_addr->clear_street2;
        }
    }

    if ($mail_addr) {
        my ($mstreet1, $mstreet2) = 
            OpenILS::Utils::KCLSNormalize::normalize_address_street(
                $mail_addr->street1, $mail_addr->street2);

        $mail_addr->street1($mstreet1);

        # Normalization can result in the loss of the street2 value.
        if ($mstreet2) {
            $mail_addr->street2($mstreet2);
        } else {
            $mail_addr->clear_street2;
        }
    }

    return ($bill_addr, $mail_addr);
}

# Create the stat cat entries.
sub handle_stat_cats {
    my $values = shift;

    my $stat_cats = [];

    # We only allow values for certain stat cats to be provided via this API.
    for my $cat_id (@ALLOWED_STAT_CATS) {
        if (my ($sc) = grep { $_->{stat_cat} == $cat_id } @{$values->{stat_cats}}) {
            my $stat_cat = Fieldmapper::staging::statcat_stage->new;
            $stat_cat->statcat($cat_id);
            $stat_cat->value($sc->{value});
            push(@$stat_cats, $stat_cat);
        }
    }

    return $stat_cats;
}


# returns true if the addresses contain all of the same values.
sub addrs_match {
    my ($addr1, $addr2) = @_;
    for my $field ($addr1->real_fields) {
        $logger->info("comparing addr fields $field: " .
            $addr1->$field() . " : " . $addr2->$field());
        return 0 if ($addr1->$field() || '') ne ($addr2->$field() || '');
    }
    return 1;
}


sub normalize {
    my ($field, $value) = @_;

    # KCLS JBAS-1133: Upper-case most patron field values.
    $value = uc($value || '') unless $field =~ /usrname|passwd|email/;

    # Trim start/end spaces.
    $value =~ s/(^\s*|\s*$)//g;

    return $value;
}


sub create_ecard_account {
    my $values = shift;

    $logger->info("Creating ecard account");

    my $response = {success => 0};

    # Create an internal auth session for API calls that require one.
    my $auth = $U->simplereq(
        'open-ils.auth_internal',
        'open-ils.auth_internal.session.create',
        {user_id => 1, login_type => 'temp'}
    );

    unless ($auth && $auth->{textcode} eq 'SUCCESS') {
        $logger->error("Ecard self-reg: failed to create auth session");
        return $response;
    }

    my $authtoken = $auth->{payload}->{authtoken};
    my $e = new_editor();

    # --- Create user object ---

    my $au = Fieldmapper::actor::user->new;
    $au->isnew(1);
    $au->ident_type($ECARD_VERIFY_IDENT);
    $au->net_access_level(101);
    $au->ident_value(generate_verify_code());
    $au->profile($PROVISIONAL_ECARD_GRP);

    my $grp = $e->retrieve_permission_grp_tree($PROVISIONAL_ECARD_GRP);
    $au->expire_date(
        DateTime->now(time_zone => 'local')->add(
            seconds => interval_to_seconds($grp->perm_interval)
        )->iso8601()
    );

    for my $field (@USER_FIELDS) {
        my $val = normalize($field, $values->{user}->{$field} || '');
        # actor.usr uses 'guardian'; the staging table uses 'ident_value2'
        my $col = $field eq 'ident_value2' ? 'guardian' : $field;
        $au->$col($val);
    }

    # --- Billing address ---

    my $addr_data = $values->{billing_address};

    if ($addr_data && $addr_data->{street1}) {
        my $bill_addr = Fieldmapper::actor::user_address->new;
        $bill_addr->isnew(1);
        $bill_addr->address_type('RESIDENTIAL');
        $bill_addr->within_city_limits('f');
        $bill_addr->id(-1);

        my ($s1, $s2) = OpenILS::Utils::KCLSNormalize::normalize_address_street(
            $addr_data->{street1}, $addr_data->{street2});

        $bill_addr->street1(normalize('street1', $s1));
        $bill_addr->street2(normalize('street2', $s2)) if $s2;
        $bill_addr->city(normalize('city', $addr_data->{city} || ''));
        $bill_addr->state(normalize('state', $addr_data->{state} || ''));
        $bill_addr->post_code($addr_data->{post_code} || '');
        $bill_addr->country(normalize('country', 'US'));

        $au->billing_address(-1);
        $au->mailing_address(-1);
        $au->addresses([$bill_addr]);

        # --- Mailing address (if provided and different from billing) ---

        my $maddr_data = $values->{mailing_address};

        if ($maddr_data && $maddr_data->{street1}) {
            my $mail_addr = Fieldmapper::actor::user_address->new;
            $mail_addr->isnew(1);
            $mail_addr->address_type('MAILING');
            $mail_addr->within_city_limits('f');
            $mail_addr->id(-2);

            my ($ms1, $ms2) = OpenILS::Utils::KCLSNormalize::normalize_address_street(
                $maddr_data->{street1}, $maddr_data->{street2});

            $mail_addr->street1(normalize('street1', $ms1));
            $mail_addr->street2(normalize('street2', $ms2)) if $ms2;
            $mail_addr->city(normalize('city', $maddr_data->{city} || ''));
            $mail_addr->state(normalize('state', $maddr_data->{state} || ''));
            $mail_addr->post_code($maddr_data->{post_code} || '');
            $mail_addr->country(normalize('country', 'US'));

            unless (addrs_match($bill_addr, $mail_addr)) {
                $au->mailing_address(-2);
                push(@{$au->addresses}, $mail_addr);
            }
        }
    }

    # --- Stat cats ---

    my @stat_maps;
    for my $cat_id (@ALLOWED_STAT_CATS) {
        if (my ($sc) = grep { $_->{stat_cat} == $cat_id } @{$values->{stat_cats}}) {
            my $map = Fieldmapper::actor::stat_cat_entry_user_map->new;
            $map->isnew(1);
            $map->stat_cat($cat_id);
            $map->stat_cat_entry($sc->{value});
            push(@stat_maps, $map);
        }
    }
    $au->stat_cat_entries(\@stat_maps);

    # --- Generate barcode and card ---

    my $bc = $e->json_query({from => [
        'actor.generate_barcode',
        '934',
        7,
        'actor.auto_barcode_ecard_seq'
    ]})->[0];

    my $barcode = $bc->{'actor.generate_barcode'};
    $logger->info("Ecard self-reg using generated barcode: $barcode");

    my $card = Fieldmapper::actor::card->new;
    $card->id(-1);
    $card->isnew(1);
    $card->barcode($barcode);

    $au->usrname($barcode);
    $au->card($card);
    $au->cards([$card]);

    # --- Save user ---

    my $resp = $U->simplereq(
        'open-ils.actor',
        'open-ils.actor.patron.update',
        $authtoken, $au
    );

    $resp = {textcode => 'UNKNOWN_ERROR'} unless $resp;

    if ($U->is_event($resp)) {
        $logger->error(
            "Ecard self-reg: Error creating account: " . $resp->{textcode});
        return $response;
    }

    $au = $resp;

    # --- Apply settings ---

    my $settings = {'circ.autorenew.opt_in' => JSON::true};
    for my $set (@{$values->{settings}}) {
        $settings->{$set->{name}} = $set->{value};
    }

    $resp = $U->simplereq(
        'open-ils.actor',
        'open-ils.actor.patron.settings.update',
        $authtoken, $au->id, $settings
    );

    if ($U->is_event($resp)) {
        $logger->error(
            "Ecard self-reg: Error applying settings: " . $resp->{textcode});
    }

    $U->create_events_for_hook('au.create.ecard', $au, $au->home_ou);

    $response->{success} = 1;
    $response->{barcode} = $barcode;
    $logger->info("Ecard self-reg success; barcode $barcode");

    return $response;
}



__PACKAGE__->register_method(
    method      => 'has_account',
    api_name    => 'open-ils.actor.register.has_account',
    signature => {
        desc => 'See if the provided user data might match an existing account',
        params => [
            {desc => 'Values', type => 'object'}
        ],
        return => {
            desc => 'True(1) if potential duplicates are found, False (0) otherwise',
            type => 'number',
        }
    }
);

sub has_account {
    my ($self, $client, $token, $values) = @_;
    return OpenILS::Event->new('BAD_PARAMS') unless $token && ref $values eq 'HASH';

    my $session = OpenSRF::Utils::Cache->new('global')
        ->get_cache("$CACHE_KEY_PFX$token")
        || return OpenILS::Event->new('UNAUTHORIZED');

    my $e = new_editor();

    my $first_given_name = $values->{first_given_name};
    my $family_name = $values->{family_name};
    my $dob = $values->{dob};
    my $dob_year = substr($dob, 0, 4);
    my $street1 = $values->{street1};

    return OpenILS::Event->new('BAD_PARAMS') unless 
        $first_given_name
        && $family_name
        && $dob_year
        && $street1;

    my $search = {
        first_given_name => {value => $first_given_name, group => 0},
        family_name => {value => $family_name, group => 0},
        dob => {value => $dob_year, group => 0}
    };

    # KCLS searches everywhere
    my $root_org = $e->search_actor_org_unit({parent_ou => undef})->[0];

    my $ids = $U->storagereq(
        'open-ils.storage.actor.user.crazy_search', 
        $search,
        1000,           # search limit
        undef,          # sort
        1,              # include inactive
        $root_org->id,  # ws_ou
        $root_org->id   # search_ou
    );

    return 0 if @$ids == 0; # no matching users found.

    $logger->info("Found potential duplicate patrons: @$ids; checking address: $street1");

    # The Ecard code this was copied from explicitly did not check if the
    # address matched any of the duplicate users.  Retaining that logic for now.
    my $addr_ids = $e->search_actor_user_address(
        {   usr => $ids,
            street1 => {'~*' => "(^| )$street1( |\$)"}
        }, {idlist => 1}
    );

    if (@$addr_ids) {
        $logger->info("Secondary address check found matches: @$addr_ids");
        return 1;
    }

    return 0
}


1;
