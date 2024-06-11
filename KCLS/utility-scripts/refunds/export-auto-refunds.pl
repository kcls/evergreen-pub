#!/usr/bin/env perl
use strict; 
use warnings;
use Template;
use DateTime;
use Getopt::Long;
use OpenSRF::Utils::Logger qw/$logger/;
use OpenSRF::Utils::JSON;
use OpenSRF::AppSession;
use OpenILS::Utils::CStoreEditor;
use OpenILS::Utils::Fieldmapper;
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
my $export_session;
my @refund_responses;

sub help {
    print <<HELP;

Process automated refunds and generate CSV export of refund data.

$0

With no arguments, all currently eligible refundable transactions
will be processed and exported to CSV.

Options:

    --export-session <session_id>
        Generate CSV export of refund session using the provided
        session id (via money.refund_session.id).  
        
        This is a read-only operation.  No new refunds are processed.

    --simulate
        Run the process in simulation mode and generate CSV.

    --mrx-id <id>
        Process a single money.refundable_transaction by ID instead of
        running in batch mode.

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


sub process_refunds {

    my @params;
    my $method;

    if ($mrx_id) {
        # Process only a single transaction.
        @params = ($mrx_id);
        $method = 'open-ils.circ.refundable_xact.refund';
    } else {
        $method = 'open-ils.circ.refundable_xact.batch_process';
    }

    $method .= ".simulate" if $simulate;

    my $ses = OpenSRF::AppSession->create('open-ils.circ');
    my $req = $ses->request($method, $authtoken, @params);

    # Create and track a summary response per refundable transaction.
    my $response;
    while (my $resp = $req->recv(timeout => 3600)) {
        announce('error', $req->failed, 1) if $req->failed;                       
        my $content = $resp->content;


        if ($content->{zeroing}) {
            # Capture the first response per xact.
            $response = $content;

        } elsif (exists $content->{refund_due}) {
            # Capture refund_due from the final per-xact response.
            $response->{refund_due} = $content->{refund_due};
            push(@refund_responses, $response);
        }

        print OpenSRF::Utils::JSON->perl2JSON($content) . "\n\n";

        # session values will be the same across the batch.
        $export_session = $content->{session} if $content->{session};
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

sub export_one_mrxs {
    my $mrxs = shift; 

    my $csv_file = "$out_dir/refund-$today-".$mrxs->id.".csv";

    my $ctx = {refunds => []};

    # We stamp the address on the mrx for safe keeping, but the 
    # address could have changed since the mrx was created.
    my $addr = $mrxs->usr->billing_address || $mrxs->usr->mailing_address;

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
        usr_post_code => escape_csv($addr->post_code)
    };

    my $first = 0;
    for my $rfp (@{$mrxs->refundable_payments}) {

        my $ref = {};
        if ($first) {
            $first = 0;
            $ref = $refund;
            
        } else {
            # Clone the refund 'row' to accommodate data on multiple payments.
            $ref->{$_} = $refund->{$_} for keys %$refund;
        }

        $ref->{pay_id} = $rfp->payment->id;
        $ref->{pay_amount} = $rfp->payment->amount;
        $ref->{pay_type} = $rfp->payment->payment_type;
        $ref->{receipt_code} = escape_csv($rfp->receipt_code);

        if (my $cc = $rfp->payment->credit_card_payment) {
            $ref->{cc_order_number} = escape_csv($cc->cc_order_number);
            $ref->{cc_approval_code} = escape_csv($cc->approval_code);
            $ref->{cc_processor} = escape_csv($cc->cc_processor);
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

    open(CSV, ">$csv_file") or
        announce('error', "Cannot open CSV file for writing: $csv_file: $!");

    print CSV $output;

    close(CSV);

    if (!$simulate) {
        # TODO set erp_export_date
    }
}

sub generate_csv {

    # All refundable transactions which have been processed but
    # not yet exported
    my $mrx_list = $editor->search_money_refundable_xact([
        {refund_amount => {'>' => 0}, erp_export_date => undef},
        {idlist => 1}
    ]);


    for my $mrx (@$mrx_list) {
        announce('info', "Processing refundable transaction ".$mrx->id);

        my $mrxs = $editor->retrieve_money_refundable_xact_summary([
            $mrx->id, {
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
    'help' => \$help
) || help();

help() if $help;

osrf_connect($osrf_config);

$editor = OpenILS::Utils::CStoreEditor->new; 

$authtoken = oils_login_internal($username, 'staff')
    or die "Unable to login to Evergreen as user $username";

generate_csv();

