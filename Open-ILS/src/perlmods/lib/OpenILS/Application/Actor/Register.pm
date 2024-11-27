package OpenILS::Application::Actor::Register;
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
    my ($self, $client, $values) = @_;

    return OpenILS::Event->new('BAD_PARAMS') unless ref $values eq 'HASH';

    my $e = new_editor();

    my $user = Fieldmapper::staging::user_stage->new;

    # user
    for my $field (@USER_FIELDS) {
        my $val = normalize($field, $values->{user}->{$field});
        $user->$field($val);
    }

    $e->xact_begin;

    $e->create_staging_user_stage($user) 
        or return {success => 0, error => $e->die_event->{textcode}};

    $e->commit;

    return {
        success => 1,
        error => '',
    };
}

sub normalize {
    my ($field, $value) = @_;

    # KCLS JBAS-1133: Upper-case most patron field values.
    $value = uc($value) unless $field =~ /usrname|passwd|email/;

    # Trim start/end spaces.
    $value =~ s/(^\s*|\s*$)//g;

    return $value;
}

1;
