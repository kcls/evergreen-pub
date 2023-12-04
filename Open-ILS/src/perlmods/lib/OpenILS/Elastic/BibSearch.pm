# ---------------------------------------------------------------
# Copyright (C) 2019-2020 King County Library System
# Author: Bill Erickson <berickxx@gmail.com>
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.

# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR code.  See the
# GNU General Public License for more details.
# ---------------------------------------------------------------
package OpenILS::Elastic::BibField;
use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    my $self = {%args};
    return bless($self, $class);
}
sub id {
    my $self = shift;
    return $self->search_group ? 
        $self->search_group . '|' . $self->name : $self->name;
}
sub search_group {
    my $self = shift;
    return $self->{search_group};
}
sub name {
    my $self = shift;
    return $self->{name};
}
sub search_field {
    my $self = shift;
    return $self->{search_field};
}
sub facet_field {
    my $self = shift;
    return $self->{facet_field};
}
sub weight {
    my $self = shift;
    return $self->{weight};
}
sub filter {
    my $self = shift;
    return $self->{filter};
}
sub sorter {
    my $self = shift;
    return $self->{sorter};
}

package OpenILS::Elastic::BibSearch;
use strict;
use warnings;
use DateTime;
use Clone 'clone';
use Time::HiRes qw/time/;
use XML::LibXML;
use XML::LibXML::XPathContext;
use OpenSRF::Utils::Logger qw/:logger/;
use OpenSRF::Utils::JSON;
use OpenSRF::Utils::SettingsClient;
use OpenILS::Utils::CStoreEditor qw/:funcs/;
use OpenILS::Utils::DateTime qw/interval_to_seconds/;
use OpenILS::Elastic;
use OpenILS::Utils::Normalize;
use base qw/OpenILS::Elastic/;

# default number of bibs to index per batch.
my $DEFAULT_BIB_BATCH_SIZE = 500;
my $INDEX_CLASS = 'bib-search';

# https://www.elastic.co/guide/en/elasticsearch/reference/current/ignore-above.html
# Useful for ignoring excessively long filters and facets.
# Only applied to the keyword variation of each index.  Does not affect
# the 'text' varieties. The selected limit is arbitrary.
my $IGNORE_ABOVE = 256;

# Individual characters of some values like sorters provide less and less
# value as the length of the text gets longer and longer.  Unlike
# $IGNORE_ABOVE, this only trims the string, it does not prevent it from
# getting indexed in the first place.  The selected limit is arbitrary.
my $TRIM_ABOVE = 512;

my $BASE_INDEX_SETTINGS = {
    analysis => {
        analyzer => {
            folding => {
                filter => ['asciifolding', 'lowercase'],
                tokenizer => 'standard'
            },
            icu_folding => {
                filter => ['icu_folding', 'lowercase'],
                tokenizer => 'icu_tokenizer'
            },
            stripapos => {
                # "It's A Wonderful Life" => "Its A ..."
                char_filter => ['stripapos'],
                filter => ['lowercase'],
                tokenizer => 'standard'
            },
            stripapos_folded => {
                char_filter => ['stripapos'],
                filter => ['asciifolding', 'lowercase'],
                tokenizer => 'standard'
            },
            stripcomma => {
                # "5,000" => "5000"
                char_filter => ['stripcomma'],
                filter => ['lowercase'],
                tokenizer => 'standard'
            },
            stripdots => {
                # "R.E.M." => "REM"
                char_filter => ['stripdots'],
                filter => ['lowercase'],
                tokenizer => 'standard'
            },
            spacedots => {
                # "R.E.M." => "R E M"
                char_filter => ['spacedots'],
                filter => ['lowercase'],
                tokenizer => 'standard'
            },
			trigram => {
				type => 'custom',
				tokenizer => 'standard',
				filter => ['lowercase', 'shingle']
			}
        },
        normalizer =>  {
            custom_lowercase => {
                type => 'custom',
                filter => ['lowercase']
            },
            stripfinalpunc => {
                type => 'custom',
                char_filter => ['stripfinalpunc']
            }
        },
		filter => {
			shingle => {
				type => 'shingle',
				min_shingle_size => 2,
				max_shingle_size => 3
			}
		},
        char_filter => {
            stripapos => {
                type => 'mapping',
                mappings => ['\' =>']
            },
            stripcomma => {
                type => 'mapping',
                mappings => [', =>']
            },
            stripdots => {
                type => 'mapping',
                mappings => ['. =>']
            },
            spacedots => {
                type => 'mapping',
                mappings => ['. => " "']
            },
            stripfinalpunc => {
                type => 'pattern_replace',
                pattern => '[^a-zA-Z0-9\(\)-]+$',
                replacement => '' 
            }
        }
    }
};

# Well-known bib-search index properties 
my $BASE_PROPERTIES = {
    bib_source  => {type => 'integer'},
    create_date => {type => 'date'},
    edit_date   => {type => 'date'},
    metarecord  => {type => 'integer'},

    # Holdings summaries.  For bib-search, we don't need
    # copy-specific details, only aggregate visibility information.
    holdings => {
        type => 'nested',
        properties => {
            status => {type => 'integer'},
            circ_lib => {type => 'integer'},
            location => {type => 'integer'},
            circulate => {type => 'boolean'},
            opac_visible => {type => 'boolean'}
        }
    },
    marc => {
        type => 'nested',
        properties => {
            tag => {
                type => 'keyword',
                normalizer => 'custom_lowercase'
            },
            subfield => {
                type => 'keyword',
                normalizer => 'custom_lowercase'
            },
            value => {
                type => 'keyword',
                ignore_above => $IGNORE_ABOVE,
                normalizer => 'custom_lowercase',
                fields => {
                    text => {type => 'text'},
                    text_folded => {type => 'text', analyzer => 'folding'},
                    text_icu_folded => {type => 'text', analyzer => 'icu_folding'}
                }
            }
        }
    },

    # Make it possible to search across all fields in a search group.
    # Values from grouped fields are copied into the group field.
    # Here we make some assumptions about the general purpose of
    # each group.
    # The 'keyword' variation of each is used for exact matches, 
    # starts with, and similar searches.
    # Note the ignore_above only affects the 'keyword' version of the
    # field, the assumption being text that large would solely be
    # searched via 'text' indexes.
    title => {
        type => 'keyword',
        ignore_above => $IGNORE_ABOVE,
        normalizer => 'custom_lowercase',
        fields => {
            text => {type => 'text'},
            text_folded => {type => 'text', analyzer => 'folding'},
            text_icu_folded => {type => 'text', analyzer => 'icu_folding'},
            text_spacedots => {type => 'text', analyzer => 'spacedots'},
            text_stripdots => {type => 'text', analyzer => 'stripdots'},
            text_stripapos => {type => 'text', analyzer => 'stripapos'},
            text_stripapos_folded => {type => 'text', analyzer => 'stripapos_folded'},
            text_stripcomma => {type => 'text', analyzer => 'stripcomma'},
            trigram => {type => 'text', analyzer => 'trigram'}
        }
    },
    author => {
        type => 'keyword',
        ignore_above => $IGNORE_ABOVE,
        normalizer => 'custom_lowercase',
        fields => {
            text => {type => 'text'},
            text_folded => {type => 'text', analyzer => 'folding'},
            text_icu_folded => {type => 'text', analyzer => 'icu_folding'},
            text_spacedots => {type => 'text', analyzer => 'spacedots'},
            text_stripdots => {type => 'text', analyzer => 'stripdots'},
            text_stripapos => {type => 'text', analyzer => 'stripapos'},
            text_stripapos_folded => {type => 'text', analyzer => 'stripapos_folded'},
            text_stripcomma => {type => 'text', analyzer => 'stripcomma'},
            trigram => {type => 'text', analyzer => 'trigram'}
        }
    },
    subject => {
        type => 'keyword',
        ignore_above => $IGNORE_ABOVE,
        normalizer => 'custom_lowercase',
        fields => {
            text => {type => 'text'},
            text_folded => {type => 'text', analyzer => 'folding'},
            text_icu_folded => {type => 'text', analyzer => 'icu_folding'},
            text_spacedots => {type => 'text', analyzer => 'spacedots'},
            text_stripdots => {type => 'text', analyzer => 'stripdots'},
            trigram => {type => 'text', analyzer => 'trigram'}
        }
    },
    series => {
        type => 'keyword',
        ignore_above => $IGNORE_ABOVE,
        normalizer => 'custom_lowercase',
        fields => {
            text => {type => 'text'},
            text_folded => {type => 'text', analyzer => 'folding'},
            text_icu_folded => {type => 'text', analyzer => 'icu_folding'},
            text_spacedots => {type => 'text', analyzer => 'spacedots'},
            text_stripdots => {type => 'text', analyzer => 'stripdots'},
            text_stripapos => {type => 'text', analyzer => 'stripapos'},
            text_stripapos_folded => {type => 'text', analyzer => 'stripapos_folded'},
            text_stripcomma => {type => 'text', analyzer => 'stripcomma'},
            trigram => {type => 'text', analyzer => 'trigram'}
        }
    },
    keyword => {
        # term (aka "keyword") searches are not used on the 
        # keyword field, but we structure the index just the same
        # for consistency with other group fields.
        type => 'keyword',
        ignore_above => 1, # essentially a no-op.
        fields => {
            text => {type => 'text'},
            text_folded => {type => 'text', analyzer => 'folding'},
            text_icu_folded => {type => 'text', analyzer => 'icu_folding'},
            text_spacedots => {type => 'text', analyzer => 'spacedots'},
            text_stripdots => {type => 'text', analyzer => 'stripdots'},
            text_stripapos => {type => 'text', analyzer => 'stripapos'},
            text_stripapos_folded => {type => 'text', analyzer => 'stripapos_folded'},
            text_stripcomma => {type => 'text', analyzer => 'stripcomma'},
            trigram => {type => 'text', analyzer => 'trigram'}
        }
    },
    # Identifier fields only support 'keyword' indexes, no full-text.
    identifier => {
        type => 'keyword',
        ignore_above => $IGNORE_ABOVE,
        normalizer => 'custom_lowercase',
    }
};

# Map 'au' to 'author', etc.
my %SEARCH_CLASS_ALIAS_MAP = (
    ti => 'title.text',
    au => 'author.text',
    su => 'subject.text',
    se => 'series.text',
    kw => 'keyword.text',
    pb => 'keyword|publisher.text',
    id => 'identifier'
);

sub index_class {
    return $INDEX_CLASS;
}

# TODO: determine when/how to apply language analyzers.
# e.g. create lang-specific index fields?
sub language_analyzers {
    return ("english");
}

sub bib_fields {
    my $self = shift;
    return $self->{bib_fields} if $self->{bib_fields};

    my @bib_fields = $self->xpath_context->findnodes(
        '//es:fields/es:field', $self->index_config);

    my @fields;
    for my $field (@bib_fields) {
        
        my %struct;

        for my $key (qw/search_group name/) {
            $struct{$key} = $field->getAttribute($key) || '';
        }

        for my $key (qw/search_field facet_field filter sorter/) {
            $struct{$key} = ($field->getAttribute($key) || '') eq 'true';
        }

        push (@fields, OpenILS::Elastic::BibField->new(%struct));
    }

    return $self->{bib_fields} = \@fields;
}

sub xsl_file {
    my ($self) = @_;

    if (!$self->{xsl_file}) {
        my @nodes = $self->xpath_context->findnodes(
            '//es:transform/text()', $self->index_config);
        $self->{xsl_file} = $nodes[0];
    }

    return $self->{xsl_file};
}

sub xsl_doc {
    my ($self) = @_;

    $self->{xsl_doc} = XML::LibXML->load_xml(location => $self->xsl_file)
        unless $self->{xsl_doc};

    return $self->{xsl_doc};
}

sub xsl_sheet {
    my $self = shift;

    $self->{xsl_sheet} = XML::LibXSLT->new->parse_stylesheet($self->xsl_doc)
        unless $self->{xsl_sheet};

    return $self->{xsl_sheet};
}

sub get_bib_data {
    my ($self, $record_ids) = @_;

    my $records = [];
    my $db_data = $self->get_bib_db_data($record_ids);

    for my $db_rec (@$db_data) {

        my $rec = {fields => []};
        push(@$records, $rec);

        # Copy DB data into our record object.
        $rec->{$_} = $db_rec->{$_} for 
            qw/id bib_source metarecord create_date edit_date deleted/;

        # No need to extract index values for delete records;
        next if $rec->{deleted} == 1;

        my $marc_doc = XML::LibXML->load_xml(string => $db_rec->{marc});
        my $result = $self->xsl_sheet->transform($marc_doc);
        my $output = $self->xsl_sheet->output_as_chars($result);

        my @rows = split(/\n/, $output);
        for my $row (@rows) {
            my ($purpose, $search_group, $name, @tokens) = split(/ /, $row);

            $search_group = '' if ($search_group || '') eq '_';

            my $value = join(' ', @tokens);

            my $field = {
                purpose => $purpose,
                search_group => $search_group,
                name => $name,
                value => $value
            };

            push(@{$rec->{fields}}, $field);
        }
    }

    return $records;
}

sub get_bib_db_data {
    my ($self, $record_ids) = @_;

    my $ids_str = join(',', @$record_ids);

    my $sql = <<SQL;
SELECT DISTINCT ON (bre.id)
    bre.id, 
    bre.create_date, 
    bre.edit_date, 
    bre.source AS bib_source,
    bre.deleted,
    bre.marc
FROM biblio.record_entry bre
LEFT JOIN metabib.metarecord_source_map mmrsm ON (mmrsm.source = bre.id)
WHERE bre.id IN ($ids_str)
SQL

    return $self->get_db_rows($sql);
}

sub create_index_properties {
    my ($self) = @_;

    my $properties = $BASE_PROPERTIES;

    # Add the language analyzers to the MARC mappings
    for my $lang_analyzer ($self->language_analyzers) {
        $properties->{marc}->{properties}->{value}->{fields}->{"text_$lang_analyzer"} = {
            type => 'text',
            analyzer => $lang_analyzer
        };

        # Apply language analysis to grouped fields, however skip
        # the 'author' and 'identifier' groups since it makes less sense to 
        # language-analyze proper names and identifiers.
        $properties->{$_}->{fields}->{"text_$lang_analyzer"} = {
            type => 'text',
            analyzer => $lang_analyzer
        } foreach qw/title subject series keyword/;
    }

    # field_group will be undef for main/active fields
    my $fields = $self->bib_fields;

    for my $field (@$fields) {

        my $field_name = $field->name;
        my $search_group = $field->search_group;
        $field_name = "$search_group|$field_name" if $search_group;

        my $def;

        if ($search_group) {
            if ($field->search_field) {

                # Use the same fields and analysis as the 'grouped' field.
                $def = clone($properties->{$search_group});

                # Copy grouped fields into their group parent field.
                $def->{copy_to} = $search_group;

                # Apply ranking boost to each analysis variation.
                my $flds = $def->{fields};
                if ($flds && (my $boost = ($field->weight || 1)) > 1) {
                    $flds->{$_}->{boost} = $boost foreach keys %$flds;
                }
            }

        } else {
            # Filters and sorters

            $def = {
                type => 'keyword',
                normalizer => 'custom_lowercase'
            };

            # Long sorter values are not necessarily unexpected,
            # e.g. long titles.
            $def->{ignore_above} = $IGNORE_ABOVE unless $field->sorter;
        }

        if ($def) {
            $logger->debug("ES adding field $field_name: ". 
                OpenSRF::Utils::JSON->perl2JSON($def));
    
            $properties->{$field_name} = $def;
        }

        # Search and facet fields can have the same name/group pair,
        # but are stored as separate fields in ES since the content
        # may vary between the two.
        if ($field->facet_field) {

            # Facet fields are stored as separate fields, because their
            # content may differ from the matching search field.
            $field_name = "$field_name|facet";

            $def = {
                type => 'keyword',
                ignore_above => $IGNORE_ABOVE,
                normalizer => 'stripfinalpunc'
            };

            $logger->debug("ES adding field $field_name: ". 
                OpenSRF::Utils::JSON->perl2JSON($def));

            $properties->{$field_name} = $def;
        }
    }

    return $properties;
}

sub create_index {
    my ($self) = @_;
    my $index_name = $self->index_name;

    if ($self->es->indices->exists(index => $index_name)) {
        $logger->warn("ES index '$index_name' already exists in ES");
        return;
    }

    $logger->info(
        "ES creating index '$index_name' on cluster '".$self->cluster."'");

    my $properties = $self->create_index_properties;

    my $settings = $BASE_INDEX_SETTINGS;
    $settings->{number_of_shards} = 1; # TODO $index_config->num_shards;

    my $conf = {
        index => $index_name,
        body => {settings => $settings}
    };

    $logger->info("ES creating index '$index_name'");

    # Create the base index with settings
    eval { $self->es->indices->create($conf) };

    if ($@) {
        my $msg = "ES failed to create index cluster=".  
            $self->cluster. "index=$index_name error=$@";

        $logger->error($msg);
        die "$msg\n";
    }

    # Create each mapping one at a time instead of en masse so we 
    # can more easily report when mapping creation fails.
    for my $field (keys %$properties) {
        return 0 unless 
            $self->create_one_field_index($field, $properties->{$field});
    }

    # Now that we've added the configured fields,
    # add the shortened search_group aliases.
    while (my ($alias, $field) = each %SEARCH_CLASS_ALIAS_MAP) {

        return 0 unless $self->create_one_field_index(
            $alias, {type => 'alias', path => $field});
    }

    return 1;
}

sub create_one_field_index {
    my ($self, $field, $properties) = @_;

    my $index_name = $self->index_name;

    $logger->info("ES Creating index mapping for field $field");

    eval { 
        $self->es->indices->put_mapping({
            index => $index_name,
            type  => 'record',
            body  => {
                dynamic => 'strict', 
                properties => {$field => $properties}
            }
        });
    };

    if ($@) {
        my $mapjson = OpenSRF::Utils::JSON->perl2JSON($properties);

        $logger->error("ES failed to create index mapping: " .
            "index=$index_name field=$field error=$@ mapping=$mapjson");

        warn "$@\n\n";
        return 0;
    }

    return 1;
}


sub get_bib_field_for_data {
    my ($self, $field) = @_;

    my @matches = grep {$_->name eq $field->{name}} @{$self->bib_fields};

    @matches = grep {
        (($_->search_group || '') eq ($field->{search_group} || ''))
    } @matches;

    my ($match) = grep {
        ($_->search_field && $field->{purpose} eq 'search') ||
        ($_->facet_field && $field->{purpose} eq 'facet') ||
        ($_->filter && $field->{purpose} eq 'filter') ||
        ($_->sorter && $field->{purpose} eq 'sorter')
    } @matches;

    if (!$match) {
        # Warning on mismatched fields can lead to a lot of logs
        # while trying different field configs.  Consider a
        # 'warn-on-field-mismatch' flag.
        $logger->debug("ES No bib field matches extracted data ".
            OpenSRF::Utils::JSON->perl2JSON($field));
    }

    return $match;
}

sub populate_bib_index_batch {
    my ($self, $state) = @_;

    my $start_index_count = $self->{total_indexed};

    my $bib_ids = $self->get_bib_ids($state);
    return 0 unless @$bib_ids;

    $logger->info("ES indexing ".scalar(@$bib_ids)." records");
    my $top = $#$bib_ids > 9 ? 9 : $#$bib_ids;

    my @subset = @$bib_ids[0..$top];

    $logger->info("ES indexing records (first 10): @subset");

    my $records = $self->get_bib_data($bib_ids);

    # Remove records that are marked deleted.
    # This should only happen when running in refresh mode.

    my @active_ids;
    for my $bib_id (@$bib_ids) {

        # Every row in the result data contains the 'deleted' value.
        my ($rec) = grep {$_->{id} == $bib_id} @$records;

        if ($rec->{deleted} == 1) { # not 't' / 'f'
            $self->delete_documents($bib_id); 
            $self->{total_indexed}++;
            $state->{start_record} = $bib_id + 1;
        } else {
            push(@active_ids, $bib_id);
        }
    }

    $bib_ids = [@active_ids];

    my $holdings = $self->load_holdings($bib_ids) if @$bib_ids;

    for my $bib_id (@$bib_ids) {
        my ($rec) = grep {$_->{id} == $bib_id} @$records;

        my $body = {
            bib_source => $rec->{bib_source},
            metarecord => $rec->{metarecord},
            marc => []
        };

        $body->{holdings} = $holdings->{$bib_id} || [];

        # ES likes the "T" separator for ISO dates
        ($body->{create_date} = $rec->{create_date}) =~ s/ /T/g;
        ($body->{edit_date} = $rec->{edit_date}) =~ s/ /T/g;

        for my $field (@{$rec->{fields}}) {
            my $purpose = $field->{purpose};
            my $fclass = $field->{search_group};
            my $fname = $field->{name};
            my $value = $field->{value};

            next unless defined $value && $value ne '';

            my $trim = $purpose eq 'sorter' ? $TRIM_ABOVE : undef;
            $value = $self->truncate_value($value, $trim);

            if ($purpose eq 'marc') {
                # NOTE: we could create/require elastic.bib_field entries for 
                # MARC values as well if we wanted to control the exact
                # MARC data that's indexed.
                $self->add_marc_value($body, $fclass, $fname, $value);
                next;
            }

            # Ignore any data provided by the transform we have
            # no configuration for.
            next unless $self->get_bib_field_for_data($field);
        
            $fname = "$fclass|$fname" if $fclass;
            $fname = "$fname|facet" if $purpose eq 'facet';

            if ($fname eq 'identifier|isbn') {
                index_isbns($body, $value);

            } elsif ($fname eq 'identifier|issn') {
                index_issns($body, $value);

            } elsif ($fname eq 'identifier|ctrlno' || $fname eq 'identifier|ctrlxref') {
                index_ctrlno($fname, $body, $value);

            } elsif ($fname eq 'pubdate') {
                index_pubdate($body, $value);

            } elsif ($fname =~ /sort/) {
                index_sorter($body, $fname, $value);

            } else {
                append_field_value($body, $fname, $value);
            }
        }

        return 0 unless $self->index_document($bib_id, $body);

        $state->{start_record} = $bib_id + 1;
        $self->{total_indexed}++;
    }

    my $index_count = $self->{total_indexed} - $start_index_count;

    $logger->info(sprintf(
        "ES indexed %d records in this batch across records %d ... %d ".
        "with a session total of %d",
        $index_count, $bib_ids->[0], $bib_ids->[-1], $self->{total_indexed}));

    return $index_count;
}

sub index_sorter {
    my ($body, $fname, $value) = @_;

    $value = OpenILS::Utils::Normalize::search_normalize($value);

    $value =~ s/^ +//g;

    append_field_value($body, $fname, $value) if $value;
}

# Normalize the pubdate (used for sorting) to a single 4-digit year.
# Pad with zeroes where the year fall short of 4 digits.
sub index_pubdate {
    my ($body, $value) = @_;

    $value =~ s/\D//g;

    return unless $value; # no numbers

    $value = substr($value . '0' x 4, 0, 4);

    return if $value eq '0000'; # treat as no date.

    append_field_value($body, 'pubdate', $value) if $value;
}


# Indexes ISBN10, ISBN13, and formatted values of both (with hyphens)
sub index_isbns {
    my ($body, $value) = @_;
    return unless $value;
    
    my %seen; # deduplicate values
    my @values = OpenILS::Utils::Normalize::clean_isbns($value);
    my $isbns = $values[0];
    my $strings = $values[1];

    for my $isbn (@$isbns) {
        if ($isbn->as_isbn10) {
            $seen{$isbn->as_isbn10->isbn} = 1; # compact
            $seen{$isbn->as_isbn10->as_string} = 1; # with hyphens
        }
        if ($isbn->as_isbn13) {
            $seen{$isbn->as_isbn13->isbn} = 1;
            $seen{$isbn->as_isbn13->as_string} = 1;
        }
    }

    # Add the unvalidated ISBNs
    $seen{$_} = 1 for @$strings;

    append_field_value($body, 'identifier|isbn', $_) foreach keys %seen;
    append_field_value($body, 'keyword|keyword', $_) foreach keys %seen;
}

# Indexes ISSN values with and wihtout hyphen formatting.
sub index_issns {
    my ($body, $value) = @_;
    return unless $value;

    my %seen; # deduplicate values
    my @issns = OpenILS::Utils::Normalize::clean_issns($value);
    
    for my $issn (@issns) {
        # no option in business::issn to get the unformatted value.
        (my $unformatted = $issn->as_string) =~ s/-//g;
        $seen{$unformatted} = 1;
        $seen{$issn->as_string} = 1;
    }

    append_field_value($body, 'identifier|issn', $_) foreach keys %seen;
    append_field_value($body, 'keyword|keyword', $_) foreach keys %seen;
}

# Indexes ISSN values with and wihtout hyphen formatting.
sub index_ctrlno {
    my ($field, $body, $value) = @_;
    return unless $value;

    my @values = split(/\s+/, $value);

    for my $val (@values) {
        my @ctrlno_parts = OpenILS::Utils::Normalize::clean_ctrlno($val);

        # The part following any leading characters, e.g. ocn12345 => 12345
        my $nums = $ctrlno_parts[1];

        # Index the value as-is.
        append_field_value($body, $field, $val);
        append_field_value($body, $field, $nums) if $nums;

        # Now repeat for keyword.
        append_field_value($body, 'keyword|keyword', $val);
        append_field_value($body, 'keyword|keyword', $nums) if $nums;
    }
}

sub append_field_value {
    my ($body, $fname, $value) = @_;

    if ($body->{$fname}) {
        if (ref $body->{$fname}) {
            # Three or more values encountered for field.
            # Add to the list.
            return if grep {$_ eq $value} @{$body->{$fname}}; # dupe
            push(@{$body->{$fname}}, $value);
        } else {
            # Second value encountered for field.
            # Upgrade to array storage.
            return if $body->{$fname} eq $value; # dupe
            $body->{$fname} = [$body->{$fname}, $value];
        }
    } else {
        # First value encountered for field.
        # Assume for now there will only be one value.
        $body->{$fname} = $value
    }
}

# Load holdings summary blobs for requested bibs
sub load_holdings {
    my ($self, $bib_ids) = @_;

    my $bib_ids_str = join(',', @$bib_ids);

    my $copy_data = $self->get_db_rows(<<SQL);
SELECT 
    COUNT(*) AS count,
    acn.record, 
    acp.status AS status, 
    acp.circ_lib AS circ_lib, 
    acp.location AS location,
    acp.circulate AS circulate,
    acp.opac_visible AS opac_visible
FROM asset.copy acp
JOIN asset.call_number acn ON acp.call_number = acn.id
WHERE 
    NOT acp.deleted AND
    NOT acn.deleted AND
    acn.record IN ($bib_ids_str)
GROUP BY 2, 3, 4, 5, 6, 7
SQL

    $logger->info("ES found ".scalar(@$copy_data).
        " holdings summaries for current record batch");

    my $holdings = {};
    for my $copy (@$copy_data) {

        $holdings->{$copy->{record}} = [] 
            unless $holdings->{$copy->{record}};

        push(@{$holdings->{$copy->{record}}}, {
            status => $copy->{status},
            circ_lib => $copy->{circ_lib},
            location => $copy->{location},
            circulate => $copy->{circulate} ? 'true' : 'false',
            opac_visible => $copy->{opac_visible} ? 'true' : 'false'
        });
    }

    return $holdings;
}

sub add_marc_value {
    my ($self, $rec, $tag, $subfield, $value) = @_;

    # XSL uses '_' when no subfield is present (e.g. controlfields)
    $subfield = undef if $subfield eq '_';

    my ($match) = grep {
        $_->{tag} eq $tag &&
        ($_->{subfield} || '') eq ($subfield || '')
    } @{$rec->{marc}};

    if ($match) {
        if (ref $match->{value}) {
            # 3rd or more instance of tag/subfield for this record.

            # avoid dupes
            return if grep {$_ eq $value} @{$match->{value}};

            push(@{$match->{value}}, $value);

        } else {
            # 2nd instance of tag/subfield for this record.
            
            # avoid dupes
            return if $match->{value} eq $value;

            $match->{value} = [$match->{value}, $value];
        }

    } else {
        # first instance of tag/subfield for this record.

        $match = {tag => $tag, value => $value};
        $match->{subfield} = $subfield if defined $subfield;

        push(@{$rec->{marc}}, $match);
    }
}

# Add data to the bib-search index
sub populate_index {
    my ($self, $settings) = @_;
    $settings ||= {};

    my $index_count = 0;
    $self->{total_indexed} = 0;

    # extract the database settings.
    for my $db_key (grep {$_ =~ /^db_/} keys %$settings) {
        $self->{$db_key} = $settings->{$db_key};
    }

    my $end_time;
    my $duration = $settings->{max_duration};
    if ($duration) {
        my $seconds = interval_to_seconds($duration);
        $end_time = DateTime->now;
        $end_time->add(seconds => $seconds);
    }

    while (1) {

        $index_count = $self->populate_bib_index_batch($settings);

        # exit if we're only indexing a single record or if the 
        # batch indexer says there are no more records to index.
        last if !$index_count || $settings->{index_record};

        if ($end_time && DateTime->now > $end_time) {
            $logger->info(
                "ES index populate exiting early on max_duration $duration");
            last;
        }
    } 

    $logger->info("ES bib indexing complete with " . $self->{total_indexed} . " records");
}

sub get_bib_ids {
    my ($self, $state) = @_;

    # A specific record is selected for indexing.
    return [$state->{index_record}] if $state->{index_record};

    my $start_id = $state->{start_record} || 1;

    # Ignore all bibs below ID 1.
    $start_id = 1 unless $start_id && $start_id > 0;

    my $stop_id = $state->{stop_record};
    my $modified_since = $state->{modified_since};
    my $created_since = $state->{created_since};
    my $batch_size = $state->{batch_size} || $DEFAULT_BIB_BATCH_SIZE;

    my ($select, $from, $where);
    if ($modified_since) {
        $logger->info("ES bib indexing records modified since $modified_since");
        $select = "SELECT id";
        $from   = "FROM elastic.bib_mod_since(QUOTE_LITERAL('$modified_since')::TIMESTAMPTZ)";
        $where  = "WHERE TRUE";
    } elsif ($created_since) {
        $logger->info("ES bib indexing records created since $created_since");
        $select = "SELECT id";
        $from   = "FROM biblio.record_entry";
        $where  = "WHERE NOT DELETED AND create_date >= QUOTE_LITERAL('$created_since')::TIMESTAMPTZ";
    } else {
        $select = "SELECT id";
        $from   = "FROM biblio.record_entry";
        $where  = "WHERE NOT deleted AND active";
    }

    $where .= " AND id >= $start_id" if $start_id;
    $where .= " AND id <= $stop_id" if $stop_id;

    # Ordering by ID is the simplest way to guarantee all requested
    # records are processed, given that edit dates may not be unique
    # and that we're using start_id/stop_id instead of OFFSET to
    # define the batches.
    my $order = "ORDER BY id";

    my $sql = "$select $from $where $order LIMIT $batch_size";

    my $ids = $self->get_db_rows($sql);
    return [ map {$_->{id}} @$ids ];
}

1;


