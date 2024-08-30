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
my $csv_template = 'refund-session-csv.tt2';
my $today = DateTime->now->strftime("%F");

my $editor;
my $authtoken;
my $password;
my $osrf_config = '/openils/conf/opensrf_core.xml';
my $username = 'admin';
my $help;
my $simulate;
my $mrx_id;
my $force_create_csv = 0;
my @refund_responses;

sub help {
    print <<HELP;

Generate CSV files per refund session and mark the transactions as exported.

$0

With no arguments, export all refunds which have been processed
but not yet exported.

Options:

    --simulate
        Run the process in simulation mode and generate CSV.

    --mrx-id <id>
        Process a single money.refundable_transaction by ID instead of
        running in batch mode.

    --force-create-csv
        Overrite existing CSV files with the same name.

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

sub escape_csv {                                                         
    my $str = shift || '';

    # Remove leading/trailing spaces
    $str =~ s/^\s+|\s+$//g;
    # Collapse multi-space values down to a single space
    $str =~ s/\s\s+/ /g;

    if ($str =~ /\,/ || $str =~ /"/) {                                     
        $str =~ s/"/""/g;                                                  
        $str = '"' . $str . '"';                                           
    }                                                                      
    return $str;                                                           
}

# Turn an ISO date into something TT can parse.
sub format_date {
    my $date = shift;

    $date = DateTime::Format::ISO8601->new->parse_datetime(clean_ISO8601($date));

    return sprintf(
        "%0.2d:%0.2d:%0.2d %0.2d-%0.2d-%0.4d",
        $date->hour,
        $date->minute,
        $date->second,
        $date->day,
        $date->month,
        $date->year
    );
}


sub export_one_mrxs {
    my $mrxs = shift; 


    my $ctx = {refunds => []};

    # We stamp the address on the mrx for safe keeping, but the 
    # address could have changed since the mrx was created.
    my $addr = $mrxs->usr->mailing_address || $mrxs->usr->billing_address;

    my $refund = {
        refund_amount => escape_csv($mrxs->refund_amount),
        xact_id => escape_csv($mrxs->xact),
        refund_session_id => escape_csv($mrxs->refund_session),
        title => escape_csv($mrxs->title),
        patron_barcode => escape_csv($mrxs->usr->card->barcode),
        item_barcode => escape_csv($mrxs->copy_barcode),
        usr_id => escape_csv($mrxs->usr->id),
        usr_first_name => escape_csv($mrxs->usr->first_given_name),
        usr_middle_name => escape_csv($mrxs->usr->second_given_name),
        usr_family_name => escape_csv($mrxs->usr->family_name),
        usr_street1 => escape_csv($addr->street1),
        usr_street2 => escape_csv($addr->street2),
        usr_city => escape_csv($addr->city),
        usr_state => escape_csv($addr->state),
        usr_post_code => escape_csv($addr->post_code),
        usr_is_juvenile => $mrxs->usr->juvenile eq 't' ? 'yes' : 'no'
    };

    if ($refund->{usr_is_juvenile} eq 'yes') {
        $refund->{guardian} = $mrxs->usr->guardian;
    }

    my $csv_file;
    my $first = 1;
    for my $rfp (@{$mrxs->refundable_payments}) {

        # Shortened payment type w/ logic for credit card processor
        my $ptype = $rfp->payment->payment_type;
        $ptype =~ s/_payment//g;

        if ($ptype eq 'credit_card') {
            my $proc = $rfp->payment->cc_processor || '';
            if ($proc =~ /^Payflow/) {
                $ptype = 'paypal';
            } else {
                # Is this universally true?  what about vouchers?
                $ptype = 'verifone';
            }
        }

        my $ref = {};
        if ($first) {
            $first = 0;
            $ref = $refund;

            # Stamp the csv file name with the type of the first payment.
            $csv_file = "$out_dir/refund-$today-$ptype-".$mrxs->id.".csv";
            
        } else {
            # Clone the refund 'row' to accommodate data on multiple payments.
            $ref->{$_} = $refund->{$_} for keys %$refund;
        }

        $ref->{pay_id} = $rfp->payment->id;
        $ref->{pay_amount} = $rfp->payment->amount;
        $ref->{pay_type} = $rfp->payment->payment_type;
        $ref->{receipt_code} = escape_csv($rfp->receipt_code);
        $ref->{payment_ts} = format_date($rfp->payment->payment_ts);

        if (my $cc = $rfp->payment->credit_card_payment) {
            $ref->{cc_order_number} = escape_csv($cc->cc_order_number);
            $ref->{cc_approval_code} = escape_csv($cc->approval_code);
            $ref->{cc_processor} = escape_csv($cc->cc_processor);
            $ref->{cc_vendor} = escape_csv($ptype);
        }

        push(@{$ctx->{refunds}}, $ref);
    }

    my $tt = Template->new;
    my $output = '';
    my $error;
    unless($tt->process($csv_template, $ctx, \$output)) {
        $output = undef;
        ($error = $tt->error) =~ s/\n/ /og;
        announce('error', "Error processing CSV template: $error");
        return;
    }

    if (-e $csv_file && !$force_create_csv) {
        announce('error', "File exists: $csv_file; use --force-create-csv to overwrite", 1);
    }

    open(CSV, ">$csv_file") or
        announce('error', "Cannot open CSV file for writing: $csv_file: $!");

    print CSV $output;

    close(CSV);

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

sub generate_csv {

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
    'force-create-csv' => \$force_create_csv,
    'help' => \$help
) || help();

help() if $help;

osrf_connect($osrf_config);

$editor = OpenILS::Utils::CStoreEditor->new; 

$authtoken = oils_login_internal($username, 'staff')
    or die "Unable to login to Evergreen as user $username";

generate_csv();

