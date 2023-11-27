package OpenILS::WWW::EGCatLoader::PayflowHosted;
use strict;
use warnings;
use CGI::Util;
use LWP::UserAgent;
use UUID::Tiny qw/:std/;
use OpenSRF::Utils::Logger qw/$logger/;
my $U = 'OpenILS::Application::AppUtils';

# API servers
my $live_api_server = 'https://payflowpro.paypal.com';
my $test_api_server = 'https://pilot-payflowpro.paypal.com'; 

# Hosted Pages servers
my $live_forms_server = 'https://payflowlink.paypal.com';
my $test_forms_server = 'https://pilot-payflowlink.paypal.com';

# Creates a transaction token so the calling code can send the user
# to the hosted pages site.
#
# Params (hash):
#
# response_host => https://my-host.example.org -- used for RETURNURL, etc.
# billing_org => org unit for checking credit card AOUS values.
# payflow_params => {billing params sent to paypal}
#
# Returns (hash):
#
# secure_token      => paypal_generated_token
# secure_tokan_id   => locally_generated_token_id
# test_mode         => true/false if we're operating in test mode
# server            => paypal server where users should be directed
#
# Returns undef on error (and logs to error log).
sub create_xact_token {
    my %params = @_;

    my %settings = get_settings($params{billing_org});
    return undef unless %settings;

    # Per-transaction unique token
    (my $tokenid = create_uuid_as_string(UUID_V4)) =~ s/-//g;

    my %pf_params;
    $pf_params{PARTNER}   = $settings{partner};
    $pf_params{VENDOR}    = $settings{vendor};
    $pf_params{TRXTYPE}   = 'S';         # sale
    $pf_params{URLMETHOD} = 'POST';
    $pf_params{TEMPLATE}  = 'TEMPLATEA'; # TODO: just for testing
    $pf_params{AMT}       = sprintf("%.2f", $params{amount});
    $pf_params{USER1}     = $params{authtoken};
    $pf_params{SECURETOKENID}     = $tokenid;
    $pf_params{CREATESECURETOKEN} = 'Y';

    my $user = $params{user};

    $pf_params{COMMENT1}        = $user->card->barcode if $user->card;
    $pf_params{BILLTOFIRSTNAME} = $user->first_given_name;
    $pf_params{BILLTOLASTNAME}  = $user->family_name;
    $pf_params{BILLTOEMAIL}     = $user->email;
    $pf_params{BILLTOPHONE}     = $user->day_phone;

    if (my $addr = $user->billing_address) {
        $pf_params{BILLTOSTREET} = $addr->street1;
        $pf_params{BILLTOSTREE2} = $addr->street2;
        $pf_params{BILLTOCITY}   = $addr->city;
        $pf_params{BILLTOSTATE}  = $addr->state;
        $pf_params{BILLTOZIP}    = $addr->post_code;
    }

    if ($settings{autohosts}) {
        # Tell PP to send POST response data to this host, 
        # regardless of what's configured within PayPal.
        my $host = $params{response_host};
        $pf_params{CANCELURL} = "$host/eg/opac/biblio/main_fines";
        $pf_params{RETURNURL} = "$host/eg/opac/payflow/pay_receipt/$tokenid";
        $pf_params{ERRORURL}  = "$host/eg/opac/biblio/main_fines/$tokenid";

        # Avoid sending a Silent POST URL if we are relying instead
        # on the URL configured within the PayPal manager.
        $pf_params{SILENTPOSTURL} = "$host/eg/opac/payflow/silent_post"
            unless $settings{skip_silent_post_url};
    }

    my $api_server = $live_api_server;
    my $forms_server = $live_forms_server;
    if ($settings{testmode}) {
        $api_server = $test_api_server;
        $forms_server = $test_forms_server;
    }

    # Log the request to be sent, minus the user and password values.
    $logger->info("PayflowHosted sending to server $api_server: ".
        encode_params(%pf_params));

    # Now that we've logged the params, add the user and password
    $pf_params{USER} = $settings{login},
    $pf_params{PWD} = $settings{password},

    my $req = HTTP::Request->new(POST => $api_server);
    $req->header('content-type' => 'text/namevalue');
    $req->content(encode_params(%pf_params));

    my $resp = LWP::UserAgent->new->request($req);

    unless ($resp->is_success) {
        $logger->error(sprintf(
            "PayflowHosted HTTPS error code=%s, message=%s",
            $resp->code, $resp->message
        ));
        return undef;
    }

    my $content = $resp->decoded_content;

    # $content does not contain passwords, etc.
    $logger->info("PayflowHosted response: $content");

    my %results = parse_response($content);

    unless ($results{SECURETOKEN}) {
        $logger->error("PayflowHosted failed to return a secure token.  ".
            "Response message => " . $results{RESPMSG});

        return undef;
    }

    # Avoid leaking sensitive data.
    delete $pf_params{USER};
    delete $pf_params{PWD};

    return {
        secure_token    => $results{SECURETOKEN},
        secure_token_id => $results{SECURETOKENID},
        test_mode       => $settings{testmode},
        forms_server    => $forms_server,
        payflow_params  => \%pf_params
    };
}

# Returns a hash of settings values if the caller should continue 
# (i.e. payflowhosted is used).  Returns undef otherwise.
sub get_settings {
    my $org = shift;

    my %params;
    my $spfx = 'credit.processor.payflowhosted';

    for my $p (qw/partner vendor login password 
            testmode enabled autohosts skip_silent_post_url/) {
        $params{$p} = $U->ou_ancestor_setting_value($org, "$spfx.$p");

        if (!$params{$p} && $p !~ /testmode|autohosts|skip_silent_post_url/) {
            $logger->error("Attempt to make payment via 'payflowhosted' ".
                "with no value for org unit setting: '$spfx.$p'");
            return undef;
        }
    }

    return %params;
}

# Business::OnlinePayment::PayflowPro does not support the parameters
# necessary for Payflow Hosted Pages.  It also internally maps POST
# parameter names from "friendly" names to their PayPal equivalents,
# making it impossible to pass ad-hoc parameters.  Instead of using
# ::PayflowPro, use its request encoding and response reading code,
# since that's all we really need.


# Body (and comments) for this function copied practically verbatim from submit()
# http://search.cpan.org/~plobbes/Business-OnlinePayment-PayflowPro-1.01/PayflowPro.pm
sub encode_params {
    my %params = @_;

    # Payflow Pro does not use URL encoding for the request.  The
    # following implements their custom encoding scheme.  Per the
    # developer docs, the PARMLIST Syntax Guidelines are:
    # - Spaces are allowed in values
    # - Enclose the PARMLIST in quotation marks ("")
    # - Do not place quotation marks ("") within the body of the PARMLIST
    # - Separate all PARMLIST name-value pairs using an ampersand (&)
    #
    # Because '&' and '=' have special meanings/uses values containing
    # these special characters must be encoded using a special "length
    # tag".  The "length tag" is simply the length of the "value"
    # enclosed in square brackets ([]) and appended to the "name"
    # portion of the name-value pair.
    #
    # For more details see the sections 'Using Special Characters in
    # Values' and 'PARMLIST Syntax Guidelines' in the PayPal Payflow
    # Pro Developer's Guide
    return join(
        '&',
        map {
            my $key = $_;
            my $value = defined( $params{$key} ) ? $params{$key} : '';
            if ( index( $value, '&' ) != -1 || index( $value, '=' ) != -1 ) {
                $key = $key . "[" . length($value) . "]";
            }
            "$key=$value";
          } keys %params
    );
}

# Body for this function copied heavily from _get_response()
# http://search.cpan.org/~plobbes/Business-OnlinePayment-PayflowPro-1.01/PayflowPro.pm
sub parse_response {
    my $content = shift;
    my %response;
    return %response unless $content;

    foreach (split( /[&;]/, $content)) {
        my ($param, $value) = split('=', $_, 2);

        next unless defined $param;
        $value = '' unless defined $value;

        $param = CGI::Util::unescape($param);
        $value = CGI::Util::unescape($value);
        $response{$param} = $value;
    }

    return %response;
}

1;


__DATA__

Response blob:

TYPE=S&
RESPMSG=Approved&
ACCT=1234&
COUNTRY=US&
VISACARDLEVEL=12&
TAX=0.00&
CARDTYPE=0&
PNREF=12341EE308F6&
TENDER=CC&
AVSDATA=XXN&
METHOD=CC&
SECURETOKEN=123456NYslUGMy0tlKafELwct&
SHIPTOCOUNTRY=US&
AMT=40.00&
SECURETOKENID=12528208de1413abc3d60c86cb15&
TRANSTIME=2012-03-26+14%3A07%3A59&
HOSTCODE=A&
COUNTRYTOSHIP=US&
RESULT=0&
AUTHCODE=124PNI&


