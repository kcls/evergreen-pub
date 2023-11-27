#!/usr/bin/perl

#    This CGI script might be useful for providing an easy way for EZproxy to authenticate
#    users against an Evergreen instance.
#    
#    For example, if you modify your eg.conf by adding this:
#    Alias "/cgi-bin/ezproxy/" "/openils/var/cgi-bin/ezproxy/"
#    <Directory "/openils/var/cgi-bin/ezproxy">
#        AddHandler cgi-script .pl
#        AllowOverride None
#        Options +ExecCGI
#        allow from all
#    </Directory>
#    
#    and make that directory and copy remoteauth.cgi to it:
#    mkdir /openils/var/cgi-bin/ezproxy/
#    cp remoteauth.cgi /openils/var/cgi-bin/ezproxy/
#    
#    Then you could add a line like this to the users.txt of your EZproxy instance:
#    
#    ::external=https://hostname/cgi-bin/ezproxy/remoteauth.cgi,post=user=^u&passwd=^p
#

use strict;
use warnings;

use CGI;
use DateTime;
use DateTime::Format::ISO8601;
use OpenSRF::Utils qw/:datetime/;
use OpenSRF::Utils::Logger qw/$logger/;

use OpenSRF::System;
use OpenSRF::AppSession;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Application::AppUtils;
my $U = 'OpenILS::Application::AppUtils';

my $bootstrap = '/openils/conf/opensrf_core.xml';
my $cgi = new CGI;
my $u = $cgi->param('user');
my $usrname = $cgi->param('usrname') || '';
my $barcode = $cgi->param('barcode') || '';
my $agent = $cgi->param('agent'); # optional, but preferred
my $p = $cgi->param('passwd');

print $cgi->header(-type=>'text/html', -expires=>'-1d');

OpenSRF::AppSession->ingress('remoteauth');
OpenSRF::System->bootstrap_client( config_file => $bootstrap );
Fieldmapper->import(IDL =>
    OpenSRF::Utils::SettingsClient->new->config_value("IDL"));

my $actor = OpenSRF::AppSession->create('open-ils.actor');
my $e = new_editor();
$e->init;

if (!($u || $usrname || $barcode) || !$p) {
    print '+INCOMPLETE';
} else {
    my $nametype;
    if ($usrname) {
        $u = $usrname;
        $nametype = 'username';
    } elsif ($barcode) {
        $u = $barcode;
        $nametype = 'barcode';
    } else {
        $nametype = 'username';
        my $regex_response = $actor->request(
            'open-ils.actor.ou_setting.ancestor_default', 
                1, 'opac.barcode_regex')
            ->gather(1);
        if ($regex_response) {
            my $regexp = $regex_response->{'value'};
            $nametype = 'barcode' if ($u =~ qr/$regexp/);
        }
    }

    my $user;

    if ($nametype eq 'barcode') {

        my $card = $e->search_actor_card([
            {barcode => $u},
            {flesh => 1, flesh_fields => {ac => ['usr']}}
        ])->[0];

        $user = $card->usr if $card and $card->active eq 't';

    } else {
        $user = $e->search_actor_user({usrname => $u})->[0];
    }

    my $logtag = $nametype eq 'barcode' ? "barcode=$u" : "username=$u";

    if (!$user) {
        $logger->warn("remoteauth: no such user $logtag");
        print '+NO';
        exit 0;
    }

    $logtag .= " id=".$user->id." profile=".$user->profile;

    if ($user->deleted eq 't') {
        $logger->warn("remoteauth: user is deleted $logtag");
        print '+NO';
        exit 0;
    }

    if ($user->active eq 'f') {
        $logger->warn("remoteauth: user is not active $logtag");
        print '+NO';
        exit 0;
    }

    if (!$U->verify_migrated_user_password($e, $user->id, $p)) {
        $logger->warn("remoteauth: bad password for $logtag");
        print '+NO';
        exit 0;
    }

    my $expire =
        DateTime::Format::ISO8601->new->parse_datetime(
            cleanse_ISO8601($user->expire_date));

    if ($expire < DateTime->now) {
        $logger->warn("remoteauth: patron account is expired $logtag");
        print '+NO';
        exit 0;
    }

    $e->requestor($user);
    if (!$e->allowed('ACCESS_EBOOKS_AND_DATABASES', $user->home_ou)) {
        $logger->warn("remoteauth: patron does not have permission $logtag");
        print '+NO';
        exit 0;
    }

    $logger->info("remoteauth: successful authentication for $logtag");

    $U->log_user_activity($user->id, $agent, 'verify');

    print '+VALID';
}

1;
