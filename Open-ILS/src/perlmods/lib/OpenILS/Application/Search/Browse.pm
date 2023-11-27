package OpenILS::Application::Search::Browse;
use base qw/OpenILS::Application/;
use strict; use warnings;

# Most of this code is copied directly from ../../WWW/EGCatLoader/Browse.pm
# and modified to be API-compatible.

use Digest::MD5 qw/md5_hex/;
use Apache2::Const -compile => qw/OK/;
use MARC::Record;
use List::Util qw/first/;

use OpenSRF::Utils::Logger qw/$logger/;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::Normalize qw/search_normalize/;
use OpenILS::Application::AppUtils;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils::Cache;
use OpenSRF::Utils::SettingsClient;

my $U = 'OpenILS::Application::AppUtils';
my $browse_cache;
my $browse_timeout;

sub initialize { return 1; }

sub child_init {
    if (not defined $browse_cache) {
        my $conf = new OpenSRF::Utils::SettingsClient;

        $browse_timeout = $conf->config_value(
            "apps", "open-ils.search", "app_settings", "cache_timeout"
        ) || 300;
        $browse_cache = new OpenSRF::Utils::Cache("global");
    }
}

__PACKAGE__->register_method(
    method      => "browse",
    api_name    => "open-ils.search.browse.staff",
    stream      => 1,
    signature   => {
        desc    => q/Bib + authority browse/,
        params  => [{
            params => {
                name => 'Browse Parameters',
                desc => q/Hash of arguments:
                    browse_class
                        -- title, author, subject, series
                    term
                        -- term to browse for
                    org_unit
                        -- context org unit ID
                    copy_location_group
                        -- copy location filter ID
                    limit
                        -- return this many results
                    pivot
                        -- browse entry ID
                /
            }
        }]
    }
);

__PACKAGE__->register_method(
    method      => "browse",
    api_name    => "open-ils.search.browse",
    stream      => 1,
    signature   => {
        desc    => q/See open-ils.search.browse.staff/
    }
);

sub browse {
    my ($self, $client, $params) = @_;

    $params->{staff} = 1 if $self->api_name =~ /staff/;
    my ($cache_key, @params) = prepare_browse_parameters($params);

    my $results = $browse_cache->get_cache($cache_key);

    if (!$results) {
        $results = 
            new_editor()->json_query({from => ['metabib.browse', @params]});
        if ($results) {
            $browse_cache->put_cache($cache_key, $results, $browse_timeout);
        }
    }

    my ($warning, $alternative) = 
        leading_article_test($params->{browse_class}, $params->{term});

    for my $result (@$results) {
        $result->{leading_article_warning} = $warning;
        $result->{leading_article_alternative} = $alternative;
        flesh_browse_results([$result], $params[8]);
        $client->respond($result);
    }

    return undef;
}


# Returns cache key and a list of parameters for DB proc metabib.browse().
sub prepare_browse_parameters {
    my ($params) = @_;

    no warnings 'uninitialized';

    my @params = (
        $params->{browse_class},
        $params->{term},
        $params->{org_unit},
        $params->{copy_location_group},
        $params->{staff} ? 't' : 'f',
        $params->{pivot},
        $params->{limit} || 10
    );

    # KCLS JBAS-1929
    if (my $mattype = $params->{mattype}) {
        push(@params, 'mattype', $mattype);
    }

    return (
        "oils_browse_" . md5_hex(OpenSRF::Utils::JSON->perl2JSON(\@params)),
        @params
    );
}

sub leading_article_test {
    my ($browse_class, $bterm) = @_;

    my $flag_name = "opac.browse.warnable_regexp_per_class";
    my $flag = new_editor()->retrieve_config_global_flag($flag_name);

    return unless $flag->enabled eq 't';

    my $map;
    my $warning;
    my $alternative;

    eval { $map = OpenSRF::Utils::JSON->JSON2perl($flag->value); };
    if ($@) {
        $logger->warn("cgf '$flag_name' enabled but value is invalid JSON? $@");
        return;
    }

    # Don't crash over any of the things that could go wrong in here:
    eval {
        if ($map->{$browse_class}) {
            if ($bterm =~ qr/$map->{$browse_class}/i) {
                $warning = 1;
                ($alternative = $bterm) =~ s/$map->{$browse_class}//;
            }
        }
    };

    if ($@) {
        $logger->warn("cgf '$flag_name' has valid JSON in value, but: $@");
    }

    return ($warning, $alternative);
}

# flesh_browse_results() attaches data from authority records. It
# changes $results and returns 1 for success, undef for failure
# $results must be an arrayref of result rows from the DB's metabib.browse()
sub flesh_browse_results {
    my ($results, $mattype) = @_;


    # KCLS JBAS-2441
    # Any data that exists in the authorities array is stale.
    # See more below on this topic.
   
    for my $row (@$results) { $row->{authorities} = undef; }

    for my $authority_field_name ( qw/authorities sees/ ) {
        for my $r (@$results) {
            # Turn comma-seprated strings of numbers in "authorities" and "sees"
            # columns into arrays.
            if ($r->{$authority_field_name}) {
                $r->{$authority_field_name} = [split /,/, $r->{$authority_field_name}];
            } else {
                $r->{$authority_field_name} = [];
            }
            $r->{"list_$authority_field_name"} = [ @{$r->{$authority_field_name} } ];
        }

        # Group them in one arrray, not worrying about dupes because we're about
        # to use them in an IN () comparison in a SQL query.
        my @auth_ids = map { @{$_->{$authority_field_name}} } @$results;

        if (@auth_ids) {
            # Get all linked authority records themselves
            my $linked = new_editor()->json_query({
                select => {
                    are => [qw/id marc control_set/],
                    aalink => [{column => "target", transform => "array_agg",
                        aggregate => 1}]
                },
                from => {
                    are => {
                        aalink => {
                            type => "left",
                            fkey => "id", field => "source"
                        }
                    }
                },
                where => {"+are" => {id => \@auth_ids}}
            }) or return;

            map_authority_headings_to_results(
                $linked, $results, \@auth_ids, $authority_field_name, $mattype);
        }
    }

    # KCLS JBAS-2441
    # As an unexpected side effect of moving bib indexing from MODS to
    # a custom XSL, the metabib.browse_entry_def_map.authority field is
    # never set.  This means the 'authorities' list (as opposed to 'sees')
    # is always empty.  Dig through the sees to find the cases where an
    # authority record's main entry matches the browse result value, 
    # meaning it should have appeared in the 'authorities' list instead.
    for my $row (@$results) {
        for my $see (@{$row->{sees}}) {
            my $matched = 0;
            for my $group (@{$see->{headings}}) {
                last if $matched;
                for my $grp_arr (values %$group) {
                    last if $matched;
                    for my $heading (@$grp_arr) {
                        last if $matched;
                        if ($heading->{main_entry} && 
                            $heading->{heading} eq $row->{value}) {
                            push (@{$row->{authorities}}, $see);
                            $matched = 1;
                        }
                    }
                }
            }
        }
        $row->{list_authorities} = [map {$_->{id}} @{$row->{authorities}}];
    }

    return 1;
}

sub map_authority_headings_to_results {
    my ($linked, $results, $auth_ids, $authority_field_name, $mattype) = @_;

    # Use the linked authority records' control sets to find and pick
    # out non-main-entry headings. Build the headings and make a
    # combined data structure for the template's use.
    my %linked_headings_by_auth_id = map {
        $_->{id} => find_authority_headings_and_notes($_)
    } @$linked;

    # Avoid sending the full MARC blobs to the caller.
    delete $_->{marc} for @$linked;

    # Graft this authority heading data onto our main result set at the
    # named column, either "authorities" or "sees".
    foreach my $row (@$results) {
        $row->{$authority_field_name} = [
            map { $linked_headings_by_auth_id{$_} } @{$row->{$authority_field_name}}
        ];
    }

    # KCLS JBAS-1929
    my $abl_join = {};
    if ($mattype) {
        $abl_join = {
            mraf => {
                field => 'id',
                fkey => 'bib',
                filter => {
                    attr => 'mattype',
                    value => $mattype
                }
            }
        };
    }

    # Get linked-bib counts for each of those authorities, and put THAT
    # information into place in the data structure.
    my $counts = new_editor()->json_query({
        select => {
            abl => [
                {column => "id", transform => "count",
                    alias => "count", aggregate => 1},
                "authority"
            ]
        },
        from => {abl => $abl_join},
        where => {
            "+abl" => {
                authority => [
                    @$auth_ids,
                    $U->unique_unnested_numbers(map { $_->{target} } @$linked)
                ]
            }
        }
    }) or return;

    my %auth_counts = map { $_->{authority} => $_->{count} } @$counts;

    # Soooo nesty!  We look for places where we'll need a count of bibs
    # linked to an authority record, and put it there for the template to find.
    for my $row (@$results) {
        for my $auth (@{$row->{$authority_field_name}}) {
            if ($auth->{headings}) {
                for my $outer_heading (@{$auth->{headings}}) {
                    for my $heading_blob (@{(values %$outer_heading)[0]}) {
                        if ($heading_blob->{target}) {
                            $heading_blob->{target_count} =
                                $auth_counts{$heading_blob->{target}};
                        }
                    }
                }
            }
        }
    }

    return unless $authority_field_name eq 'sees';

    # KCLS JBAS-2441
    # The user interface needs to know the relationship from the Heading
    # to the See. As it stands, the See data we have contains just the
    # opposite, the relationship from the See to the Heading. We need to
    # specify what the reverse relationship is in the main entry of each
    # See.
    #
    # For example, browse result heading "Spy Films" is a broader term
    # for "Jame Bond films", but all we know at this point is that
    # "James Bond films" is a narrower term of "Spy Films". Encode the
    # opposite for the UI.
    for my $row (@$results) {
        for my $see (@{$row->{sees}}) {
            my $main_entry;
            my $see_for_heading;

            for my $group (@{$see->{headings}}) {

                for my $grp_arr (values %$group) {
                    for my $heading (@$grp_arr) {
                        if ($heading->{main_entry}) {
                            $main_entry = $heading;
                        } else {
                            $see_for_heading = $heading if 
                                $heading->{heading} eq $row->{value};
                        }
                        last if $main_entry && $see_for_heading;
                    }
                    last if $main_entry && $see_for_heading;
                }
                last if $main_entry && $see_for_heading;
            }

            if ($main_entry && $see_for_heading) {
                my %type_map = (
                    narrower => 'broader',
                    broader => 'narrower',
                    earlier => 'later',
                    later => 'earlier'
                );

                $main_entry->{related_type} = 
                    $type_map{$see_for_heading->{related_type}};
            }
        }
    }
}


# TOOD consider locale-aware caching
sub get_acsaf {
    my $control_set = shift;

    my $acs = new_editor()
        ->search_authority_control_set_authority_field(
            {control_set => $control_set}
        );

    return {  map { $_->id => $_ } @$acs };
}

sub find_authority_headings_and_notes {
    my ($row) = @_;

    my $acsaf_table = get_acsaf($row->{control_set});

    $row->{headings} = [];

    my $record;
    eval {
        $record = new_from_xml MARC::Record($row->{marc});
    };

    if ($@) {
        $logger->warn("Problem with MARC from authority record #" .
            $row->{id} . ": $@");
        return $row;    # We're called in map(), so we must move on without
                        # a fuss.
    }

    extract_public_general_notes($record, $row);

    foreach my $acsaf (values(%$acsaf_table)) {
        my @fields = $record->field($acsaf->tag);
        my %sf_lookup = map { $_ => 1 } split("", $acsaf->display_sf_list);
        my @headings;

        foreach my $field (@fields) {

            # If a field has a main_entry, it's not itself a main entry.
            my $h = {main_entry => $acsaf->main_entry ? 0 : 1};

            $h->{target} = $2
                if ($field->subfield('0') || "") =~ /(^|\))(\d+)$/;

            # The target is the main authority ID on the current row 
            # if this is a main entry.
            $h->{target} = $row->{id} if $h->{main_entry};

            # We're not interested in See's that do not refer to a 
            # local authority record.
            #next unless $h->{target};

            $h->{heading} = 
                get_authority_heading($field, \%sf_lookup, $acsaf->joiner);

            if ($acsaf->tag =~ /^4/) {
                add_4xx_info($h, $field);
            } elsif ($acsaf->tag =~ /^[57]/) {
                add_5xx_7xx_info($h, $field, $record);
            }

            push @headings, $h;
        }

        push @{$row->{headings}}, {$acsaf->id => \@headings} if @headings;
    }

    return $row;
}

sub add_4xx_info {
    my ($heading, $marc_field) = @_;

    my $w = $marc_field->subfield('w');
    $heading->{variant_type} = $w eq 'd' ? 'acronym' : 'other';
}

sub add_5xx_7xx_info {
    my ($heading, $marc_field, $record) = @_;

    my $w_full = $marc_field->subfield('w') || '';
    my $w = substr($w_full, 0, 1);

    my $tag = $marc_field->tag;

    my $related_type = 'other';

    if ($tag =~ /^7/ && $tag ne '730') {
        $related_type = 'equivalent';

    } elsif ($tag ne '530') {

        my %w_map = (
            a => 'earlier',
            b => 'later',
            t => 'parentOrg',
            g => 'broader',
            h => 'narrower'
        );

        $related_type = $w_map{$w} if $w_map{$w};
    }

    $heading->{related_type} = $related_type;

    if ($w eq 'r') {
        $heading->{relationship_designation} = 
            $marc_field->subfield('i') || $marc_field->subfield('4');

    } elsif ($w_full =~ /...c/) {
        my $t663 = $record->field('663');
        $heading->{complex_see_also} = $t663->subfield('a') if $t663;

    } elsif ($w_full =~ /...d/) {
        my @t665 = $record->field('665');
        my @histories = map { $_->subfield('a') } @t665;
        $heading->{history_reference} = join(' ', @histories);
    }
}


# Break out any Public General Notes (field 680) for display. These are
# sometimes (erroneously?) called "scope notes." I say erroneously,
# tentatively, because LoC doesn't seem to document a "scope notes"
# field for authority records, while it does so for classification
# records, which are something else. But I am not a librarian.
sub extract_public_general_notes {
    my ($record, $row) = @_;

    # Make a list of strings, each string being a concatentation of any
    # subfields 'i', '5', or 'a' from one field 680, in order of appearance.
    $row->{notes} = [
        map {
            join(
                " ",
                map { $_->[1] } grep { $_->[0] =~ /[i5a]/ } $_->subfields
            )
        } $record->field('680')
    ];
}

sub get_authority_heading {
    my ($field, $sf_lookup, $joiner) = @_;

    $joiner ||= ' ';

    return join(
        $joiner,
        map { $_->[1] } grep { $sf_lookup->{$_->[0]} } $field->subfields
    );
}

1;
