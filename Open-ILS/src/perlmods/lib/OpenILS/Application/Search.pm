package OpenILS::Application::Search;
use OpenILS::Application;
use base qw/OpenILS::Application/;
use strict; use warnings;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils::Logger qw(:logger);

use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::ModsParser;
use OpenSRF::Utils::SettingsClient;
use OpenSRF::Utils::Cache;

use OpenILS::Application::Search::Biblio;
use OpenILS::Application::Search::Authority;
use OpenILS::Application::Search::Z3950;
use OpenILS::Application::Search::Zips;
use OpenILS::Application::Search::CNBrowse;
use OpenILS::Application::Search::Serial;
use OpenILS::Application::Search::Browse;
use OpenILS::Application::Search::Elastic;

use OpenILS::Utils::CStoreEditor qw/:funcs/;
use Data::Dumper;

use OpenILS::Application::AppUtils;

use Time::HiRes qw(time);
use OpenSRF::EX qw(:try);

use Text::Aspell;
use Switch;

# Houses generic search utilites 

sub initialize {
    OpenILS::Application::Search::Zips->initialize();
    OpenILS::Application::Search::Biblio->initialize();
}

sub child_init {
    OpenILS::Application::Search::Z3950->child_init;
    OpenILS::Application::Search::Browse->child_init;
}
    

__PACKAGE__->register_method(
    method    => "browseSetNav",
    api_name  => "open-ils.search.metabib.browse.setnav"
);

#---------------------------------------------------------------------
# This osrf call is to allow the navigation links on the browse_items
# page to be populated with the next and previous record. 
#---------------------------------------------------------------------
#["10248","id|bibcn","YR973.003%20CON","1"]
sub browseSetNav {
    my $self = shift;
    my $client = shift;
    my $browseEntry = shift;
    my $searchClass = shift;
    my $searchTerm = shift;
    my $locg = shift;
    my $mattype = shift; # JBAS-1929

    my $e = new_editor;

    #Hardcoding to true becaue at time of creation browse search will only be available through the staff client
    my $isStaffClient = 't'; 

    my $results = $e->json_query({
        from => [ "metabib.browse", $searchClass, $searchTerm, 
            $locg, undef, $isStaffClient, $browseEntry, '3' ]# , $mattype ]
    });

    my $navResults = {};
$logger->debug(Dumper($results));
    foreach (@$results) {

        my $current = $_;

        switch ($current->{row_number}) {

            case -1 {
$logger->debug("next: " . Dumper($current));
                $navResults->{next_browse} = $current->{browse_entry};
                $navResults->{next_field} = $current->{fields};
            }

            case 0 {
$logger->debug("current: " . Dumper($current));
                $navResults->{current_value} = $current->{value};
            }

            case 1 {
$logger->debug("previous: " . Dumper($current));
                $navResults->{previous_browse} = $current->{browse_entry};
                $navResults->{previous_field} = $current->{fields};
            }
        }
    }

    return $navResults;
}

# ------------------------------------------------------------------
# Create custom dictionaries like so:
# aspell --lang=en create  master ./oils_authority.dict < /tmp/words
# where /tmp/words is a space separated list of words
# ------------------------------------------------------------------

__PACKAGE__->register_method(
    method    => "spellcheck",
    api_name  => "open-ils.search.spellcheck",
    signature => {
        desc  => 'Returns alternate spelling suggestions',
        param => [
            {
                name => 'phrase',
                desc => 'Word or phrase to return alternate spelling suggestions for',
                type => 'string'
            },
            {
                name => 'Dictionary class',
                desc => 'Alternate configured dictionary to use (optional)',
                type => 'string'
            },
        ],
        return => {
            desc => 'Array with a suggestions hash for each word in the phrase, like: '
                  . q# [{ word: original_word, suggestions: [sug1, sug2, ...], found: 1 }, ... ] #
                  . 'The "found" value will be 1 if the word was found in the dictionary, 0 otherwise.',
            type => 'array',
        }
    }
);

my $speller = Text::Aspell->new();

sub spellcheck {
    my( $self, $client, $phrase, $class ) = @_;

    return [] unless $phrase;   # nothing to check, abort.

    my $conf = OpenSRF::Utils::SettingsClient->new;
    $class ||= 'default';

    my @conf_path = (apps => 'open-ils.search' => app_settings => spelling_dictionary => $class);

    if( my $dict = $conf->config_value(@conf_path) ) {
        $speller->set_option('master', $dict);
        $logger->debug("spelling dictionary set to $dict");
    }

    $speller->set_option('ignore-case', 'true');

    my @resp;

    for my $word (split(/\s+/,$phrase) ) {

        my @suggestions = $speller->suggest($word);
        my @trimmed;

        for my $sug (@suggestions) {

            # suggestion matches alternate case of original word
            next if lc($sug) eq lc($word); 

            # suggestion matches alternate case of already suggested word
            next if grep { lc($sug) eq lc($_) } @trimmed;

            push(@trimmed, $sug);
        }

        push( @resp, 
            {
                word => $word, 
                suggestions => (@trimmed) ? [@trimmed] : undef,
                found => $speller->check($word)
            } 
        ); 
    }
    return \@resp;
}



1;
