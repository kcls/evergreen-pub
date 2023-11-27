package OpenILS::WWW::EGCatLoader;
use strict; use warnings;
use Apache2::Const -compile => qw(OK FORBIDDEN HTTP_INTERNAL_SERVER_ERROR REDIRECT);
use OpenSRF::Utils::Logger qw/$logger/;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils qw/:datetime/;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Event;
use Data::Dumper;
use LWP::UserAgent;
use OpenILS::Utils::KCLSNormalize;
use DateTime;
use Digest::MD5 qw(md5_hex);
use URI::Escape;
use Net::IP;
$Data::Dumper::Indent = 0;
my $U = 'OpenILS::Application::AppUtils';

# TODO: modify the existing ezproxy/remoteauth user act type to be ezproxy/apache
my $ACTIVITY_AGENT = 'ezproxy';

# Standalone BC header/footer page for testing.
sub load_ezproxy_headerfooter {
    my $self = shift;
    $self->collect_header_footer;
    return Apache2::Const::OK;
}

sub load_ezproxy_deny {
    my $self = shift;
    $self->collect_header_footer;
    return Apache2::Const::OK;
}

sub load_ezproxy_form {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;
    my $barcode = $cgi->param('barcode');
    my $password = $cgi->param('password');
    $ctx->{url} = $cgi->param('url');
    $ctx->{qurl} = $cgi->param('qurl');

    return $self->ezproxy_trusted_redirect if $self->caller_has_trusted_ip;

    $self->collect_header_footer;

    return Apache2::Const::OK unless $barcode && $password;

    return $self->ezproxy_login;
}

sub caller_has_trusted_ip {
    my $self = shift;
    my $caller_ip = $ENV{REMOTE_ADDR};

    my $ips = $self->apache->dir_config('EZproxyExcludeIP');
    return unless $ips;

    my @ips = split(/:/, $ips);

    $logger->info("Trusted IP Addresse Ranges: [caller=$caller_ip] @ips");

    my $caller = Net::IP->new($caller_ip);

    for my $ip (@ips) {
        my $range = Net::IP->new($ip);
        if ($caller->overlaps($range) == $IP_IDENTICAL ||
            $caller->overlaps($range) == $IP_A_IN_B_OVERLAP) {
            $logger->info("Caller IP $caller_ip is in the trusted range: $range");
            return 1;
        }
    }

    return 0;
}

sub ezproxy_login {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;

    if (!$self->verify_login) {
        $ctx->{login_failed} = 1;
        return Apache2::Const::OK;
    }

    return $self->ezproxy_redirect;
}


# Returns 1 if user is authorized, 0 otherwise.
sub verify_login {
    my $self = shift;
    my $cgi = $self->cgi;
    my $barcode = $cgi->param('barcode');
    my $password = $cgi->param('password');

    my $e = new_editor();

    my $card = $e->search_actor_card([
        {barcode => $barcode},
        {flesh => 1, flesh_fields => {ac => ['usr']}}
    ])->[0];

    my $user = $card->usr if $card and $card->active eq 't';

    if (!$user) {
        $logger->warn("ezproxy: no such user $barcode");
        return 0;
    }

    if ($user->deleted eq 't') {
        $logger->warn("ezproxy: user is deleted $barcode");
        return 0;
    }

    if ($user->active eq 'f') {
        $logger->warn("ezproxy: user is not active $barcode");
        return 0;
    }

    if (!$U->verify_migrated_user_password($e, $user->id, $password)) {
        $logger->warn("ezproxy: bad password for $barcode");
        return 0;
    }

    my $expire =
        DateTime::Format::ISO8601->new->parse_datetime(
            cleanse_ISO8601($user->expire_date));

    if ($expire < DateTime->now) {
        $logger->warn("ezproxy: patron account is expired $barcode");
        return 0;
    }

    $e->requestor($user);
    if (!$e->allowed('ACCESS_EBOOKS_AND_DATABASES', $user->home_ou)) {
        $logger->warn("ezproxy: patron does not have database permission $barcode");
        return 0;
    }

    $logger->info("ezproxy: successful authentication for $barcode");

    $U->log_user_activity($user->id, $ACTIVITY_AGENT, 'verify');

    return 1;
}

sub ezproxy_trusted_redirect {
    my ($self) = @_;

    my $ctx = $self->ctx;
    my $cgi = $self->cgi;
    my $url = $cgi->param('url');
    my $qurl = $cgi->param('qurl');

    my $base_uri = $self->apache->dir_config('EZproxyBaseUri');

    $url = $qurl || uri_escape($url); # qurl= is already escaped

    my $ezproxy_url = "$base_uri/login?qurl=$url";

    $logger->info("ezproxy: trusted URL: $ezproxy_url");

    $self->apache->print($self->cgi->redirect(-url => $ezproxy_url));

    $logger->info("EZPROXY redirecting to $ezproxy_url");
    return Apache2::Const::REDIRECT;
}

sub ezproxy_redirect {
    my ($self) = @_;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;
    my $barcode = $cgi->param('barcode');
    my $password = $cgi->param('password');
    my $url = $cgi->param('url');
    my $qurl = $cgi->param('qurl');

    my $secret = $self->apache->dir_config('EZproxySecret');
    my $base_uri = $self->apache->dir_config('EZproxyBaseUri');

    my $packet = '$u' . CORE::time() . '$e';
    my $ticket = md5_hex($secret . $barcode . $packet) . $packet;

    $barcode = uri_escape($barcode);
    $ticket = uri_escape($ticket);
    $url = $qurl || uri_escape($url); # qurl is already escaped

    my $ezproxy_url =
        "$base_uri/login?user=$barcode&ticket=$ticket&qurl=$url";

    $logger->info("ezproxy: ticket URL: $ezproxy_url");

    $self->apache->print($self->cgi->redirect(-url => $ezproxy_url));

    $logger->info("EZPROXY redirecting to $ezproxy_url");
    return Apache2::Const::REDIRECT;
}

1;

