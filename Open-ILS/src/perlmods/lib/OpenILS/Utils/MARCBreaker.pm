package OpenILS::Utils::MARCBreaker;
use strict; use warnings;
use MARC::Record;
use MARC::File::XML (BinaryEncoding => 'utf8', RecordFormat => 'USMARC');

# $txt is breaker text
sub from_breaker {
    my ($class, $txt) = @_;

    my @lines = split(/\n/, $txt);

    my $r = MARC::Record->new;

    for my $line (@lines) {
        
        next unless $line && length($line) > 2;

        $line = substr($line, 1); # remove '='

        my $tag = substr($line, 0, 3, '');

        $line = substr($line, 1); # remove ' '

        if ($tag eq 'LDR') {

            $r->leader($line);

        } elsif ($tag < '010') {

            my $f = MARC::Field->new($tag, $line);
            $r->append_fields($f);
            
        } else {

            my $ind1 = substr($line, 0, 1, '');
            my $ind2 = substr($line, 0, 1, '');

            my @subfields;
            my @sf_parts = split(/\$([^\{])/, $line);

            shift(@sf_parts); # remove preceding space

            while (my ($code, $value) = splice(@sf_parts, 0, 2)) {
                $value = '' unless defined $value;

                $value =~ s/\$\{dollar\}/\$/g;
                push(@subfields, ($code, $value));
            }

            $r->append_fields(MARC::Field->new($tag, $ind1, $ind2, @subfields));
        }
    }

    return $r;
}

# $r is a MARC::Record
sub to_breaker {
    my ($class, $r) = @_;

    my $txt = '=LDR ' . $r->leader . "\n";

    for my $field ($r->fields) {
        
        if ($field->is_control_field) {

            $txt .= "=" . $field->tag;
            $txt .= " " . $field->data if $field->data;

        } else {
            $txt .= "=" . $field->tag . ' ';
            $txt .= $field->indicator(1);
            $txt .= $field->indicator(2);

            for my $sf ($field->subfields) {
                (my $data = ($sf->[1] || '')) =~ s/\$/\${dollar}/g;
                $txt .= '$' . $sf->[0] . $data;
            }
        }

        $txt .= "\n";
    }

    return $txt;
}

1;
