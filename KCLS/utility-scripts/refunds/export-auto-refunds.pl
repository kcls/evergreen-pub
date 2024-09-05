#!/usr/bin/env perl
use strict; 
use warnings;
use Template;
use DateTime;
use DateTime::Format::ISO8601;
use Getopt::Long;
use OpenSRF::Utils::Logger qw/$logger/;
use OpenSRF::Utils::JSON;
use OpenSRF::AppSession;
use OpenILS::Utils::CStoreEditor;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::DateTime qw/:datetime/;
require '/openils/bin/oils_header.pl';                                                      
use vars qw/$apputils/;
$ENV{OSRF_LOG_CLIENT} = 1;

my $out_dir = '/openils/var/data/auto-refunds';
my $today = DateTime->now->strftime("%F");

my $editor;
my $authtoken;
my $password;
my $osrf_config = '/openils/conf/opensrf_core.xml';
my $username = 'admin';
my $help;
my $simulate;
my $mrx_id;
my $force_create_files = 0;
my @refund_responses;

sub help {
    print <<HELP;

Generate JSON files per refund and mark the transactions as exported.

$0

With no arguments, export all refunds which have been processed
but not yet exported.

Options:

    --simulate
        Run the process in simulation mode and generate JSON.

    --mrx-id <id>
        Process a single money.refundable_transaction by ID instead of
        running in batch mode.

    --force-create-files
        Overrite existing JSON files with the same name.

    --help
        Show this message
HELP
    exit;
}


# options for level match syslog options: DEBUG,info,WARNING,ERR
sub announce {
    my ($level, $msg, $die) = @_;
    $logger->$level($msg);
    $msg = "$level: $msg";

    if ($die) {
        warn "$msg\n";
        exit 1;

    } else {
        if ($level eq 'error' or $level eq 'warn') {
            # always copy problem messages to stdout
            warn "$msg\n";
        } else {
            print "$msg\n";
        }
    }
}


sub export_one_mrxs {
    my $mrxs = shift; 

    my $ctx = {refunds => []};

    # We stamp the address on the mrx for safe keeping, but the 
    # address could have changed since the mrx was created.
    my $addr = $mrxs->usr->mailing_address || $mrxs->usr->billing_address;

    my $refund = {
        refund_amount => $mrxs->refund_amount,
        xact_id => $mrxs->xact,
        refund_session_id => $mrxs->refund_session,
        title => $mrxs->title,
        patron_barcode => $mrxs->usr->card->barcode,
        item_barcode => $mrxs->copy_barcode,
        usr_id => $mrxs->usr->id,
        usr_first_name => $mrxs->usr->first_given_name,
        usr_middle_name => $mrxs->usr->second_given_name,
        usr_family_name => $mrxs->usr->family_name,
        usr_street1 => $addr->street1,
        usr_street2 => $addr->street2,
        usr_city => $addr->city,
        usr_state => $addr->state,
        usr_post_code => $addr->post_code,
        usr_is_juvenile => $mrxs->usr->juvenile eq 't' ? 'yes' : 'no',
        refundable_payments => []
    };

    if ($refund->{usr_is_juvenile} eq 'yes') {
        $refund->{guardian} = $mrxs->usr->guardian;
    }

    my $id_padded = sprintf("%07d", $mrxs->id);
    my $json_file = "$out_dir/refund-$today-$id_padded.json";

    for my $rfp (@{$mrxs->refundable_payments}) {

        # Shortened payment type w/ logic for credit card processor
        my $ptype = $rfp->payment->payment_type;
        $ptype =~ s/_payment//g;

        if ($ptype eq 'credit_card') {
            my $proc = $rfp->cc_processor || '';
            if ($proc =~ /^Payflow/) {
                $ptype = 'paypal';
            } elsif ($proc eq 'VOUCHER') {
                $ptype = 'voucher';
            } else {
                $ptype = 'verifone';
            }
        }

        my $payment = {
            pay_id => $rfp->payment->id,
            pay_amount => $rfp->payment->amount,
            pay_type => $rfp->payment->payment_type,
            receipt_code => $rfp->receipt_code,
            payment_ts => $rfp->payment->payment_ts,
        };

        if (my $cc = $rfp->payment->credit_card_payment) {
            $payment->{cc_order_number} = $cc->cc_order_number;
            $payment->{cc_approval_code} = $cc->approval_code;
            $payment->{cc_processor} = $cc->cc_processor;
            $payment->{cc_vendor} = $ptype;
        }

        push(@{$refund->{refundable_payments}}, $payment);
    }

    if (-e $json_file && !$force_create_files) {
        announce('error', "File exists: $json_file; use --force-create-files to overwrite", 1);
    }

    open(JSON, ">$json_file") or
        announce('error', "Cannot open JSON file for writing: $json_file: $!");

    my $output = OpenSRF::Utils::JSON->perl2JSON($refund);

    print JSON "$output\n";

    close(JSON);

    return if $simulate;

    # Apply the erp export date.

    my $mrx = $editor->retrieve_money_refundable_xact($mrxs->id);

    $mrx->erp_export_date('now');

    $editor->xact_begin;

    unless ($editor->update_money_refundable_xact($mrx)) {
        announce('error', "Failed updating transaction " . $mrx->id, 1);
    }

    $editor->commit;
}

sub generate_json {

    my $mrx_list;

    if ($mrx_id) {
        $mrx_list = [$mrx_id];

    } else {
    
        # All refundable transactions which have been processed but
        # not yet exported
        $mrx_list = $editor->search_money_refundable_xact(
            {refund_amount => {'>' => 0}, erp_export_date => undef},
            {idlist => 1}
        );
    }

    for my $id (@$mrx_list) {
        announce('info', "Processing refundable transaction $id");

        my $mrxs = $editor->retrieve_money_refundable_xact_summary([
            $id, {
                flesh => 3,
                flesh_fields => {
                    mrxs => [qw/refundable_payments usr/],
                    mrps => [qw/payment/],
                    mp => [qw/credit_card_payment/],
                    au => [qw/card billing_address mailing_address/]
                }
            }
        ]);

        export_one_mrxs($mrxs);
    }
}

GetOptions(
    'simulate' => \$simulate,
    'mrx-id=s' => \$mrx_id,
    'force-create-files' => \$force_create_files,
    'help' => \$help
) || help();

help() if $help;

osrf_connect($osrf_config);

$editor = OpenILS::Utils::CStoreEditor->new; 

$authtoken = oils_login_internal($username, 'staff')
    or die "Unable to login to Evergreen as user $username";

generate_json();

