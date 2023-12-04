package OpenILS::WWW::OverdriveInvoice;
use strict;
use warnings;

use Apache2::Const -compile => 
    qw(OK HTTP_BAD_REQUEST FORBIDDEN HTTP_INTERNAL_SERVER_ERROR);

use CGI;
use Apache2::RequestRec ();
use Apache2::RequestIO ();
use Apache2::RequestUtil;

use IO::Scalar;
use Text::CSV;
use Data::Dumper;
$Data::Dumper::Indent = 0;

use OpenSRF::System;
use OpenSRF::Utils::Logger qw/$logger/;
use OpenSRF::Utils::JSON;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::CStoreEditor;
use OpenILS::Application::AppUtils; 

my $U = 'OpenILS::Application::AppUtils'; 
my $ORG_RECEIVER = 1531; # PR
my $PAYMENT_AUTH = 'SYSTEM';
my $PAYMENT_METHOD = 'Regular';

# set the bootstrap config and template include directory when
# this module is loaded
my $osrf_config;

sub import {
    my $self = shift;
    $osrf_config = shift;
    $logger->error("ODI Importing $osrf_config");
}

my $init_done = 0;
sub child_init {
    OpenSRF::System->bootstrap_client(config_file => $osrf_config);
    my $idl = OpenSRF::Utils::SettingsClient->new->config_value("IDL");
    Fieldmapper->import(IDL => $idl);
    $init_done = 1;
    return Apache2::Const::OK;
}

sub handler {
    my $r = shift;
    my $cgi = CGI->new;

    child_init() unless $init_done;

    my $auth = $cgi->param('ses') || $cgi->cookie('ses');

    if (!$auth) {
        $logger->error("ODI: authtoken required");
        return Apache2::Const::FORBIDDEN;
    }

    my $editor = OpenILS::Utils::CStoreEditor->new(authtoken => $auth);
    return Apache2::Const::FORBIDDEN unless $editor->checkauth;

    my $post_file = $cgi->param('csv_file') || '';

    unless ($post_file && -e $post_file) {
        $logger->error("ODI: Cannot read posted overdrive CSV file");
        return Apache2::Const::HTTP_BAD_REQUEST;
    }

    # sysread() in utf8 is deprecated / encoding as utf8 is unnecessary.
    #binmode($post_file, ":utf8");

    my ($buf, $csv_content) = ('', '');
    while (sysread($post_file, $buf, 1024)) {
        $csv_content .= $buf;
    }

    my $results = process_invoice_csv($cgi, $editor, $csv_content);
    my $json = OpenSRF::Utils::JSON->perl2JSON($results);

    $logger->info("ODI replying with: $json");

    $r->content_type('text/plain; charset=utf-8');
    $r->print($json);

    return Apache2::Const::OK;
}

# Returns the number of invoices successfully created.
sub process_invoice_csv {
    my ($cgi, $editor, $csv_content) = @_;

    my $results = {invoices => []};
    my $csv = Text::CSV->new;

    $csv_content =~ s/\R/\n/gm; # dos2unix
    $csv_content =~ s/\r/\n/gm; # dos2unix
    $csv_content =~ s/[^[:ascii:]]//gm; # remove binary cruft, etc.

    my $fh = IO::Scalar->new(\$csv_content);

    my $header = $fh->getline;

    unless ($header && $csv->parse($header)) {
        $logger->error("ODI: Unable to parse CSV header: [$header]");
        $results->{error} = "Unable to process CSV file";
        return $results;
    }

    $csv->column_names($csv->fields);

    while (my $invoice = $csv->getline_hr($fh)) {
        push(@{$results->{invoices}}, process_invoice($cgi, $editor, $invoice));
    }

    if (!$csv->eof) {
        $logger->error(
            "ODI: CSV parsing exited prematurely: " . $csv->error_diag());
    }

    $fh->close;

    return $results;
}

sub process_invoice {
    my ($cgi, $editor, $invoice_hash) = @_;
    
    my $po_id = $invoice_hash->{'Internal purchase order ID'} || '';
    my $amount = $invoice_hash->{'Amount due  (USD)'};
    my $inv_ident = $invoice_hash->{'Invoice number'};
    my $inv_date = $invoice_hash->{'Invoice date'};
    my $finalize = 0;


    if ($po_id =~ /Final/) {
        $finalize = 1;
        $po_id =~ s/-Final//g;
    }

    my $result = {
        imported => 0,
        purchase_order => $po_id
    };

    if ($po_id !~ /^\d+$/) {
        $logger->warn("ODI Skipping lookup for invalid PO number: $po_id");
        $result->{error} = "Invalid purchase order ID: $po_id";
        return $result;
    }

    # strip '$' and ',' characters (and possibly others)
    $amount =~ s/[^\d\.]//g;

    if ($inv_date) {
        # Some dates are formatted w/ 24-hour while others contain am/pm info.

        my ($month, $day, $year, $hour, $min) =
            ($inv_date =~ m|(\d{1,2})/(\d{1,2})/(\d{4}) (\d{1,2}):(\d{1,2})|);

        my $date = DateTime->new(
            year => $year,
            month => $month,
            day => $day,
            hour => $hour,
            minute => $min,
            time_zone => 'local'
        );

        $date->add(hours => 12) if ($inv_date =~ /pm/i);

        $inv_date = $date->strftime('%FT%T%z');
    }

    $result->{invoice_number} = $inv_ident;
    $result->{invoice_amount} = $amount;
    $result->{invoice_date} = $inv_date;

    $logger->info("ODI processing ".
        "'$inv_ident' for PO $po_id, amount $amount, date $inv_date");

    # Ovedrive may include invoices in the CSV file that have
    # already been created in EG.  Avoid trying to duplicate them.
    
    my $po = $editor->retrieve_acq_purchase_order($po_id);
    if (!$po) {
        $logger->warn("ODI No such purchase order $po_id");
        $result->{error} = "No purchase order found with id $po_id";
        return $result;
    }

    # Confirm view perms in case this is a dry-run.
    # Create perms will be verifid in the ACQ API call.
    if (!$editor->allowed('VIEW_INVOICE', $po->ordering_agency)) {
        $result->{error} = "Permission denied to view invoices";
        return $result;
    }

    my $existing = $editor->search_acq_invoice({
       provider => $po->provider,
       inv_ident => $inv_ident
    })->[0];

    if ($existing) {
        $logger->info("ODI invoice '$inv_ident' for provider '".  
            $po->provider . "' already exists.  Skipping");
        $result->{error} = "Invoice $inv_ident already exists.";
        return $result;
    }

    # Overdrive purchase orders should contain exactly one 
    # blanket po item.
    my $po_items = $editor->search_acq_po_item([
        {purchase_order => $po_id},
        {flesh => 1, flesh_fields => {acqpoi => ['fund']}}
    ]);

    if (scalar(@$po_items) > 1) {
        $result->{error} = "Order has too many PO Items to process";
        return $result;

    } elsif (scalar(@$po_items) == 0) {
        $result->{error} = "Order has no PO Items";
        return $result;
    }

    my $po_item = $po_items->[0];

    my $inv_type = 'EBOOKS PURCHASED';
    $inv_type = 'EBOOKS LICENSED' if ($po_item->fund->code =~ /^x/ig);

    $result->{invoice_type} = $inv_type;

    my $inv_item = Fieldmapper::acq::invoice_item->new;
    $inv_item->isnew(1);
    $inv_item->invoice(-1);
    $inv_item->po_item($po_item->id);
    $inv_item->cost_billed($amount);
    $inv_item->amount_paid($amount);

    $inv_item->$_($po_item->$_) for 
        qw/purchase_order fund fund_debit inv_item_type title author note/;

    my $invoice = Fieldmapper::acq::invoice->new;
    $invoice->isnew(1);
    $invoice->receiver($ORG_RECEIVER);
    $invoice->provider($po->provider);
    $invoice->shipper($po->provider);
    $invoice->recv_date($inv_date || 'now');
    $invoice->recv_method('PPR');
    $invoice->inv_type($inv_type);
    $invoice->inv_ident($inv_ident);
    $invoice->payment_auth($PAYMENT_AUTH);
    $invoice->payment_method($PAYMENT_METHOD);
    $invoice->close_date('now');

    if ($inv_ident =~ /CO/) {
        # CO invoices are finalized if the invoice amount matches
        # the PO amount.
        $finalize = 1 if $amount == $po_item->estimated_cost;
    }

    $logger->info("Creating invoice $inv_ident for PO $po_id and item " . 
        $po_item->title . " [amount=$amount, finalize=$finalize, type=$inv_type]");

    $result->{closing_invoice} = $finalize;

    return $result if $cgi->param('test_mode');

    my $response = $U->simplereq(
       'open-ils.acq',
       'open-ils.acq.invoice.update',
       $editor->authtoken, $invoice, [], [$inv_item], 
       $finalize ? [$po_id] : undef
    );

    if ($response && ref($response) eq 'Fieldmapper::acq::invoice') {
        $logger->info("ODI Successfully created invoice ".$response->id);
        $result->{imported} = 1;
        return $result;
    } 

    $result->{error} = $response;

    $logger->error("ODI: Error creating invoice: ".Dumper($response));
    return $result;
}

1;

