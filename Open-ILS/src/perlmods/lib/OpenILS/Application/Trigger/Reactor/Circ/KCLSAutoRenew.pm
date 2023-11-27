package OpenILS::Application::Trigger::Reactor::Circ::KCLSAutoRenew;
use strict; use warnings;
use base 'OpenILS::Application::Trigger::Reactor';
use OpenSRF::Utils::Logger qw/:logger/;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Application::AppUtils;
use Data::Dumper;

$Data::Dumper::Indent = 0;

my $U = 'OpenILS::Application::AppUtils';

sub ABOUT { return 'KCSL Custom Autorenew Processor'; }

sub handler {
    my $self = shift;
    my $env = shift;

    my $circ = $env->{target};

    $logger->info('Autorenew starting for circ ' . $circ->id . ' and patron ' . $circ->usr);

    # Autorenew happens via patron login.
    my $auth_resp = $U->simplereq(
        'open-ils.auth_internal', 
        'open-ils.auth_internal.session.create', {
            user_id => $circ->usr,
            org_unit => new_editor()->retrieve_actor_user($circ->usr)->home_ou,
            login_type => 'opac'
        }
    );

    my $token = $auth_resp->{payload}->{authtoken};

    my $evt = $U->simplereq(
        'open-ils.circ',
        'open-ils.circ.renew', $token, {
            patron_id => $circ->usr,
            copy_id => $circ->target_copy,
            auto_renewal => 1
        }
    );

    $logger->info('Autorenew for circ ' . $circ->id . ' returned ' . Dumper($evt));

    $evt = $evt->[0] if ref($evt) eq "ARRAY";
    my $is_renewed = $evt->{textcode} eq 'SUCCESS' ? 1 : 0;

    $logger->info('Autorenew for circ ' . $circ->id . " resulted in success=$is_renewed");

    # Create the event from the source circ instead of the
    # new circ, since the renewal may have failed.
    # Fire and do not forget so we don't flood A/T.
    $U->simplereq(
        'open-ils.trigger',
        'open-ils.trigger.event.autocreate',
        'autorenewal', $circ, $circ->circ_lib, undef, {
            is_renewed => $is_renewed,
            textcode => $evt->{textcode},
            due_date => $is_renewed ? $evt->{payload}->{circ}->due_date : $circ->due_date
        }
    );

    # Delete the temp patron session.
    # Not stricly necessary, but if we're creating thousands, may as well be tidy.
    $U->simplereq('open-ils.auth', 'open-ils.auth.session.delete', $token);

    return 1;
}

1;
