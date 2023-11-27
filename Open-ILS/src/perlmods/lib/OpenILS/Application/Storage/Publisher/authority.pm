use strict;
use warnings;

package OpenILS::Application::Storage::Publisher::authority;
use base qw/OpenILS::Application::Storage::Publisher/;
use vars qw/$VERSION/;
use OpenSRF::EX qw/:try/;
use OpenILS::Application::Storage::FTS;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::Normalize qw( naco_normalize );
use OpenSRF::Utils::Logger qw/:level/;
use OpenSRF::Utils::Cache;
use Data::Dumper;
use Digest::MD5 qw/md5_hex/;
use XML::LibXML;
use Time::HiRes qw/time sleep/;
use Unicode::Normalize;

my $log = 'OpenSRF::Utils::Logger';

$VERSION = 1;

my $parser = XML::LibXML->new;

sub validate_tag {
    my $self = shift;
    my $client = shift;
    my %args = @_;
    
    my @tags = @{$args{tags}};
    my @searches = @{$args{searches}};

    my $search_table = authority::full_rec->table;
    my $rec_table = authority::record_entry->table;

    my @values;
    my @selects;
    for my $t ( @tags ) {
        for my $search ( @searches ) {
            my $sf = $$search{subfield};
            my $term = naco_normalize($$search{term}, $sf);

            push @values, $t, $sf, $term;

            push @selects,
                "SELECT record FROM $search_table ".
                "WHERE tag = ? AND subfield = ? AND sort_value = public.naco_normalize(?)";
        }

        my $sql;
        if ($self->api_name =~ /id_list/) {
            $sql = 'SELECT DISTINCT record FROM (';
        } else {
            $sql = 'SELECT COUNT(DISTINCT record) FROM (';
        }
        $sql .= 'SELECT record FROM (('.join(') INTERSECT (', @selects).')) AS x ';
        $sql .= "JOIN $search_table recheck USING (record) ";
        $sql .= "JOIN $rec_table delcheck ON (recheck.record = delcheck.id and delcheck.deleted = 'f') ";
        $sql .= "WHERE recheck.tag = ? GROUP BY 1 HAVING (COUNT(recheck.id) - ?) = 0) AS foo;";

        if ($self->api_name =~ /id_list/) {
            my $id_list = authority::full_rec->db_Main->selectcol_arrayref( $sql, {}, @values, $t, scalar(@searches) );
            return $id_list;
        } else {
            my $count = authority::full_rec->db_Main->selectcol_arrayref( $sql, {}, @values, $t, scalar(@searches) )->[0];
            return $count if ($count > 0);
        }
    }

    return 0;
}
__PACKAGE__->register_method(
    api_name    => "open-ils.storage.authority.validate.tag",
    method      => 'validate_tag',
    api_level   => 1,
);

__PACKAGE__->register_method(
    api_name    => "open-ils.storage.authority.validate.tag.id_list",
    method      => 'validate_tag',
    api_level   => 1,
);


sub find_authority_marc {
    my $self = shift;
    my $client = shift;
    my %args = @_;
    
    my $term = NFD(lc($args{term}));
    my $tag = $args{tag};
    my $subfield = $args{subfield};
    my $limit = $args{limit} || 100;
    my $offset = $args{offset} || 0;

    if ($limit) {
        $limit = "LIMIT $limit";
    } else {
        $limit = '';
    }

    if ($offset) {
        $offset = "OFFSET $offset";
    } else {
        $offset = '';
    }

    my $tag_where = "AND f.tag LIKE '$tag'";
    if (ref $tag) {
        $tag_where = "AND f.tag IN ('".join("','",@$tag)."')";
    }

    my $sf_where = "AND f.subfield = '$subfield'";
    if (ref $subfield) {
        $sf_where = "AND f.subfield IN ('".join("','",@$subfield)."')";
    }

    my $search_table = authority::full_rec->table;
    my $marc_table = authority::record_entry->table;

    my ($index_col) = authority::full_rec->columns('FTS');
    $index_col ||= 'value';

    my $fts = OpenILS::Application::Storage::FTS->compile(default => $term, 'f.value', "f.$index_col");

    $term =~ s/\W+$//gso;
    $term =~ s/'/''/gso;
    $term =~ s/\pM//gso;

    my $fts_where = $fts->sql_where_clause;
    my $fts_words = join '%', $fts->words;

    return undef unless ($fts_words);

    my $fts_words_where = "f.value LIKE '$fts_words\%'";
    my $fts_start_where = "f.value LIKE '$term\%'";
    my $fts_eq_where = "f.value = '$term'";

    my $fts_rank = join '+', $fts->fts_rank;

    my $select = <<"    SQL";
        SELECT  a.marc, sum($fts_rank), count(f.record), first(f.value)
        FROM    $search_table f,
            $marc_table a
        WHERE   $fts_start_where
            $tag_where
            $sf_where
            AND a.id = f.record
            GROUP BY 1
            ORDER BY 2 desc, 3 desc, 4
            $limit
            $offset
            
    SQL

    $log->debug("Authority Search SQL :: [$select]",DEBUG);

    my $recs = authority::full_rec->db_Main->selectcol_arrayref( $select );
    
    $log->debug("Search yielded ".scalar(@$recs)." results.",DEBUG);

    $client->respond($_) for (@$recs);
    return undef;
}
__PACKAGE__->register_method(
    api_name    => "open-ils.storage.authority.search.marc",
    method      => 'find_authority_marc',
    api_level   => 1,
    stream      => 1,
    cachable    => 1,
);

sub _empty_check {
    my $term = shift;
    my $class = shift || 'metabib::full_rec';

    my $table = $class->table;

    my ($index_col) = $class->columns('FTS');
    $index_col ||= 'value';

    my $fts = OpenILS::Application::Storage::FTS->compile(default => $term, 'm.value', "m.$index_col");
    my $fts_where = $fts->sql_where_clause;

    my $sql = <<"    SQL";
        SELECT  TRUE
        FROM    $table m
        WHERE   $fts_where
        LIMIT 1
    SQL

    return $class->db_Main->selectcol_arrayref($sql)->[0];
}

my $prevtime;

sub find_see_from_controlled {
    my $self = shift;
    my $client = shift;
    my $term = shift;
    my $limit = shift;
    my $offset = shift;

    $prevtime = time;

    (my $class = $self->api_name) =~ s/^.+authority.([^\.]+)\.see.+$/$1/o;
    my $sf = 'a';
    $sf = 't' if ($class eq 'title');

    my @marc = $self->method_lookup('open-ils.storage.authority.search.marc')
            ->run( term => $term, tag => [400,410,411,430,450,455], subfield => $sf, limit => $limit, offset => $offset );

    
    for my $m ( @marc ) {
        my $doc = $parser->parse_string($m);
        my @nodes = $doc->documentElement->findnodes('//*[substring(@tag,1,1)="1"]/*[@code="a" or @code="d" or @code="x"]');
        my $list = [ map { $_->textContent } @nodes ];
        $client->respond( $list ) if (_empty_check(join(' ',@$list), "metabib::${class}_field_entry"));
    }
    return undef;
}
for my $class ( qw/title author subject keyword series identifier/ ) {
    __PACKAGE__->register_method(
        api_name    => "open-ils.storage.authority.$class.see_from.controlled",
        method      => 'find_see_from_controlled',
        api_level   => 1,
        stream      => 1,
        cachable    => 1,
    );
}

sub find_see_also_from_controlled {
    my $self = shift;
    my $client = shift;
    my $term = shift;
    my $limit = shift;
    my $offset = shift;

    (my $class = $self->api_name) =~ s/^.+authority.([^\.]+)\.see.+$/$1/o;
    my $sf = 'a';
    $sf = 't' if ($class eq 'title');

    my @marc = $self->method_lookup('open-ils.storage.authority.search.marc')
            ->run( term => $term, tag => [500,510,511,530,550,555], subfield => $sf, limit => $limit, offset => $offset );
    for my $m ( @marc ) {
        my $doc = $parser->parse_string($m);
        my @nodes = $doc->documentElement->findnodes('//*[substring(@tag,1,1)="1"]/*[@code="a" or @code="d" or @code="x"]');
        my $list = [ map { $_->textContent } @nodes ];
        $client->respond( $list ) if (_empty_check(join(' ',@$list), "metabib::${class}_field_entry"));
    }
    return undef;
}
for my $class ( qw/title author subject keyword series identifier/ ) {
    __PACKAGE__->register_method(
        api_name    => "open-ils.storage.authority.$class.see_also_from.controlled",
        method      => 'find_see_also_from_controlled',
        api_level   => 1,
        stream      => 1,
        cachable    => 1,
    );
}
__PACKAGE__->register_method(
    api_name    => "open-ils.storage.authority.in_db.browse_or_search",
    method      => "authority_in_db_browse_or_search",
    api_level   => 1,
    argc        => 5,
    signature   => {
        desc => q/Use stored procedures to perform authorities-based
        browses or searches/,
        params => [
            {name => "method", type => "string", desc => q/
                The name of a method within the authority schema to call.  This
                is an API call on a private service for a reason.  Do not pass
                unfiltered user input into this API call, especially in this
                parameter./},
            {name => "what", type => "string", desc => q/
                What to search. Could be an axis name, an authority tag
                number, or a bib tag number/},
            {name => "term", type => "string", desc => "Search term"},
            {name => "page", type => "number", desc => "Zero-based page number"},
            {name => "page_size", type => "number",
                desc => "Number of records per page"},
            {name => "thesauruses", type => "string",
                desc => "Comma-separated this of thesauruses to restrict search/browse to"},
        ],
        return => {
            desc => "A list of authority record IDs",
            type => "array"
        }
    }
);

sub authority_in_db_browse_or_search {
    my ($self, $shift, $method, @args) = @_;

    return unless $method =~ /^\w+$/;

    my $db = authority::full_rec->db_Main;
    my $list = $db->selectcol_arrayref(
        qq/
            SELECT
                (SELECT record FROM authority.simple_heading WHERE id = func.heading)
            FROM authority.$method(?, ?, ?, ?, ?) func(heading)
        /,
        {}, @args
    );
    return $list;
}

__PACKAGE__->register_method(
    api_name	=> "open-ils.storage.authority.id_find",
    method		=> "authority_id_find",
    api_level	=> 1,
    argc        => 5,
    signature   => {
        desc => q/Use stored procedures to perform authorities-based
        browses or searches/,
        params => [
            {name => "method", type => "string", desc => q/
                The name of a method within the authority schema to call.  This
                is an API call on a private service for a reason.  Do not pass
                unfiltered user input into this API call, especially in this
                parameter./},
            {name => "what", type => "string", desc => q/
                What to search. Could be an axis name, an authority tag
                number, or a bib tag number/},
            {name => "term", type => "string", desc => "Search term"},
            {name => "page", type => "number", desc => "Zero-based page number"},
            {name => "page_size", type => "number",
                desc => "Number of records per page"}
        ],
        return => {
            desc => "A list of authority record IDs",
            type => "array"
        }
    }
);

sub authority_id_find {
    my ($self, $shift, $method, @args) = @_;
    return unless $method =~ /^\w+$/;
    my $list = ["@args[1]"];
    return $list;
}

## Grabs all bibs (title by author in a string) with ids of bibs and 
# authorities using a list of authority ID's

__PACKAGE__->register_method(
	api_name        => 'open-ils.storage.authority.get_linked_bibs',
	method          => 'get_linked_bibs',
	api_level       => 1,
	stream          => 1,
);

sub get_linked_bibs {
	
	my $self = shift;
	my $client = shift;
	my $auth_ids_ref = shift;
	
	my @holder_array = ();
	my $id_string = '';
	my $length = scalar @{ $auth_ids_ref };
	
	if ($length > 0){
	
		foreach my $id (@{ $auth_ids_ref }){
		
			$id_string .= $id . ',';
		}
		
		# Remove last comma
		chop($id_string);
	
		# Build SQL statement
		my $select = <<"	SQL";
			SELECT abl.authority AS auth_id, bre.id AS bre_id, bre.marc AS marc FROM biblio.record_entry bre
			JOIN authority.bib_linking abl ON (bre.id = abl.bib)
			WHERE abl.authority in ($id_string);
	SQL

		@holder_array = @{ authority::full_rec->db_Main->selectall_arrayref( $select ) };

		foreach my $row (@holder_array){
			
			${$row}[2] = get_display_string(${$row}[2]);
		}
	}
	
	return \@holder_array;
}

sub get_display_string {
	
	my $marc_xml = shift;
	
	# Grab and cleanup title
	my $title = get_marc_value($marc_xml, 245, 'a');
		
	my @split_array = split(/\//, $title);
	$title = $split_array[0];
	$title =~ s/\[(.*?)]//g;
	$title =~ s/ ://g;
	
	# Grab and cleanup author
	my $author = get_marc_value($marc_xml, 100, 'a');
	
	# DVD's should grab editor
	if ($author eq "Not Found" || $author eq ""){
		
		$author = get_marc_value($marc_xml, 700, 'a');
	}
	
	my $return_string = $title . " by " . $author;
	
	if ($author eq "Not Found"){
		
		$return_string = $title;
	}
	
	return $return_string;
}

sub get_marc_value {
	
	my $xml = shift;
	my $value = shift;
	my $code = shift;
	my $return_value = "Not Found";
	
	if($xml =~ m/<datafield tag="$value"(.*?)datafield>/) {
		
		my $datafield = $1;
		
		if ($code && $datafield =~ m/<subfield code="$code">(.*?)</){
			
			$return_value = $1;
		}
			
		elsif($datafield =~ m/<subfield code="a">(.*?)</) {
			
			$return_value = $1;
		}
	}
	
	if ($return_value eq "Not Found" || $return_value eq ""){
		
		Try::Tiny::try {
			
			local $SIG{ALRM} = sub { die "alarm\n" };
			alarm 5;
			$return_value = get_marc_value_use_marc($xml, $value, $code);
			alarm 0;
		}
		
		Try::Tiny::catch {
			
			$log->debug("get_marc_value timed out!");
		};
	}
	
	return $return_value;
}

sub get_marc_value_use_marc {
	
	my $xml = shift;
	my $value = shift;
	my $code = shift;
	my $return_value;
	
	if($xml =~ m/"<record(.*?)record>"/) {
			
		$xml = "<record" . $1 . "record>";
	
		my $r = MARC::Record->new_from_xml($xml);
	
		if ($value == 100){
		
			$return_value = $r->author();
		}
		
		if ($value == 245){
			
			$return_value = $r->title_proper();
		}
		
		else{
			
			if ($code){
				
				$return_value = $r->subfield("$value",$code);
			}
			else{
			
				$return_value = $r->subfield("$value","a");
			}
		}
	}
		
	return $return_value;
}

1;
