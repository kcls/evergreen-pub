# ---------------------------------------------------------------
# Copyright (C) 2017 King County Library System
# Bill Erickson <berickxx@gmail.com>
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# ---------------------------------------------------------------
#
# KCLS JBAS-1306 Lost+Paid Refundable Payments Tracking
#
# ---------------------------------------------------------------
package OpenILS::Application::Circ::RefundableApi;
use strict; use warnings;
use base qw/OpenILS::Application/;
use OpenSRF::Utils::Cache;
use OpenSRF::Utils::Logger qw/:logger/;
use OpenILS::Application::AppUtils;
use OpenILS::Event;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Application::Circ::CircCommon;
use OpenILS::Application::Circ::RefundableCommon;
use OpenILS::Utils::DateTime qw/:datetime/;
use DateTime::Format::ISO8601;
my $U = "OpenILS::Application::AppUtils";
my $RFC = 'OpenILS::Application::Circ::RefundableCommon';

# XXX
# XXX Add this API to the log_protect section in opensrf_core.xml
# XXX

__PACKAGE__->register_method(
    method    => 'authenticate_ldap',
    api_name  => 'open-ils.circ.staff.secondary_auth.ldap',
    signature => {
        desc   => q/Verifies secondary credentials via LDAP/,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Username.  No domain info', type => 'string'},
            {desc => 'Password', type => 'string'}
        ],
        return => {desc => 
            'Temporary authentication key on success, Event on error'}
    }
);

sub authenticate_ldap {
    my ($self, $client, $auth, $username, $password) = @_;

    return OpenILS::Event->new('BAD_PARAMS') 
        unless $auth && $username && $password;

    # Secondary auth checks require an authenticated staff account.
    my $e = new_editor(authtoken => $auth); # no xact!
    return $e->event unless $e->checkauth;
    return $e->event unless $e->allowed('STAFF_LOGIN');

    if ($username !~ /@/) {
        # A bare username requires a domain.  

        my $ldap_domain = $U->ou_ancestor_setting_value(
            $e->requestor->ws_ou, 'circ.secondary_auth.ldap.domain', $e);

        return OpenILS::Event->new('LDAP_CONNECTION_ERROR') 
            unless $ldap_domain;

        $username = "$username\@$ldap_domain";
    }

    $logger->info("LDAP auth request called for $username");

    my $testmode = $U->ou_ancestor_setting_value(
        $e->requestor->ws_ou, 'circ.secondary_auth.ldap.testmode', $e);

    my $ldap_resp;
    if ($testmode) {
        $logger->info("LDAP auth skipping check in testmode");
        $ldap_resp = {
            staff_name =>'Test Mode Name',
            staff_email => $username
        };

    } else {
        $ldap_resp = $RFC->check_ldap_auth($e, $username, $password);
        return $ldap_resp->{evt} if $ldap_resp->{evt};
    }

    return $RFC->create_ldap_auth_entry(
        undef, $username, $ldap_resp->{staff_name}, $ldap_resp->{staff_email}
    );
}

__PACKAGE__->register_method(
    method    => 'update_refundable_xact',
    api_name  => 'open-ils.circ.refundable_xact.update',
    signature => {
        desc   => q/Modify a money.refundable_xact'/,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Transaction ID', type => 'number'},
            {desc => 'Arguments', type => 'hash'}
        ],
        return => {desc => '1 on success, 0 on no-op, Event on error'}
    }
);

sub update_refundable_xact {
    my ($self, $client, $auth, $mrx_id, $args) = @_;
    return 0 unless ref $args;

    my $e = new_editor(authtoken => $auth, xact => 1);
    return $e->die_event unless $e->checkauth;
    return $e->die_event unless $e->allowed('MANAGE_REFUNDABLE_XACT');

    my $mrx = $e->retrieve_money_refundable_xact($mrx_id)
        or return $e->die_event;

    my $user = $e->retrieve_money_billable_transaction([
        $mrx->xact, {flesh => 1, flesh_fields => {mbt => ['usr']}}
    ])->usr;

    for my $f (qw/refund_amount notes/) {
        $mrx->$f($args->{$f}) if defined $args->{$f};
    }

    if ($args->{approve}) {

        return $e->die_event unless 
            $e->allowed('APPROVE_REFUND', $user->home_ou);

        if ($args->{undo}) {
            $mrx->clear_approve_date;
            $mrx->clear_approved_by;
        } else {
            $mrx->approve_date('now');
            $mrx->approved_by($e->requestor->id);
        }

        $mrx->clear_reject_date;
        $mrx->clear_rejected_by;
        # leave pause state values for historical purposes.
        # this will override the pause state.

    } elsif ($args->{reject}) {

        return $e->die_event unless 
            $e->allowed('APPROVE_REFUND', $user->home_ou);

        if ($args->{undo}) {
            $mrx->clear_reject_date;
            $mrx->clear_rejected_by;
        } else {
            $mrx->reject_date('now');
            $mrx->rejected_by($e->requestor->id);
        }

        $mrx->clear_approve_date;
        $mrx->clear_approved_by;
        # leave pause state values for historical purposes.
        # this will override the pause state.

    } elsif ($args->{pause}) {

        if ($args->{undo}) {
            $mrx->clear_pause_date;
            $mrx->clear_paused_by;
        } else {
            $mrx->pause_date('now');
            $mrx->paused_by($e->requestor->id);
        }

        $mrx->clear_approve_date;
        $mrx->clear_approved_by;
        $mrx->clear_reject_date;
        $mrx->clear_rejected_by;
    }

    $e->update_money_refundable_xact($mrx) or return $e->die_event;
    $e->commit;

    return 1;
}

__PACKAGE__->register_method(
    method    => 'refund_summary_data',
    api_name  => 'open-ils.circ.refundable_payment.letter.by_xact.data',
    signature => {
        desc   => q/
            Collect data needed to print a refund summary.
            Caller may provide the lost circ ID or a the ID of
            a refund payment linked to the desired refund session.
        /,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Billable Transaction ID', type => 'number'},
            {desc => 'Payment ID', type => 'number'}
        ],
        return => {
            desc => 'Hash of refund summary data'
        }
    }
);

sub refund_summary_data {
    my ($self, $client, $auth, $xact_id, $pay_id) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;

    my $query = {xact => $xact_id};

    if ($pay_id) {
        # Caller provided the ID of a refund payment
        my $session = $e->search_money_refund_action({payment => $pay_id})->[0]
            or return $e->event;

        $query = {id => $session->refundable_xact};
    }

    my $ref_xact = $e->search_money_refundable_xact_summary([
        $query,
        {   
            flesh => 3, 
            flesh_fields => {
                mrxs => ['usr', 'refundable_payments', 'xact'],
                mbt => ['summary'],
                mrps => ['payment'],
                au => ['billing_address', 'mailing_address']
            }
        }
    ])->[0] or return $e->event;

    return OpenILS::Event->new('XACT_NOT_REFUNDED')
        unless defined $ref_xact->refund_session;

    return $e->event unless 
        $e->allowed('VIEW_USER_TRANSACTIONS', $ref_xact->usr->home_ou);

    my $ref_actions = $e->search_money_refund_action([{
        refundable_xact => $ref_xact->id
    }, {
        flesh => 7, 
        flesh_fields => {
            mract => ['payment'],
            mp => ['xact'],
            mbt => ['circulation', 'summary'],
            circ => ['target_copy'],
            acp => ['call_number'],
            acn => ['record'],
            bre => ['simple_record']
        }
    }]);

    return {
        refundable_xact => $ref_xact,
        refund_actions => $ref_actions,
    };
}


__PACKAGE__->register_method(
    method    => 'generate_refundable_payment_receipt',
    api_name  => 'open-ils.circ.refundable_payment.receipt.html',
    signature => {
        desc   => q/Generate a printable HTML refundable payment receipt/,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Refundable Payment ID', type => 'number'}
        ],
        return => {
            desc => 'A/T event with fleshed outputs on success, event on error'
        }
    }
);

__PACKAGE__->register_method(
    method    => 'generate_refundable_payment_receipt',
    api_name  => 'open-ils.circ.refundable_payment.receipt.by_xact.html',
    signature => {
        desc   => q/Generate a printable HTML refundable payment receipt
            for the latest payment on the given billable transaction ID/,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Billable Transaction ID', type => 'number'}
        ],
        return => {
            desc => 'A/T event with fleshed outputs on success, event on error'
        }
    }
);

__PACKAGE__->register_method(
    method    => 'generate_refundable_payment_receipt',
    api_name  => 'open-ils.circ.refundable_payment.receipt.by_pay.html',
    signature => {
        desc   => q/Generate a printable HTML refundable payment receipt
            for the requested money.payment entry/,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Source Payment ID', type => 'number'}
        ],
        return => {
            desc => 'A/T event with fleshed outputs on success, event on error'
        }
    }
);


__PACKAGE__->register_method(
    method    => 'generate_refundable_payment_receipt',
    api_name  => 'open-ils.circ.refundable_payment.receipt.email',
    signature => {
        desc   => q/Generate an email refundable payment receipt/,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Refundable Payment ID', type => 'number'}
        ],
        return => {
            desc => 'Undef on success, event on error'
        }
    }
);

sub generate_refundable_payment_receipt {
    my ($self, $client, $auth, $target_id) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;

    my $mrps;
    if ($self->api_name =~ /by_xact/) {

        my $mrxs = $e->search_money_refundable_xact_summary([
            {xact => $target_id},
            {   flesh => 2, 
                flesh_fields => {
                    mrxs => ['refundable_payments'],
                    mrps => ['payment']
                }
            }
        ])->[0] or return $e->event;

        # Print the most recent payment.
        my @payments = @{$mrxs->refundable_payments};
        @payments = 
            sort {$a->payment->payment_ts cmp $b->payment->payment_ts} @payments;
        $mrps = pop(@payments);

        # sync the fleshing for below
        $mrxs->clear_refundable_payments;
        $mrps->refundable_xact($mrxs);

    } elsif ($self->api_name =~ /by_pay/) {

        $mrps = $e->search_money_refundable_payment_summary([
            {payment => $target_id},
            {flesh => 1, flesh_fields => {mrps => ['refundable_xact']}}
        ])->[0] or return $e->event;

    } else {

        $mrps = $e->retrieve_money_refundable_payment_summary([
            $target_id, 
            {flesh => 1, flesh_fields => {mrps => ['refundable_xact']}}
        ]) or return $e->event;
    }

    # ->usr may be undef when the transaction in question has been purged.
    # Patrons do not need to print receipts for purged transactions.
    if ($mrps->refundable_xact->usr && 
        $mrps->refundable_xact->usr == $e->requestor->id) {

        # Patrons are allowed to print receipts for their own payments.
        # Nothing to verify here.

    } else {
        return $e->event unless 
            $e->allowed('CREATE_PAYMENT', $mrps->payment_ou);
    }

    if ($self->api_name =~ /html/) {

        return $U->fire_object_event(
            undef, 'format.mrps.html', $mrps, $mrps->payment_ou);

    } else {

        $U->create_events_for_hook(
            'format.mrps.email', $mrps, $mrps->payment_ou, undef, undef, 1);
        return undef;
    }
}

__PACKAGE__->register_method(
    method    => 'retrieve_refundable_payment',
    api_name  => 'open-ils.circ.refundable_payment.retrieve.by_payment',
    signature => {
        desc   => q/Return a refundable payment by money.payment.id/,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Payment (mp.id) ID', type => 'number'}
        ],
        return => {
            desc => 'Refundable payment object on success, undef on not-found'
        }
    }
);

# NOTE: adding this for XUL client -- browser client just uses pcrud.
sub retrieve_refundable_payment {
    my ($self, $client, $auth, $payment_id) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;
    return $e->event unless $e->allowed('STAFF_LOGIN');

    return $e->search_money_refundable_payment({payment => $payment_id})->[0]; 
}


__PACKAGE__->register_method(
    method    => 'circ_is_refundable',
    api_name  => 'open-ils.circ.refundable_payment.circ.refundable',
    signature => {
        desc   => q/Returns 1 if payments toward the requested circulation
            would be refundable.  Returns 0 otherwise./,
        params => [
            {desc => 'Authentication token', type => 'string'},
            {desc => 'Circulation (circ.id) ID', type => 'number'}
        ],
        return => {
            desc => '1 on true, 0 on false'
        }
    }
);

sub circ_is_refundable {
    my ($self, $client, $auth, $circ_id) = @_;

    my $e = new_editor(authtoken => $auth);
    return $e->event unless $e->checkauth;
    return $e->event unless $e->allowed('STAFF_LOGIN');
    return $U->circ_is_refundable($circ_id, $e);
}

1;

