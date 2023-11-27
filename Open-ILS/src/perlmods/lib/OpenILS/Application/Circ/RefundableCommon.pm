# ---------------------------------------------------------------
# Copyright (C) 2020 King County Library System
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
package OpenILS::Application::Circ::RefundableCommon;
use strict; use warnings;
use base qw/OpenILS::Application/;
use OpenSRF::Utils::Cache;
use OpenSRF::Utils::Logger qw/:logger/;
use OpenILS::Application::AppUtils;
use OpenILS::Event;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Application::Circ::CircCommon;
use Digest::MD5 qw(md5_hex);
use Net::LDAP;
use Net::LDAP::Constant qw[LDAP_INVALID_CREDENTIALS];
my $U = "OpenILS::Application::AppUtils";

my $ldap_timeout = 30; # server connection timeout
my $ldap_key_timeout = 600; # 2ndary auth token timeout
my $ldap_key_prefix = 'ldap_auth_';

# Credit Card payments are automatically authorized.
# Creat a dummy auth entry.
sub create_ldap_auth_entry {
    my ($class, $username, $name, $email) = @_;

    my $key = md5_hex($$.rand().time);

    OpenSRF::Utils::Cache->new('global')->put_cache(
        $ldap_key_prefix.$key, {
            username => $username,
            staff_name => $name,
            staff_email => $email
        }, 
        $ldap_key_timeout
    );

    return $key;
}

sub check_ldap_auth {
    my ($class, $e, $username, $password) = @_;

    my $ldap_server = $U->ou_ancestor_setting_value(
        $e->requestor->ws_ou, 'circ.secondary_auth.ldap.server', $e);

    return {evt => OpenILS::Event->new('LDAP_CONNECTION_ERROR')} unless $ldap_server;

    my $connection = Net::LDAP->new($ldap_server, timeout => $ldap_timeout);

    if (!$connection) {
        $logger->error("Cannot connect to LDAP server $ldap_server : $!");
        return {evt => OpenILS::Event->new('LDAP_CONNECTION_ERROR')};
    }

    my $message = $connection->bind($username, password => $password);

    if ($message->is_error) {

        if ($message->code == LDAP_INVALID_CREDENTIALS) {
            $logger->info("LDAP auth failed for $username");
            return {evt => OpenILS::Event->new('LDAP_AUTH_FAILED')};
        }

        # Something else went wrong...
        my $error = $message->error;
        $logger->error("LDAP auth for $username returned an error: $error");
        return {evt => OpenILS::Event->new('LDAP_CONNECTION_ERROR')};
    }

    # Bind succeeded.  Now lookup user info.

    my $users_dn = $U->ou_ancestor_setting_value(
        $e->requestor->ws_ou, 'circ.secondary_auth.ldap.users_dn', $e);

    # Defaults to ActiveDirectory-style attributes
    my $users_filter = $U->ou_ancestor_setting_value(
        $e->requestor->ws_ou, 'circ.secondary_auth.ldap.users_filter', $e) ||
        '(&(objectCategory=person)(objectClass=user)(userPrincipalName=%s))';

    $users_filter = sprintf($users_filter, $username);

    my $search = $connection->search(
        base => $users_dn, scope => 'sub', filter => $users_filter);

    my $resp = {};
    if ($search->count == 0) {
        $logger->error("LDAP name lookup returned 0 results.");
    } else {
        my $entry = $search->entry(0);
        $resp->{staff_name} = $entry->get_value('cn');
        $resp->{staff_email} = $entry->get_value('mail');
    }

    unless ($resp->{staff_name} && $resp->{staff_email}) {
        $logger->error("LDAP name lookup failed. ".
            "QUERY: DN=$users_dn ; FILTER=$users_filter");
        return {evt => OpenILS::Event->new('LDAP_CONNECTION_ERROR')};
    }

    $connection->unbind;
    $logger->info("LDAP auth succeeded for $username");

    return $resp;
}

sub get_ldap_auth_entry {
    my ($class, $secondary_auth_key) = @_;

    my $ldap_auth = OpenSRF::Utils::Cache->new('global')
        ->get_cache($ldap_key_prefix.$secondary_auth_key);

    unless ($ldap_auth) {
        $logger->error("Payment attempted with ".
            "invalid secondary auth key: $secondary_auth_key");
        return undef;
    }

    return $ldap_auth;
}


# Called from the payment create API.
# Caller is responsible for commits and rollbacks
# Newly created refundable_payment.id's are pushed into $respond_payments
# so the caller can see what we did.
# Returns undef on success, Event on error.
sub create_refundable_payment {
    my ($class, $e, $secondary_auth_key, $payment_id, $options, $respond_payments) = @_;
    $options ||= {};

    my $ldap_auth = $class->get_ldap_auth_entry($secondary_auth_key);

    unless ($ldap_auth) {
        $logger->error("Refundable payment attempted with ".
            "invalid secondary auth key: $secondary_auth_key");
        return OpenILS::Event->new('LDAP_AUTH_FAILED');
    }

    my $payment = $e->retrieve_money_payment([
        $payment_id, {
            flesh => 2, 
            flesh_fields => {
                mp => ['xact'],
                mbt => ['summary']
            }
        }
    ]) or return $e->die_event;

    # refundable payments may only be applied to circulations.
    my $circ = $e->retrieve_action_circulation([
        $payment->xact->id, {
            flesh => 2,
            flesh_fields => {
                circ => ['usr', 'target_copy'],
                au => [qw/card billing_address mailing_address addresses/]
            }
        }
    ]) or return $e->die_event;

    my $usr = $circ->usr;

    my $addr = $usr->billing_address || 
        $usr->mailing_address || $usr->addresses->[0];

    if (!$addr) {
        $addr = Fieldmapper::actor::user_address->new;
        $addr->street1('NONE');
        $addr->city('NONE');
        $addr->state('NONE');
        $addr->post_code('NONE');
    }

    my $mrx = $e->search_money_refundable_xact({xact => $payment->xact->id})->[0];

    if (!$mrx) {
        # Create the refundable transaction before linking the payment.

        $mrx = Fieldmapper::money::refundable_xact->new;
        $mrx->xact($payment->xact->id);
        $mrx->usr_first_name($usr->first_given_name);
        $mrx->usr_middle_name($usr->second_given_name);
        $mrx->usr_family_name($usr->family_name);
        $mrx->usr_barcode($usr->card->barcode);
        $mrx->usr_street1($addr->street1);
        $mrx->usr_street2($addr->street2);
        $mrx->usr_city($addr->city);
        # The state field is NULL-able in actor.usr_address but not in
        # money.refundable_xact.
        $mrx->usr_state($addr->state || '');
        $mrx->usr_post_code($addr->post_code);
        $mrx->item_price($U->get_copy_price($e, $circ->target_copy));

        $e->create_money_refundable_xact($mrx) or return $e->die_event;
    }

    my $accepting_usr;
    my $ctx_org_id;

    my $desk_payment = $e->retrieve_money_desk_payment($payment->id);

    # credit card payments are "desk payments" but online 
    # card payments will not have a cash_drawer value.
    if ($desk_payment && $desk_payment->cash_drawer) {
        $ctx_org_id = 
            $e->retrieve_actor_workstation($desk_payment->cash_drawer)->owning_lib;
        $accepting_usr = $e->retrieve_actor_user($desk_payment->accepting_usr);

    } else {
        $ctx_org_id = $circ->circ_lib;
        $accepting_usr = $usr;
    }

    # Perm check not needed since this is called from payment create API.
    # return $e->die_event unless $e->allowed('CREATE_PAYMENT', $ctx_org_id);

    my $mrp = Fieldmapper::money::refundable_payment->new;
    $mrp->refundable_xact($mrx->id);
    $mrp->payment($payment->id);
    $mrp->payment_ou($ctx_org_id);

    $mrp->final_payment('f') if $payment->xact->summary->balance_owed != 0;

    $mrp->staff_name($ldap_auth->{staff_name});
    $mrp->staff_email($ldap_auth->{staff_email});

    $e->create_money_refundable_payment($mrp) or return $e->die_event;

    push(@$respond_payments, $mrp->id) if $respond_payments;

    return undef;
}

# Returns 1 if the transaction was successfully processed one 
# way or the other.  Returns undef on error.
sub close_xact_if_possible {
    my ($class, $e, $xact_id) = @_;

    my $xact = $e->retrieve_money_billable_transaction([
        $xact_id, {
            flesh => 1, 
            flesh_fields => {mbt => ['circulation', 'summary']}
        }
    ]);

    return 1 if $xact->xact_finish;
    return 1 if $xact->summary->balance_owed != 0;

    if ($xact->circulation) { # could be a grocery
        return 1 unless OpenILS::Application::Circ::CircCommon
            ->can_close_circ($e, $xact->circulation);
    }

    $logger->info("refund: closing xact $xact_id after refunds applied");
    $xact->xact_finish('now');

    return $e->update_money_billable_transaction($xact) ? 1 : undef;
}

# Returns a list of $mobts hashes.  The first item in the list will
# always be the $mobts of the mrxs transaction, regardless of whether
# a balance is still owed in the main tranaction!
#
# This is followed by set of transactions linked to the mrxs user where
# a positive balance is owed.  Transactions are sorted oldest to newest,
# except that LOST transactions are always sorted to the end.  If this 
# is a CC payment ($skip_lost=1) then no lost transactions are included.
#
# $refund_amount is used to limit the total number of transactions we
# exctract from the database, since we can only refund for as much money
# is owed back to the patron.
sub find_xacts_to_refund {
    my ($class, $e, $mrxs, $refund_amount, $skip_lost) = @_;

    my @mobts;
    my $found_amount = 0;

    my $mobts = $e->json_query({
        select => {mobts => ['id', 'balance_owed']},
        from => 'mobts',
        where => {id => $mrxs->xact}
    })->[0];

    $found_amount = $mobts->{balance_owed} if $mobts;

    push(@mobts, $mobts);

    # Start with non-lost transactions
    my $query = {
        select => {mobts => ['id', 'balance_owed']},
        from => 'mobts',
        where => {
            usr => $mrxs->usr,
            id => {'<>' => $mrxs->xact},
            balance_owed => {'>' => 0},
            '-not-exists' => {
                select => {mb => ['id']},
                from => 'mb',
                where => {
                    '+mb' => {
                        xact => $mrxs->xact,
                        btype => 3, # Lost Materials
                        voided => 'f'
                    }
                }
            }
        },
        order_by => [
            {class => 'mobts', field => 'xact_start'},
            {class => 'mobts', field => 'id'} # tie-breaker
        ], 
        limit => 1,
        offset => 0
    };

    while ($found_amount < $refund_amount) {
        $mobts = $e->json_query($query)->[0];
        $query->{offset}++;

        if ($mobts) {
            push(@mobts, $mobts);
            $found_amount = $U->fpsum($found_amount, $mobts->{balance_owed});

        } else {
            last if $skip_lost;
            # Indicate we're now in lost xact fetching mode and toggle
            # the lost transaction filter so the query only returns
            # lost transactions.
            $skip_lost = 1; 
            $query->{offset} = 0;
            $query->{where}->{'-exists'} = delete $query->{where}->{'-not-exists'};
        }
    }

    if ($found_amount >= $refund_amount) {
        $logger->info("refund: patron owes $found_amount in the ".
            "selected batch of applicable transactions.");
    }

    my @ids = map {$_->{id}} @mobts;
    $logger->info("refund: trying to refund xacts: @ids");

    # We have found enough transactions to consume the refundable money
    # or we've run out of positive-balance transactions to refund.
    return @mobts;
}

# Returns 'mrx' object if the circ (by id) in question has an active
# automated refund, which has not been processed, paused, or rejected.
# Returns undef otherwise.
sub circ_has_active_refund {
    my ($class, $circ_id, $e) = @_;
    $e ||= new_editor();

    # eligible ref xact only includes 
    my $merx = $e->search_money_eligible_refundable_xact(
        {xact => $circ_id})->[0];

    my $mrx = $e->retrieve_money_refundable_xact($merx->id) if $merx;

    return ($mrx && !$mrx->pause_date && !$mrx->reject_date) ? $mrx : undef;
}


# $args->{pause_refund} pauses the refund.
# $args->{refund_notes} modifis mrx notes regardless of pausing.
# Assumes $e is within a transaction and has a requestor.
# Returns (bool, event) -- bool=true if any changes were made.
sub maybe_pause_refund {
    my ($class, $mrx, $args, $e) = @_;

    if ($args->{pause_refund}) {

        $logger->info("Pausing refund for mrx ".$mrx->id);

        # Clear any other state information
        $mrx->clear_approve_date;
        $mrx->clear_approved_by;
        $mrx->clear_reject_date;
        $mrx->clear_rejected_by;

        $mrx->pause_date('now');
        $mrx->paused_by($e->requestor->id);
        $mrx->notes($args->{refund_notes}) if $args->{refund_notes};

        $e->update_money_refundable_xact($mrx) or return (0, $e->die_event);

        return (1);

    } elsif ($args->{refund_notes}) {

        # Staff may have refund notes to add regardless of
        # whether they are pausing the refund.
        $mrx->notes($args->{refund_notes});
        $e->update_money_refundable_xact($mrx) or return (0, $e->die_event);

        return (1);
    }

    return (0);
}

1;

