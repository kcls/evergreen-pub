package OpenILS::Application::Actor::Register;
use strict; use warnings;
use base 'OpenILS::Application';
use OpenSRF::Utils::Logger q/$logger/;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor q/:funcs/;
use OpenILS::Utils::Fieldmapper;
use OpenSRF::Utils::JSON;
use OpenILS::Event;
use OpenILS::Utils::KCLSNormalize;
use DateTime;
my $U = "OpenILS::Application::AppUtils";

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


my @ALLOWED_STAT_CATS = (3, 4, 10);

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
    my ($self, $client, $captcha, $values) = @_;

    # TODO CAPTCHA

    return OpenILS::Event->new('BAD_PARAMS') unless ref $values eq 'HASH';

    $logger->info("Patron self-reg: " . OpenSRF::Utils::JSON->perl2JSON($values));

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
    $value = uc($value) unless $field =~ /usrname|passwd|email/;

    # Trim start/end spaces.
    $value =~ s/(^\s*|\s*$)//g;

    return $value;
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
    my ($self, $client, $captcha, $values) = @_;
    my $e = new_editor();

    # TODO CAPTCHA

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
