package OpenILS::WWW::EGCatLoader;
use strict; use warnings;
use Apache2::Const -compile => qw(OK FORBIDDEN HTTP_INTERNAL_SERVER_ERROR);
use OpenSRF::Utils::Logger qw/$logger/;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils qw/:datetime/;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Application::AppUtils;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Event;
use OpenSRF::Utils::Cache;
use OpenILS::Utils::KCLSNormalize;
use Data::Dumper;
use DateTime;
use Digest::MD5 qw(md5_hex);
use URI::Escape;
$Data::Dumper::Indent = 0;
my $U = 'OpenILS::Application::AppUtils';

my $cache;
sub load_ada_form {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;

    $self->collect_header_footer;

    $cache ||= OpenSRF::Utils::Cache->new('global');

    my $seskey = $cgi->param('seskey');

    # We only get a seskey after a successful patron lookup.
    # This will exit early with OK if it's not given the needed CGI params.
    return $self->lookup_patron unless $seskey;

    my $session = $cache->get_cache($seskey);

    if (!$session) {
        $ctx->{session_expired} = 1;
        return Apache2::Const::OK;
    }

    $ctx->{seskey} = $seskey;

    return $self->create_ada_request($session);
}

sub create_session {
    my $self = shift;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;

    my $seskey = md5_hex(time . rand() . $$);
    my $session = {seskey => $seskey};

    $ctx->{seskey} = $seskey;

    return $session;
}

sub normalize {
    my ($self, $string) = @_;
    $string =~ s/^\s+|\s+$//g;
    return lc($string);
}

sub lookup_patron {
    my ($self) = @_;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;
    my $e = new_editor();

    my $barcode = $ctx->{barcode} = $cgi->param('barcode');
    my $lastname = $ctx->{lastname} = $cgi->param('lastname');
    my $dob = $ctx->{dob} = $cgi->param('dob');

    $logger->info("ADA barcode=$barcode lastname=$lastname dob=$dob");

    return Apache2::Const::OK unless $barcode && $lastname && $dob;

    my $card = $e->search_actor_card([
        {barcode => $self->normalize($barcode), active => 't'},
        {flesh => 2, 
            flesh_fields => {
                ac => ['usr'], 
                au => ['billing_address', 'profile']
            }
        }
    ])->[0];

    if (!$card) {
        $logger->info("ADA no card found for barcode=$barcode");
        $ctx->{account_not_found} = 1;
        return Apache2::Const::OK;
    }

    # See if the user is already in one of our ADA groups
    # At present, they all start with 'ADA'.
    if ($card->usr->profile->name =~ /^ADA/) {
        $ctx->{account_already_ada} = 1;
        $logger->info("ADA card $barcode is already in an ADA group");
        return Apache2::Const::OK;
    }

    if ($dob ne $card->usr->dob ||
        $self->normalize($card->usr->family_name) ne $self->normalize($lastname)) {

        $ctx->{account_not_found} = 1;
        $logger->info("ADA card $barcode does not match lastname= $lastname dob=$dob");
        return Apache2::Const::OK;
    }

    $logger->info("ADA card $barcode matches provided data");

    my $session = $self->create_session;

    $session->{step_one_complete} = $ctx->{step_one_complete} = 1;

    $session->{card} = $ctx->{card} = $card;
    $ctx->{phone} = $card->usr->day_phone;
    $ctx->{email} = $card->usr->email;
    $ctx->{rationale} = '';

    if (my $addr = $card->usr->billing_address) {
        $ctx->{street1} = $addr->street1;
        $ctx->{street2} = $addr->street2;
        $ctx->{city} = $addr->city;
        $ctx->{post_code} = $addr->post_code;
    }

    my $existing = new_editor()->search_actor_ada_request(
        {usr => $card->usr->id, approve_time => undef, reject_time => undef})->[0];

    if ($existing) {
        $ctx->{pending_request_exists} = 1;
        $ctx->{step_one_complete} = 0;
        return Apache2::Const::OK;
    }

    $cache->put_cache($session->{seskey}, $session);

    return Apache2::Const::OK;
}


sub create_ada_request {
    my ($self, $session) = @_;
    my $ctx = $self->ctx;
    my $cgi = $self->cgi;

    my $street1 = $ctx->{street1} = $cgi->param('street1');
    my $street2 = $ctx->{street2} = $cgi->param('street2');
    my $city = $ctx->{city} = $cgi->param('city');
    my $post_code = $ctx->{post_code} = $cgi->param('post_code');
    my $phone = $ctx->{phone} = $cgi->param('phone');
    my $email = $ctx->{email} = $cgi->param('email');
    my $guardian = $ctx->{guardian} = $cgi->param('guardian');
    my $rationale = $ctx->{rationale} = $cgi->param('rationale');

    return Apache2::Const::OK unless 
        $session->{card} && $street1 && $city && $post_code && $rationale;

    return Apache2::Const::OK unless my $user = $session->{card}->usr;

    ($street1, $street2) = 
        OpenILS::Utils::KCLSNormalize::normalize_address_street($street1, $street2);

    my $addr = $street2 ? $street1 . ' ' . $street2 : $street1;

    my $req = Fieldmapper::actor::ada_request->new;
    $req->usr($user->id);
    $req->street1($addr);
    $req->city($city);
    $req->post_code($post_code);
    $req->phone($phone);
    $req->email($email);
    $req->guardian($guardian);
    $req->rationale($rationale);

    my $e = new_editor(xact => 1);

    unless ($e->create_actor_ada_request($req)) {
        $e->rollback;
        return Apache2::Const::HTTP_INTERNAL_SERVER_ERROR;
    }
    $e->commit;

    $U->create_events_for_hook('au.ada_request', $req, $user->home_ou);
    
    $cache->delete_cache($session->{seskey});
    delete $ctx->{seskey};


    $ctx->{step_one_complete} = 1;
    $ctx->{step_two_complete} = 1;

    return Apache2::Const::OK;
}

1;


