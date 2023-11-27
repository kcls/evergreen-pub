package OpenILS::Utils::KCLSNormalize;

sub normalize_address_street {
    my ($street1, $street2) = @_;

    $street1 = uc($street1) if $street1;
    $street2 = uc($street2) if $street2;

    # Replace 'AV' with 'AVE', but only when "AV" is surrounded by space
    # period, or end of line, so as not to clobber names that contain AV.
    if (my $s1 = $street1) {
        $s1 =~ s/\s+AV(\s|\.|$)+/ AVE /g;
        $s1 =~ s/\s+AVENUE(\s|$)+/ AVE /g;
        $s1 =~ s/\s+ST\.(\s|$)+/ ST /g;
        $s1 =~ s/\s+STREET(\s|$)+/ ST /g;
        $s1 =~ s/\s+RD\.(\s|$)+/ RD /g;
        $s1 =~ s/\s+ROAD(\s|$)+/ RD /g;
        $s1 =~ s/(^\s*|\s*$)//g; # remove opening/trailing spaces
        $street1 = $s1;
    }

    # Our policy is to include the apartment / unit number in the
    # stree1 value.  If street2 starts with APT or UNIT, append it
    # onto the end of street1 (and clear street2).
    # We also replace any occurrence of APT or UNIT with a '#'.
    if (my $s2 = $street2) {
        if ($s2 =~ /^(APT|UNIT|#)/) {
            $s2 =~ s/^(APT\.?|UNIT\.?)//g; # remove APT / UNIT
            $s2 =~ s/^\s*//g; # trim leading space
            if ($s2 =~ /^#/) {
                # if the addr starts with a #, ensure it's followed by a space
                $s2 =~ s/^#/# /g if $s2 =~ /^#[^\s]/;
            } else {
                # if no '#' is present to replace APT/UNIT, add it.
                $s2 = "# $s2" unless $s2 =~ /^#/;
            }

            # remove random "," "." "-" and extra spaces that 
            # occur after the initial "#".
            $s2 =~ s/^#[\s,\.-]*(.*)$/# $1/g;

            if ($street1) {
                $street1 .= " $s2";
            } else {
                $street1 = $s2;
            }
            $street2 = undef;
        }
    }

    return ($street1, $street2);
}

1;
