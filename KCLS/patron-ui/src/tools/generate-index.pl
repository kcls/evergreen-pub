#!/usr/bin/perl
use strict;
use warnings;
use Template;
use JSON::XS;
use LWP::UserAgent;

my $WIDGETS_FILE = 'external_templates.json';
my $WIDGETS_URL = "https://kcls.bibliocommons.com/widgets/$WIDGETS_FILE";
my $INDEX_TEMPLATE = 'index.html.tt2';
my $INDEX_FILE = '../index.html';

sub get_bc_widgets {
    my $force = shift;

    my $parser = JSON::XS->new;
    $parser->ascii(1); 
    $parser->allow_nonref(1);

    my $json;

    if (-f $WIDGETS_FILE && !$force) {
        print "Loading local file $WIDGETS_FILE\n";

        open(FH, '<', $WIDGETS_FILE) or die $!;

        my @json = <FH>;
        $json = join('', @json);

        close(FH);

    } else {
        print "Fetching remote file $WIDGETS_URL\n";

        my $agent = LWP::UserAgent->new(timeout => 30);
        my $res = $agent->get($WIDGETS_URL);

        die "Fetch error: " . $res->status_line . "\n" unless $res->is_success;

        $json = $res->content or die "Fetch returned no response\n";

        open(FH, '>', $WIDGETS_FILE) or die $!;

        print FH $json;
        close(FH);
    }

    my $hash;

    eval { $hash = $parser->decode($json) };

    die "Fetch returned invalid JSON: $@\n" if $@;

    return $hash;
}

sub generate_index {
    my $force = shift;

    my $widgets = get_bc_widgets($force);

    my $error;
    my $output = '';
    my $tt = Template->new;
    my $context = {widgets => $widgets};

    unless($tt->process($INDEX_TEMPLATE, $context, \$output)) {
        $output = undef;
        ($error = $tt->error) =~ s/\n/ /og;
        die "Error processing Trigger template: $error\n";
    }

    open(FH, '>', $INDEX_FILE) or die $!;

    print FH "$output";

    close(FH);
}


generate_index();
