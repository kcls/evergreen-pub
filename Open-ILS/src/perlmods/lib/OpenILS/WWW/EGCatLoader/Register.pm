package OpenILS::WWW::EGCatLoader;
use strict; use warnings;
use Apache2::Const -compile => qw(OK FORBIDDEN HTTP_INTERNAL_SERVER_ERROR);
use OpenSRF::Utils::Logger qw/$logger/;
use OpenSRF::Utils::JSON;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Event;
use Data::Dumper;
use LWP::UserAgent;
use OpenILS::Utils::KCLSNormalize;
use DateTime;
$Data::Dumper::Indent = 0;
my $U = 'OpenILS::Application::AppUtils';

sub load_patron_reg {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;
    $ctx->{register} = {};
    $self->collect_register_validation_settings;
    $self->collect_requestor_info;
    $self->collect_header_footer;

    # in the home org unit selector, we only want to present 
    # org units to the patron which support self-registration.
    # all other org units will be disabled
    $ctx->{register}{valid_orgs} = 
        $self->setting_is_true_for_orgs('opac.allow_pending_user');

    $self->collect_opt_in_settings;

    # just loading the form
    return Apache2::Const::OK
        unless $cgi->request_method eq 'POST';

    my $user = Fieldmapper::staging::user_stage->new;

    # user
    foreach (grep /^stgu\./, $cgi->param) {
        my $val = $cgi->param($_);
        $val = $self->inspect_register_value($_, $val);
        s/^stgu\.//g;
        $user->$_($val);
    }

    # requestor is logged in, capture who is making this request
    $user->requesting_usr($ctx->{user}->id) if $ctx->{user};

    # make sure the selected home org unit is in the list 
    # of valid orgs.  This can happen if the selector 
    # defaults to CONS, for example.
    $ctx->{register}{invalid}{bad_home_ou} = 1 unless
        grep {$_ eq $user->home_ou} @{$ctx->{register}{valid_orgs}};

    my ($bill_addr, $mail_addr) = $self->handle_addresses($cgi);

    my $stat_cats = $self->handle_stat_cats($cgi);

    # opt-in settings
    my $settings = [];
    foreach (grep /^stgs\./, $cgi->param) {
        my $val = $cgi->param($_);
        next unless $val; # opt-in settings are always Boolean,
                          # so just skip if not set
        $self->inspect_register_value($_, $val);
        s/^stgs.//g;
        my $setting = Fieldmapper::staging::setting_stage->new;
        $setting->setting($_);
        $setting->value('true');
        push @$settings, $setting;
    }

    # At least one value was invalid. Exit early and re-render.
    return Apache2::Const::OK if $ctx->{register}{invalid};

    $self->test_requested_username($user);

    # KCLS JBAS-1138
    my $profile = $U->ou_ancestor_setting_value(
        $user->home_ou, 'opac.self_register.profile');

    $self->apply_net_access_level($user);
    
    $user->profile($profile) if $profile;

    # user.stage.create will generate a temporary usrname and 
    # link the user and address objects via this username in the DB.
    my $resp = $U->simplereq(
        'open-ils.actor', 
        'open-ils.actor.user.stage.create',
        $user, $mail_addr, $bill_addr, $stat_cats
    );

    if (!$resp or ref $resp) {

        $logger->warn("Patron self-reg failed ".Dumper($resp));
        $ctx->{register}{error} = 1;

    } else {

        $logger->info("Patron self-reg success; usrname $resp");
        $ctx->{register}{success} = 1;
        $ctx->{register}{user} = $user;
    }

    return Apache2::Const::OK;
}


sub apply_net_access_level {
    my ($self, $user) = @_;
    return unless $user->dob;

    # DoB is YYYY-MM-DD
    my @parts = split(/-/, $user->dob);

    my $dob_date;
    eval {
        # avoid dying on funky dates
        $dob_date = DateTime->new(
            year => $parts[0], month => $parts[1], day => $parts[2]);
    };

    return unless $dob_date;

    # DoB has no time, so compare to a date w/ no time.
    my $comp_date = DateTime->now;
    $comp_date->set_hour(0);
    $comp_date->set_minute(0);
    $comp_date->set_second(0);
    $comp_date->subtract(years => 17);

    $user->net_access_level(
        $comp_date >= $dob_date ? # 17 or older.
        1 :                       # == 17 and Up Only
        102                       # == Under 17 Plus
    );
}

# returns true if the addresses contain all of the same values.
sub addrs_match {
    my ($self, $addr1, $addr2) = @_;
    for my $field ($addr1->real_fields) {
        $logger->info("comparing addr fields $field: " .
            $addr1->$field() . " : " . $addr2->$field());
        return 0 if ($addr1->$field() || '') ne ($addr2->$field() || '');
    }
    return 1;
}


sub handle_addresses {
    my $self = shift;
    my $cgi = shift;
    my $bill_addr;
    my $mail_addr;

    # billing ---
    foreach (grep /^stgba\./, $cgi->param) {
        my $val = $cgi->param($_) or next; # skip empty strings
        $val = $self->inspect_register_value($_, $val);
        s/^stgba\.//g;
        $bill_addr = Fieldmapper::staging::billing_address_stage->new
            unless $bill_addr;
        $bill_addr->$_($val);
    }

    if ($bill_addr) {
        # DB requires this field
        $bill_addr->post_code('') unless $bill_addr->post_code;
        # if no street1 is entered, don't create the addres
        $bill_addr = undef unless $bill_addr->street1;
    }

    # DB requires this field
    $bill_addr->post_code('') if $bill_addr && !$bill_addr->post_code;

    # mailing ---
    foreach (grep /^stgma\./, $cgi->param) {
        my $val = $cgi->param($_) or next; # skip empty strings
        $val = $self->inspect_register_value($_, $val);
        s/^stgma\.//g;
        $mail_addr = Fieldmapper::staging::mailing_address_stage->new
            unless $mail_addr;
        $mail_addr->$_($val);
    }
   
    if ($mail_addr) {
        # DB requires this field
        $mail_addr->post_code('') unless $mail_addr->post_code;
        # if no street1 is entered, don't create the addres
        $mail_addr = undef unless $mail_addr->street1;
    }

    # only create the mailing address if it differs from the 
    # billing (residential) address.  We know from the form
    # data whether the user selected mailing-matches-billing, 
    # but make the comparison anyway in case the option was 
    # de-selected when the match anyway.
    $mail_addr = undef if (
        $bill_addr && 
        $mail_addr && 
        $self->addrs_match($bill_addr, $mail_addr)
    );

    if ($bill_addr) {
        my ($bstreet1, $bstreet2) = 
            OpenILS::Utils::KCLSNormalize::normalize_address_street(
                $bill_addr->street1, $bill_addr->street2);

        $bill_addr->street1($bstreet1);
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
        if ($mstreet2) {
            $mail_addr->street2($mstreet2);
        } else {
            $mail_addr->clear_street2;
        }
    }

    return ($bill_addr, $mail_addr);
}


# if the pending account is requested by an existing user account,
# load the existing user's data to pre-populate some fields.
sub collect_requestor_info {
    my $self = shift;
    return unless $self->ctx->{user};

    my $user = $self->editor->retrieve_actor_user([
        $self->ctx->{user}->id,
        {flesh => 1, flesh_fields => {
            au => [qw/mailing_address billing_address/]}
        }
    ]);


    my $vhash = $self->ctx->{register}{values} = {};
    my $addr = $user->mailing_address || $user->billing_address;
    $vhash->{stgu}{home_ou} = $user->home_ou;

    if ($addr) {
        $vhash->{stgma}{city} = $addr->city;
        $vhash->{stgma}{county} = $addr->county;
        $vhash->{stgma}{state} = $addr->state;
        $vhash->{stgma}{post_code} = $addr->post_code;
    }
}

sub collect_opt_in_settings {
    my $self = shift;
    my $e = $self->editor;

    my $types = $e->json_query({
        select => {cust => ['name']},
        from => {atevdef => 'cust'},
        transform => 'distinct',
        where => {
            '+atevdef' => {
                owner => [ map { $_ } @{ $self->ctx->{register}{valid_orgs} } ],
                active => 't'
            }
        }
    });
    $self->ctx->{register}{opt_in_settings} =
        $e->search_config_usr_setting_type({name => [map {$_->{name}} @$types]});
}

# if the username is in use by an actor.usr OR a 
# pending user treat it as taken and warn the user.
sub test_requested_username {
    my ($self, $user) = @_;
    my $uname = $user->usrname || return;
    my $e = $self->editor;

    my $taken = $e->search_actor_user(
        {usrname => $uname, deleted => 'f'}, 
        {idlist => 1}
    )->[0];

    $taken = $e->search_staging_user_stage(
        {usrname => $uname}, 
        {idlist => 1}
    )->[0] unless $taken;

    if ($taken) {
        $self->ctx->{register}{username_taken} = 1;
        $user->clear_usrname;
    }
}

# Stat cat handling is hard-coded, since there is not a one-to-one
# relationship between form options and stat cat entry values.
# We have to do some manual value mapping.
sub handle_stat_cats {
    my $self = shift;
    my $cgi = shift;

    my $stat_cats = [];

    foreach (grep /^stgsc\./, $cgi->param) {
        $logger->info(
            "registering user with stat cat values $_ => ".$cgi->param($_));
    }

    if (my $pickup_auth = $cgi->param('stgsc.5')) {
        my $stat_cat = Fieldmapper::staging::statcat_stage->new;
        $stat_cat->statcat(5);
        $stat_cat->value($pickup_auth);
        push(@$stat_cats, $stat_cat);
    }

    if (my $card_style = $cgi->param('stgsc.10')) {
        my $stat_cat = Fieldmapper::staging::statcat_stage->new;
        $stat_cat->statcat(10);
        $stat_cat->value($card_style);
        push(@$stat_cats, $stat_cat);
    }

    # Events mailing
    my $stat_cat = Fieldmapper::staging::statcat_stage->new;
    $stat_cat->statcat(3);
    $stat_cat->value((grep {$_ eq 'stgsc.3'} $cgi->param) ? 'Y' : 'N');
    push(@$stat_cats, $stat_cat);

    # Foundation mailing
    $stat_cat = Fieldmapper::staging::statcat_stage->new;
    $stat_cat->statcat(4);
    $stat_cat->value((grep {$_ eq 'stgsc.4'} $cgi->param) ? 'Y' : 'N');
    push(@$stat_cats, $stat_cat);

    return $stat_cats;
}

sub collect_register_validation_settings {
    my $self = shift;
    my $ctx = $self->ctx;
    my $e = new_editor();
    my $ctx_org = $ctx->{physical_loc} || $self->_get_search_lib;
    my $shash = $self->{register}{settings} = {};

    # retrieve the org unit setting types and values
    # that are relevant to our validation tasks.

    my $settings = $e->json_query({
        select => {coust => ['name']},
        from => 'coust',
        where => {name => {like => 'ui.patron.edit.%.%.%'}}
    });

    # load org setting values for all of the regex, 
    # example, show, and require settings
    for my $set (@$settings) {
        $set = $set->{name};
        next unless $set =~ /regex$|show$|require$|example$/;

        my $val = $ctx->{get_org_setting}->($ctx_org, $set);
        next unless $val; # no configured org setting

        # extract the field class, name, and 
        # setting type from the setting name
        my (undef, undef, undef, $cls, $field, $type) = split(/\./, $set);

        # translate classes into stage classes
        my $scls = ($cls eq 'au') ? 'stgu' : 'stgma';

        $shash->{$scls}{$field}{$type} = $val;
    }

    # use the generic phone settings where none are provided for day_phone.

    $shash->{stgu}{day_phone}{example} =
        $ctx->{get_org_setting}->($ctx_org, 'ui.patron.edit.phone.example')
        unless $shash->{stgu}{day_phone}{example};

    $shash->{stgu}{day_phone}{regex} =
        $ctx->{get_org_setting}->($ctx_org, 'ui.patron.edit.phone.regex')
        unless $shash->{stgu}{day_phone}{regex};

    # The regex OUS for username does not match the format of the other 
    # org settings.  Wrangle it into place.
    $shash->{stgu}{usrname}{regex} = 
        $ctx->{get_org_setting}->($ctx_org, 'opac.username_regex');

    # some fields are assumed to be visible / required even without the            
    # presence of org unit settings.  E.g. we obviously want the user to 
    # enter a name, since a name is required for ultimately creating a user 
    # account.  We can mimic that by forcing some org unit setting values
    
    $shash->{stgu}{first_given_name}{require} = 1
        unless defined $shash->{stgu}{first_given_name}{require};
    $shash->{stgu}{second_given_name}{show} = 1
        unless defined $shash->{stgu}{second_given_name}{show};
    $shash->{stgu}{family_name}{require} = 1
        unless defined $shash->{stgu}{family_name}{require};
    $shash->{stgma}{street1}{require} = 1
        unless defined $shash->{stgma}{street1}{require};
    $shash->{stgma}{street2}{show} = 1
        unless defined $shash->{stgma}{street2}{show};
    $shash->{stgma}{city}{require} = 1
        unless defined $shash->{stgma}{city}{require};
    $shash->{stgma}{post_code}{require} = 1
        unless defined $shash->{stgma}{post_code}{require};
    $shash->{stgu}{usrname}{show} = 1
        unless defined $shash->{stgu}{usrname}{show};

    $ctx->{register}{settings} = $shash;

    # laod the page timeout setting
    $shash->{refresh_timeout} = 
        $ctx->{get_org_setting}->($ctx_org, 'opac.self_register.timeout');
}

# inspects each value and determines, based on org unit settings, 
# if the value is invalid.  Invalid is defined as not providing 
# a value when one is required or not matching the configured regex.
sub inspect_register_value {
    my ($self, $field_path, $value) = @_;
    my $ctx = $self->ctx;
    my ($scls, $field) = split(/\./, $field_path, 2);

    if ($scls eq 'stgs') {
        my $found = 0;
        foreach my $type (@{ $self->ctx->{register}{opt_in_settings} }) {
            if ($field eq $type->name) {
                $found = 1;
            }
        }
        if (!$found) {
            $ctx->{register}{invalid}{$scls}{$field}{invalid} = 1;
            $logger->info("patron register: trying to set an opt-in ".
                          "setting $field that is not allowed.");
        }
        return;
    }

    $value ||= ''; # avoid log warnings

    $logger->info("Patron register processing value $field_path => $value");

    if (!$value) {

        if ($self->{register}{settings}{$scls}{$field}{require}) {
            $ctx->{register}{invalid}{$scls}{$field}{require} = 1;

            $logger->info("patron register field $field ".
                "requires a value, but none was entered");
        }
        return;
    }

    # KCLS JBAS-1133
    # Make (most) patron fields upper-case.
    my %keep_case = (usrname => 1, passwd => 1, email => 1);
    $value = uc($value) unless $keep_case{$field};

    # JBAS-1638 remove opening/trailing spaces
    $value =~ s/(^\s*|\s*$)//g;

    my $regex = $self->{register}{settings}{$scls}{$field}{regex};
    return $value if !$regex or $value =~ /$regex/; # field is valid

    $logger->info("invalid value was provided for patron ".
        "register field=$field; pattern=$regex; value=$value");

    $ctx->{register}{invalid}{$scls}{$field}{regex} = 1;

    return $value;
}

1;

