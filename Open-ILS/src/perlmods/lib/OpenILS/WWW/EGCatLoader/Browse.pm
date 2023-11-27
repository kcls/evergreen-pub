package OpenILS::WWW::EGCatLoader;

use strict;
use warnings;

use OpenSRF::Utils::Logger qw/$logger/;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::Normalize qw/search_normalize/;
use OpenILS::Application::AppUtils;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils::Cache;
use OpenSRF::Utils::SettingsClient;

use Digest::MD5 qw/md5_hex/;
use Apache2::Const -compile => qw/OK/;
use MARC::Record;
use List::Util qw/first/;
use Data::Dumper;
#$Data::Dumper::Indent = 0;

my $U = 'OpenILS::Application::AppUtils';
my $browse_cache;
my $browse_timeout;

# Plain procedural functions start here.
#
sub _init_browse_cache {
    if (not defined $browse_cache) {
        my $conf = new OpenSRF::Utils::SettingsClient;

        $browse_timeout = $conf->config_value(
            "apps", "open-ils.search", "app_settings", "cache_timeout"
        ) || 300;
        $browse_cache = new OpenSRF::Utils::Cache("global");
    }
}

sub _get_authority_heading {
    my ($field, $sf_lookup, $joiner) = @_;

    $joiner ||= ' ';

    return join(
        $joiner,
        map { $_->[1] } grep { $sf_lookup->{$_->[0]} } $field->subfields
    );
}

# Object methods start here.
#

# Returns cache key and a list of parameters for DB proc metabib.browse().
sub prepare_browse_parameters {
    my ($self) = @_;

    no warnings 'uninitialized';

    # XXX TODO add config.global_flag rows for browse limit-limit ?

    my @params = (
        scalar($self->cgi->param('qtype')),
        scalar($self->cgi->param('bterm')),
        $self->ctx->{copy_location_group_org} ||
            $self->ctx->{aou_tree}->()->id,
        $self->ctx->{copy_location_group},
        $self->ctx->{is_staff} ? 't' : 'f',
        scalar($self->cgi->param('bpivot')),
        int(
            $self->cgi->param('blimit') ||
            $self->ctx->{opac_hits_per_page} || 10
        )
    );

    # Append a mattype CCVM filter to the browse call.
    if (my $mattype = $self->cgi->param('fi:mattype')) {
        push(@params, 'mattype', $mattype);
    }

    return (
        "oils_browse_" . md5_hex(OpenSRF::Utils::JSON->perl2JSON(\@params)),
        @params
    );
}

# Break out any Public General Notes (field 680) for display. These are
# sometimes (erroneously?) called "scope notes." I say erroneously,
# tentatively, because LoC doesn't seem to document a "scope notes"
# field for authority records, while it does so for classification
# records, which are something else. But I am not a librarian.
sub extract_public_general_notes {
    my ($self, $record, $row) = @_;

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

sub find_authority_headings_and_notes {
    my ($self, $row) = @_;

    my $acsaf_table =
        $self->ctx->{get_authority_fields}->($row->{control_set});

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

    $self->extract_public_general_notes($record, $row);

    # extract headings from the main authority record along with their
    # types
    my $parsed_headings = $self->editor->json_query({
        from => [ "authority.extract_headings", $row->{marc} ]
    });
    my %heading_type_map = ();
    if ($parsed_headings) {
        foreach my $h (@$parsed_headings) {
            $heading_type_map{$h->{normalized_heading}} =
                $h->{purpose} eq 'variant' ? 'variant' :
                $h->{purpose} eq 'related' ? $h->{related_type} :
                '';
        }
    }

    # By applying grep in this way, we get acsaf objects that *have* and
    # therefore *aren't* main entries, which is what we want.
    foreach my $acsaf (values(%$acsaf_table)) {
        my @fields = $record->field($acsaf->tag);
        my %sf_lookup = map { $_ => 1 } split("", $acsaf->display_sf_list);
        my @headings;

        foreach my $field (@fields) {
            my $h = { main_entry => ( $acsaf->main_entry ? 0 : 1 ),
                      heading => _get_authority_heading($field, \%sf_lookup, $acsaf->joiner) };

            my $norm = search_normalize($h->{heading});
            if (exists $heading_type_map{$norm}) {
                $h->{type} = $heading_type_map{$norm};
            }
            # XXX I was getting "target" from authority.authority_linking, but
            # that makes no sense: that table can only tell you that one
            # authority record as a whole points at another record.  It does
            # not record when a specific *field* in one authority record
            # points to another record (not that it makes much sense for
            # one authority record to have links to multiple others, but I can't
            # say there definitely aren't cases for that).
            $h->{target} = $2
                if ($field->subfield('0') || "") =~ /(^|\))(\d+)$/;

            # The target is the row id if this is a main entry...
            $h->{target} = $row->{id} if $h->{main_entry};

            push @headings, $h;
        }

        push @{$row->{headings}}, {$acsaf->id => \@headings} if @headings;
    }

    return $row;
}

sub map_authority_headings_to_results {
    my ($self, $linked, $results, $auth_ids, $authority_field_name, @params) = @_;

    # Use the linked authority records' control sets to find and pick
    # out non-main-entry headings. Build the headings and make a
    # combined data structure for the template's use.
    my %linked_headings_by_auth_id = map {
        $_->{id} => $self->find_authority_headings_and_notes($_)
    } @$linked;

    # Graft this authority heading data onto our main result set at the
    # named column, either "authorities" or "sees".
    foreach my $row (@$results) {
        $row->{$authority_field_name} = [
            map { $linked_headings_by_auth_id{$_} } @{$row->{$authority_field_name}}
        ];
    }

    my $abl_join = {};
    if (my $mattype = $params[7]) { # KCLS JBAS-1929
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
    my $counts = $self->editor->json_query({
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
    }, {timeout => 600}) or return;

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
}

# flesh_browse_results() attaches data from authority records. It
# changes $results and returns 1 for success, undef for failure (in which
# case $self->editor->event should always point to the reason for failure).
# $results must be an arrayref of result rows from the DB's metabib.browse()
sub flesh_browse_results {
    my ($self, $results, @params) = @_;

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
            my $linked = $self->editor->json_query({
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

            $self->map_authority_headings_to_results(
                $linked, $results, \@auth_ids, $authority_field_name, @params);
        }
    }

    return 1;
}

sub load_browse_impl {
    my ($self, @params) = @_;

    my $results = $self->editor->json_query(
        {from => [ "metabib.browse", @params ]},
        {timeout => 600}
    );

    if (not $results) {  # DB error, not empty result set.
        $logger->warn(
            "error in browse (direct): " . $self->editor->event->{textcode}
        );
        $self->ctx->{browse_error} = 1;

        return;
    } elsif (not $self->flesh_browse_results($results, @params)) {
        $logger->warn(
            "error in browse (flesh): " . $self->editor->event->{textcode}
        );
        $self->ctx->{browse_error} = 1;

        return;
    }

    return $results;
}

# Find paging information, put it into $self->ctx, and return "real"
# rows from $results, excluding those that contain only paging
# information.
sub infer_browse_paging {
    my ($self, $results) = @_;

    foreach (@$results) {
        if ($_->{pivot_point}) {
            if ($_->{row_number} < 0) { # sic
                $self->ctx->{forward_pivot} = $_->{pivot_point};
            } else {
                $self->ctx->{back_pivot} = $_->{pivot_point};
            }
        }
    }

    return [ grep { not defined $_->{pivot_point} } @$results ];
}

sub leading_article_test {
    my ($self, $qtype, $bterm) = @_;

    my $flag_name = "opac.browse.warnable_regexp_per_class";
    my $flag = $self->ctx->{get_cgf}->($flag_name);

    return unless $flag->enabled eq 't';

    my $map;

    eval { $map = OpenSRF::Utils::JSON->JSON2perl($flag->value); };
    if ($@) {
        $logger->warn("cgf '$flag_name' enabled but value is invalid JSON? $@");
        return;
    }

    # Don't crash over any of the things that could go wrong in here:
    eval {
        if ($map->{$qtype}) {
            if ($bterm =~ qr/$map->{$qtype}/i) {
                $self->ctx->{browse_leading_article_warning} = 1;
                ($self->ctx->{browse_leading_article_alternative} = $bterm) =~
                    s/$map->{$qtype}//i;
            }
        }
    };
    if ($@) {
        $logger->warn("cgf '$flag_name' has valid JSON in value, but: $@");
    }
}

sub load_browse {
    my ($self) = @_;

    # KCLS
    # JBAS-2958 Disable Catalog Search
    return Apache2::Const::OK;

    _init_browse_cache();

    # If there's a user logged in, flesh extended user info so we can get
    # her opac.hits_per_page setting, if any.
    if ($self->ctx->{user}) {
        $self->prepare_extended_user_info('settings');
        if (my $setting = first { $_->name eq 'opac.hits_per_page' }
            @{$self->ctx->{user}->settings}) {

            $self->ctx->{opac_hits_per_page} =
                int(OpenSRF::Utils::JSON->JSON2perl($setting->value));
        }
    }

    my $pager_shortcuts = $self->ctx->{get_org_setting}->(
        $self->ctx->{physical_loc} || $self->ctx->{search_ou} ||
            $self->ctx->{aou_tree}->id, 'opac.browse.pager_shortcuts'
    );
    if ($pager_shortcuts) {
        my @pager_shortcuts;
        while ($pager_shortcuts =~ s/(\*(.+?)\*)//) {
            push @pager_shortcuts, [substr($2, 0, 1), $2];
        }
        push @pager_shortcuts, map { [$_, $_] } split //, $pager_shortcuts;
        $self->ctx->{pager_shortcuts} = \@pager_shortcuts;
    }

    if ($self->cgi->param('qtype') and defined $self->cgi->param('bterm')) {

        $self->leading_article_test(
            $self->cgi->param('qtype'),
            $self->cgi->param('bterm')
        );

        my ($cache_key, @params) = $self->prepare_browse_parameters;

        my $results = $browse_cache->get_cache($cache_key);
        if (not $results) {
            $results = $self->load_browse_impl(@params);
            if ($results) {
                $browse_cache->put_cache($cache_key, $results, $browse_timeout);
            }
        }

        if ($results) {
            my $field_class = $params[0];
            $self->gather_display_headings($results, $field_class);
            $self->ctx->{browse_results} = $self->infer_browse_paging($results);
        }

        # We don't need an else clause to send the user a 5XX error or
        # anything. Errors will have been logged, and $ctx will be
        # prepared so a template can show a nicer error to the user.
    }

    return Apache2::Const::OK;
}

# Loops through the results and determines if the browse entry is authoritative or not
# then passes that entry to the appropriate set_heading function.
sub gather_display_headings {
	my ($self, $results, $field_class) = @_;
	
	for my $browse_term (@$results) {
		$browse_term->{ref_headings} = {};
		my $auth_id = $self->is_not_authoritative(
            $browse_term->{browse_entry}, $field_class);
		if($auth_id) {
			$self->set_see_heading($browse_term, $auth_id);
		} else {
			$self->set_5xx_heading($browse_term);
		}
	}
}

# Processes headings for authorized browse terms.  Takes a browse term from results.  
# and determine what reference heading it should display.
sub set_5xx_heading {
	my ($self, $browse_term) = @_;
	
	my $browse_term_marc = $self->get_browse_entry_marc($browse_term->{browse_entry});
	my %see_also_hash;
	my $browse_term_id;
	if($browse_term_marc) {
		# Grab the browse terms authority id incase we use it later.
		$browse_term_id = $browse_term_marc->field('901')->subfield('c');
		# Grab any Notes the browse term might have on its 680 field
		$self->extract_public_general_notes($browse_term_marc, $browse_term);
		my @see_also_fields = $browse_term_marc->field('5..');
				
		# Loop over fields and extract the 0 subfield, which is the id of the authority linked too
		# Grab the w, i and 4 subfields and stash that all in a hash keyed by the id
		for my $field (@see_also_fields) {
			my ($zero_subfield) = $field->subfield('0') =~ /(\d+)/;
			my $w_subfield = $field->subfield('w');
			my $i_subfield = $field->subfield('i');
			my $four_subfield = $field->subfield('4');
			# If there is no w subfield just set it too all n's so we treat it like a standard see also
			if(!$w_subfield) {
				$w_subfield = 'nnnn';
			}
			# Check for use of 663 and 665 fields
			
			
			if($zero_subfield) {
				# If we get here we know this reference links so check for 663 and 665 and populate them.
				if($w_subfield =~ /...c/) {
                    my $f = $browse_term_marc->field('663');
					$browse_term->{complex_see_also} = $f->subfield('a') if $f;
				}
				if($w_subfield =~ /...d/) {
					# If we need the 665, grab all subfield a's and then concat them into an array
                    my $f665 = $browse_term_marc->field('665');
                    if ($f665) {
					    my @history_reference = $f665->subfield('a');
					    my $display_string;
					    for my $part (@history_reference) {
						    $display_string = $display_string . ' ' . $part;
					    }
					    $browse_term->{history_reference} = $display_string;
                    }
				}
				$see_also_hash{$zero_subfield}{w} = $w_subfield;
				$see_also_hash{$zero_subfield}{i} = $i_subfield;
				$see_also_hash{$zero_subfield}{4} = $four_subfield;
			}
		}
	}
	
	# Ugly loop but each loop should only be 1 or 2 iterations.  It is necessary because of the structure of the data
	for my $authority_field_name ( qw/authorities sees/ ) {
		# Loop over the see list and authorities list
		for my $references (@{$browse_term->{$authority_field_name}}) {
			# Loop over the headings and dive down into the data structure
			for my $heading (@{$references->{headings}}) {
				for my $value (values %$heading) {
					for my $entry (@$value) {
						my $w_subfield = $see_also_hash{$entry->{target}}{w};
						my @params;
						
						# Check if w subfield exists and that it is not a g.  Since we set w subfield to all n's if the link existed but did not have a w subfield we can
						# assume if w subfield is null then the link does not exist in the browse authority record. If the subfield is a g we don't want to show g references
						# that are on the browse entries marc.
						if($w_subfield and $w_subfield !~ /g/) {
							push @params, $w_subfield;
						} elsif ($self->is_g_reference($entry, $browse_term_id)) {
							# This reference is a g type from the entries marc record that links to the browse entry, so we want to show these g references.
							push @params, 'gnnn';
						}
						
						if(@params) {
							# If we have params then we have a link we want to show, so go ahead and fetch the heading.
							my $raw_ref_heading = $self->editor->json_query({
								from => [ "authority.get_5xx_heading", @params ]
							});
							my $ref_heading;
							# Check for w subfield value r. If it is an r we need to get the i or 4 subield data and add that to the heading.
							if($w_subfield =~ /^r/) {
								if($see_also_hash{$entry->{target}}{i}) {
									$ref_heading = @$raw_ref_heading[0]->{"authority.get_5xx_heading"} . " " . $see_also_hash{$entry->{target}}{i}; 
								} else {
									$ref_heading = @$raw_ref_heading[0]->{"authority.get_5xx_heading"} . " " . $see_also_hash{$entry->{target}}{4};
								}
							} 
                            elsif ($w_subfield =~ /nnnc/) {
                                # Don't add "See Also" before headings with 663 explanation
                                $ref_heading = '';
                            }
                            else {
								$ref_heading = @$raw_ref_heading[0]->{"authority.get_5xx_heading"};
							}
							# Set the heading and show flag so the template can show it.
							$browse_term->{ref_headings}->{$entry->{target}}->{display} = $ref_heading;
							$browse_term->{ref_headings}->{$entry->{target}}->{show} = 1;
							# Grab the marc for this entry so we can fetch any notes
							my $record = $self->get_marc_by_id($entry);
							if($record) {
								$self->extract_public_general_notes($record, $browse_term->{ref_headings}->{$entry->{target}});
							}
							
						} else {
							# If we don't have any params then the entry does not appear on the browse marc or is not a g type so we must have grabbed something
							# permissively. So don't show it.
							$browse_term->{ref_headings}->{$entry->{target}}->{show} = 0;
						}
					}
				}
			}
		}
	}
}

# Fetches a marc file by auth id
sub get_marc_by_id {
	my ($self, $entry) = @_;
		
	# Get the entries marc	
	my $raw_entry_marc = $self->editor->json_query({
		select => {
			are => ["marc"]
		},
		from => {
			are => { }
		},
		where => {"+are" => {id => $entry->{target}}}
	});
	
	# Convert the marc from XML to a MARC::Record Object
	my $record;
	if($raw_entry_marc) {
		eval {
			$record = new_from_xml MARC::Record(@$raw_entry_marc[0]->{"marc"});
		};
		if ($@) {
			$logger->warn("Error reading marc record");
			return undef;    
		}
	}
	return $record;
}

# Takes entry and an authority id.  Looks for the authority id in the marc of the browse entry
# and if found checks if the w subfield on the reference is a g.  Returns 1 if this is the case,
# else returns 0
sub is_g_reference {
	my ($self, $entry, $browse_id) = @_;

	# Get the entries marc	
	my $record = $self->get_marc_by_id($entry);
	if($record) {
		# Look for the browse_id in the marc and check the w subfield value.	
		for my $field ($record->field('5..')) {
			# Grab the id on the 0 subfield
			my ($zero_subfield) = $field->subfield('0') =~ /(\d+)/;
			if($zero_subfield == $browse_id) {
				if($field->subfield('w') =~ /g/) {
					return 1;
				}
			}
		}
	}
	return 0;
}

# Processes headings for unauthorized browse terms.  Takes a browse term from results.  
# and determine what reference heading it should display.
sub set_see_heading {
	my ($self, $browse_term, $auth_id) = @_;
	for my $sees (@{$browse_term->{sees}}) {
		for my $heading (@{$sees->{headings}}) {
			for my $value (values %$heading) {
				for my $entry (@$value) {
					if($entry->{target} == $auth_id) {
						$browse_term->{ref_headings}->{$entry->{target}}->{display} = "See";
						$browse_term->{ref_headings}->{$entry->{target}}->{show} = 1;
						# Get the see references marc	
						my $record = $self->get_marc_by_id($entry);
						if($record) {
							$self->extract_public_general_notes($record, $browse_term->{ref_headings}->{$entry->{target}});
						}
					} else {
						$browse_term->{ref_headings}->{$entry->{target}}->{show} = 0;
					}
				}
			}
		}
	}
}

# Takes an entry into the browse entry series of tables and returns its marc record as a 
# MARC::Record object 
sub get_browse_entry_marc {
	my ($self, $browse_id) = @_;
	my @params;
	push @params, $browse_id;
	push @params, $self->cgi->param('qtype');
	
	my $raw_marc = $self->editor->json_query({
        from => [ "metabib.get_browse_entry_marc_record", @params ]
    });
	
	my $record;
	#CHange to check actual marc not hash
	if($raw_marc && @$raw_marc[0]->{"metabib.get_browse_entry_marc_record"}) {
		eval {
			$record = new_from_xml MARC::Record(@$raw_marc[0]->{"metabib.get_browse_entry_marc_record"});
		};
		if ($@) {
			$logger->warn("Error reading marc record");
			return undef;    
		}
	}
    return $record;
}

# This function takes an id into the metabib.browse_*****_entry table
# and checks to see if that entry is a 400, 430 or 450 reference in another authority
# record.  This is useful to know so we can filter out See Also references
# for non-authoritative entries.
my %cmf_cache;
sub is_not_authoritative {
    my $self = shift;
    my $id = shift;
    my $field_class = shift;

    my $result = $self->editor->json_query({
        from => ['metabib.browse_authority_is_unauthorized', $id, $field_class]
    })->[0];

    return $result->{record} if $result;
    
    return 0;
}

1;
