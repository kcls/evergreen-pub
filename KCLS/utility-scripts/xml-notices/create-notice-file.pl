#!/usr/bin/perl
use strict; 
use warnings;
use Template;
use Getopt::Long;
use DateTime;
use DateTime::Format::Strptime;
use DateTime::Format::ISO8601;
use OpenSRF::Utils::Logger qw/$logger/;
use OpenSRF::Utils::JSON;
use OpenILS::Utils::Fieldmapper;
use OpenILS::Utils::CStoreEditor;
use OpenILS::Utils::DateTime qw/:datetime/;
use OpenILS::Application::AppUtils;
my $U = 'OpenILS::Application::AppUtils';

my $e; # editor
my $log_prefix = 'XML Notice';
my $osrf_config = '/openils/conf/opensrf_core.xml';
my $notice_template = 'xml-notice-template.tt2';

my $end_date;
my $file_date;
my $event_def;
my $event_tag; # e.g. 7-day-overdue-print
my $core_type;
my $usr_field; # typically 'usr', sometimes 'id'
my $output_dir;
my $for_email;
my $for_no_email;
my $for_text;
my $notice_type;
my $notify_interval;
my $force;
my $window;
my $verbose;

# Requires extra data collection.
my $is_auto_renew = 0;

my $user_flesh = {
    flesh => 3,
    flesh_fields => {
        au => [qw/mailing_address billing_address card home_ou money_summary/],
        aou => [qw/mailing_address billing_address/]
    }
};

my $circ_flesh = {
    flesh => 4,
    flesh_fields => {
        circ => [qw/usr circ_lib target_copy billable_transaction/],
        aou => [qw/billing_address mailing_address/],
        acp => [qw/location call_number/],
        acn => [qw/record/],
        bre => [qw/flat_display_entries/],
        mbt => [qw/summary/]
    }
};

my $hold_flesh = {
    flesh => 4,
    flesh_fields => {
        ahr => [qw/pickup_lib current_copy bib_rec cancel_cause/],
        rhrr => [qw/bib_record/],
        aou => [qw/mailing_address billing_address/],
        acp => [qw/location call_number/],
        acn => [qw/record/],
        bre => [qw/flat_display_entries/],
    }
};

my $xact_flesh = {
    flesh => 5,
    flesh_fields => {
        mobts => [qw/grocery circulation/],
        mg => [qw/billings/],
        circ => [qw/target_copy/],
        acp => [qw/call_number/],
        acn => [qw/record/],
        bre => [qw/flat_display_entries/]
    }
};

sub help {
    my $stat = shift || 0;

    print <<HELP;

Generate XML notification files for delivery to UMS (or other 3rd party).

Synopsis:

./create-notice-file.pl --verbose --event-def 133 \
    --event-tag 7-day-overdue-print --output-dir /openils/var/data/xml-notices

Options:

    --end-date <YYYY-MM-DD[Thh:mm:ss]>
        Process action/trigger events with a run time during the period
        of time ending with this date / time.  The full size of the 
        time range is specified by --window (defaults to 1 day).

    --file-date <YYYY-MM-DD[Thh:mm:ss]>
        Optional.  Overrides --end-date as the date to use in the file name.

    --event-def <id>

    --event-tag <tag>
        Used to designate which collection of notications this represents.
        Used in the XML file name.

    --output-dir <directory>
        Where to place the resulting XML file.

    --for-email
        If set, the script will confirm each patron has an email address
        before adding to the XML file.  Also, the XML content will not 
        include patron address information, since it's not needed.

    --for-text
        If set, the script will confirm each patron has a text number
        before adding to the XML file.  Also, the XML content will not 
        include patron address information, since it's not needed.

    --force
        Force creation of a new XML notice file even if a matching
        file already exists on the local disk.

    --window <interval> ["1 day"]
        For notices which run with a window time that is less than one day,
        so the correct events can be isolated for processing.

    --verbose
        Log all messages to stdout in addition to passing them to \$logger.

    --help
        Show this message.
HELP

    exit($stat);
}

# $lvl should match a $logger logging function.  E.g. 'info', 'error', etc.
sub announce {
    my $lvl = shift;
    my $msg = shift;
    my $die = shift;

    $msg = "$log_prefix: $msg";

    $logger->$lvl($msg);

    # always announce errors and warnings
    return unless $verbose || $lvl =~ /error|warn/;

    my $date_str = DateTime->now(time_zone => 'local')->strftime('%F %T');

    if ($die) {
        die "$date_str $msg\n";
    } else {
        print "$date_str $msg\n";
    }
}

sub get_start_date {
    my $pattern = '%F';
    my @sub = (days => 1);

    if ($window) {
        $pattern = '%FT%T';
        @sub = (seconds => interval_to_seconds($window));
    }

    return DateTime::Format::Strptime->new(pattern => $pattern)
        ->parse_datetime($end_date)->subtract(@sub)->strftime("%FT%T");
}

sub escape_xml {
    my $str = shift;
    $str =~ s/&/&amp;/sog;
    $str =~ s/</&lt;/sog;
    $str =~ s/>/&gt;/sog;
    return $str;
}

# Format ISO dates in a way TT can understand.
sub format_date {
    my $date = shift;
    $date = DateTime::Format::ISO8601->new->parse_datetime(clean_ISO8601($date));
    return sprintf(
        "%0.2d:%0.2d:%0.2d %0.2d-%0.2d-%0.4d",
        $date->hour,
        $date->minute,
        $date->second,
        $date->day,
        $date->month,
        $date->year
    );
}

# Not all holds have a current_copy (e.g. canceled holds), so use the
# bib data directly.
sub get_hold_details {
    my ($ahr) = @_;

    my $entries = $ahr->bib_rec->bib_record->flat_display_entries;

    my ($title) = grep {$_->name eq 'title_proper'} @$entries;
    my ($author) = grep {$_->name eq 'author'} @$entries;

    return {
        title  => $title ? $title->value : '',
        author  => $author ? $author->value : ''
    };
}

my %org_names;
sub get_org_name {
    my ($org) = @_;

    return $org_names{$org->id} if $org_names{$org->id};

    $org_names{$org->id} = $U->ou_ancestor_setting_value(
        $org->id, 'notice.org_unit.name', $e) || $org->name;

    return $org_names{$org->id};
}

my %org_names_phonetic;
sub get_org_name_phonetic {
    my ($org) = @_;

    return $org_names_phonetic{$org->id} if $org_names_phonetic{$org->id};

    $org_names_phonetic{$org->id} = $U->ou_ancestor_setting_value(
        $org->id, 'notice.org_unit.phonetic_name', $e) || 
        get_org_name($org);

    return $org_names_phonetic{$org->id};
}

sub get_title_author {
    my ($acp) = @_;
    
    if ($acp->call_number->id == -1) {
        return {
            title  => $acp->dummy_title,
            author => $acp->dummy_author,
        };

    } else {
        my $entries = $acp->call_number->record->flat_display_entries;

        my ($title) = grep {$_->name eq 'title_proper'} @$entries;
        my ($author) = grep {$_->name eq 'author'} @$entries;

        return {
            title  => $title ? $title->value : '',
            author  => $author ? $author->value : ''
        };
    }
}

sub get_copy_price {
    my ($acp, $acn) = @_;
    return $U->get_copy_price($e, $acp, $acn);
}

sub collect_events {
    my $start_date = get_start_date();
    announce('info', "Collecting events between dates $start_date and $end_date");

    my %user_select = $core_type eq 'stgu' ? () : ($core_type => [$usr_field]);
    my $order_field = $core_type eq 'stgu' ? 'row_id' : $usr_field;
    my $target_id_field = $core_type eq 'stgu' ? 'row_id' : 'id';

    my $results = $e->json_query({
        select => {
            atev => ['target', 'user_data'],
            %user_select
        },
        from => {
            atev => {
                $core_type => {field => $target_id_field, fkey => 'target'}
            }
        },
        where => {
            '+atev' => {
                event_def => $event_def,
                state => 'complete',
                run_time => {'between' => [$start_date, $end_date]}
            }
        },
        order_by => [
            {class => $core_type, field => $order_field}
        ]
    }, {timeout => 10800}) 
        or announce('error', 'XML Notice query timed out', 1);
}

sub process_events {
    my $events = shift;

    my $xml_file;
    my $fdate = $file_date || $end_date;
    my $filename = "$output_dir/$event_tag-$fdate.xml";

    if (-e $filename && !$force) {
        announce('warn', "File $filename already exists.  Skipping");
        exit(1);
    }

    announce('info', "Processing ".scalar(@$events)." events");

    open $xml_file, ">$filename" or
        announce('error', "Cannot open file $filename: $!", 1);

    binmode($xml_file, ':utf8');

    announce('info', "Creating file $filename");

    if (@$events == 0) {
        # If we have no events, leave the empty file in place to 
        # indicate we have already processed this set of events.
        close $xml_file;
        exit(0);
    }

    print $xml_file "<notices>\n";

    my $usr_count = 0;
    my $cur_usr = -1;
    my @cur_events;

    for my $event (@$events) {
        # stgu: where a user is not a user.
        my $user_id = $core_type eq 'stgu' ? $event->{target} : $event->{$usr_field};

        if ($user_id != $cur_usr) {
            print_one_user($xml_file, $cur_usr, \@cur_events) if @cur_events;
            $cur_usr = $user_id;
            $usr_count++;
            @cur_events = ($event);
        } else {
            push(@cur_events, $event);
        }
    }

    # The loop will exit before the last clump of notices is processed.
    print_one_user($xml_file, $cur_usr, \@cur_events) if @cur_events;

    print $xml_file "</notices>\n";
    close $xml_file;

    announce('info', 
        "Processed ".scalar(@$events)." events across $usr_count users");
}

# $source will be a staging table
# $target will be the analogous actor.* table.
sub map_staged_values {
    my ($source, $target) = @_;
    return unless $source && $target;

    $target->id($source->row_id);

    for my $field ($target->all_fields) {
        # Only some fields are shared between stgu and au and related objects.
        eval { $target->$field($source->$field) };
    }
}

# Returns 1 if the script should continue processing the current user
# Returns 0 to skip this user.
sub collect_user_and_targets {
    my ($ctx, $user_id, $target_ids) = @_;

    my $user;
    if ($core_type eq 'stgu') {
        my $stage = $e->retrieve_staging_user_stage($user_id) or return 0;

        # Create a standard user from our staged user so we can minimize
        # template changes for field name variations.
        $user = $ctx->{user} = Fieldmapper::actor::user->new;
        $ctx->{staged_delivery_method} = $stage->delivery_method;
        map_staged_values($stage, $user);

    } else {
        $user = $ctx->{user} = $e->retrieve_actor_user([$user_id, $user_flesh]);
    }

    if ($event_tag && $event_tag =~ /print/) {
        my $addr = $user->mailing_address || $user->billing_address;
        if ($addr) {
            if ($addr->street1 =~ /^1211 E Alder St/i) {
                announce('info', "Skipping print notice to blocked ".
                    "address. patron=$user_id; street1=" . $addr->street1);
                return 0;
            }
        }
    }

    # TODO: consider writing back to the action_trigger.event and
    # updating the state to 'invalid' OR adding an email filter to the
    # filters file OR adding a UserHasEmail validator.
    if ($for_email && ($user->email || '') !~ /.+@.+/) {
        announce('info', 
            "Skipping email notice for lack of email. patron=$user_id");
        return 0;
    }

    # --for-no-email notices are only delivered to patrons that have
    # no email address, e.g. some print notices.
    # This is needed for 'active' notice types where we cannot filter
    # during event creation on whether a patron has an email address.
    if ($for_no_email && ($user->email || '') =~ /.+@.+/) {
        announce(
            'info', 
            "Skipping non-email notice in presence of patron ".
            "email: patron=$user_id; email=" . $user->email
        );
        return 0;
    }

    if ($for_text) {
        my $set = $e->search_actor_user_setting({
            usr => $user_id, name => 'opac.default_sms_notify'})->[0];

        my $text_number = OpenSRF::Utils::JSON->JSON2perl($set->value) if $set;

        $ctx->{text_number} = $text_number || '';
    }
    
    if ($core_type eq 'circ') { # CIRCULATIONS
        
        my $circs = $ctx->{circulations} = 
            $e->search_action_circulation([{id => $target_ids}, $circ_flesh]);

        # There's a miniscule possibility of a circulation getting
        # deleted (i.e. moved to aged_circulation) between the creation
        # of an event and this script running.  Ditto objects for other
        # core_type's below.
        return 0 unless @$circs;

        $ctx->{context_org} = $circs->[0]->circ_lib;

        # Overdue notices require an amount owed per notice amount.
        $ctx->{total_notice_fines} = $U->fpsum(
            $ctx->{total_notice_fines}, 
            $_->billable_transaction->summary->balance_owed
        ) for @$circs;

    } elsif ($core_type eq 'ahr') { # HOLDS

        my $holds = $ctx->{holds} = 
            $e->search_action_hold_request([{id => $target_ids}, $hold_flesh]);

        return 0 unless @$holds;

        # A patron may have holds across multiple pickup locations.
        # If so, group holds by pickup lib so the caller can
        # process each group seperately.
        my %grouped;

        for my $hold (@$holds) {
            $grouped{$hold->pickup_lib->id} = [] 
                unless $grouped{$hold->pickup_lib->id};
            push(@{$grouped{$hold->pickup_lib->id}}, $hold);
        }

        if (keys(%grouped) > 1) {
            $ctx->{grouped_holds} = [ values(%grouped) ];

        } else {
            $ctx->{context_org} = $ctx->{holds}->[0]->pickup_lib;
        }

    } elsif ($core_type eq 'ausp') { # TRANSACTIONS

        my $transactions = $ctx->{transactions} = 
            $e->search_money_open_billable_transaction_summary([
                {usr => $user_id, balance_owed => {'>' => 0}}, 
                $xact_flesh
            ]);

        return 0 unless @$transactions;

        $ctx->{context_org} = $user->home_ou;

    
    } elsif ($core_type eq 'au') {

        $ctx->{context_org} = $user->home_ou;

    } elsif ($core_type eq 'stgu') {

        my $stage_addr = $e->search_staging_billing_address_stage({usrname => $user->usrname})->[0];

        return 0 unless $stage_addr; # required in the form.

        my $billing_address = Fieldmapper::actor::user_address->new;
        map_staged_values($stage_addr, $billing_address);

        $billing_address->valid('t');
        $user->billing_address($billing_address);

        $user->home_ou($e->retrieve_actor_org_unit($user->home_ou));

        $ctx->{context_org} = $user->home_ou;

    } else {

        announce('error', "Unhandled core type: '$core_type'", 1);
    }

    return 1;
}

sub print_one_user {
    my ($xml_file, $user_id, $events) = @_;

    my $target_ids = [ map {$_->{target}} @$events ];

    my $get_due_date = sub {
        # Due dates for autorenew circs come from the event user data
        # on success.  Otherwise, they come from the source circ.
        my $circ = shift;
        if ($is_auto_renew && (
            my ($event) = grep {$_->{target} == $circ->id} @$events)) {

            my $ud;
            eval { $ud = OpenSRF::Utils::JSON->JSON2perl($event->{user_data}); };
            return $ud->{due_date} if $ud && $ud->{is_renewed};
        }

        return $circ->due_date;
    };

    my $get_auto_renew_success = sub {
        my $circ = shift;
        if ($is_auto_renew && (
            my ($event) = grep {$_->{target} == $circ->id} @$events)) {
            my $ud;
            eval { $ud = OpenSRF::Utils::JSON->JSON2perl($event->{user_data}); };
            return $ud->{is_renewed} if $ud;
        }
        return 0;
    };

    my $ctx = {
        total_notice_fines => 0,
        circulations => [],
        holds => [],
        transactions => [],
        for_email => $for_email,
        for_no_email => $for_no_email,
        escape_xml => \&escape_xml,
        format_date => \&format_date,
        get_copy_price => \&get_copy_price,
        get_title_author => \&get_title_author,
        get_hold_details => \&get_hold_details,
        get_org_name => \&get_org_name,
        get_org_name_phonetic => \&get_org_name_phonetic,
        notice_type => $notice_type,
        notify_interval => $notify_interval,
        get_due_date => $get_due_date,
        get_auto_renew_success => $get_auto_renew_success
    };

    my $continue = collect_user_and_targets($ctx, $user_id, $target_ids);

    return unless $continue;

    # Handle holds spread across multiple pickup libs
    # If we want to expand this out to circs as well we can make the
    # keys more generic.

    if (exists $ctx->{grouped_holds}) {
        for my $hold_list (@{$ctx->{grouped_holds}}) {
            $ctx->{holds} = $hold_list;
            $ctx->{context_org} = $hold_list->[0]->pickup_lib;
            process_template($xml_file, $ctx);
        }
    } else {
        process_template($xml_file, $ctx);
    }
}

sub process_template {
    my $xml_file = shift;
    my $ctx = shift;

    my $error;
    my $output = '';
    my $tt = Template->new;

    unless($tt->process($notice_template, $ctx, \$output)) {
        $output = undef;
        ($error = $tt->error) =~ s/\n/ /og;
        announce('error', "Error processing Trigger template: $error");
        return;
    }

    print $xml_file "$output";
}

sub check_params {
    announce('error', '--event-def required', 1) unless $event_def;
    announce('error', '--event-tag required', 1) unless $event_tag;
    announce('error', '--output-dir required', 1) unless $output_dir;
    announce('error', '--end-date required', 1) unless $end_date;

    my $def = $e->retrieve_action_trigger_event_definition([
        $event_def,
        {flesh => 1, flesh_fields => {atevdef => ['hook']}}
    ]) or announce('error', "No such event definition: $event_def", 1);

    $core_type = $def->hook->core_type;
    $usr_field = $core_type eq 'au' ? 'id' : 'usr';
    $is_auto_renew = $def->hook->key eq 'autorenewal';

    announce('info', "Found " . $def->name . 
        " with core type '$core_type' and usr field '$usr_field'");
}

# --------------------------------------------------------------------------
# And we're off...
GetOptions(
    'end-date=s'        => \$end_date,
    'file-date=s'       => \$file_date,
    'event-def=s'       => \$event_def,
    'event-tag=s'       => \$event_tag,
    'output-dir=s'      => \$output_dir,
    'for-email'         => \$for_email,
    'for-no-email'      => \$for_no_email,
    'for-text'          => \$for_text,
    'notice-type=s'     => \$notice_type,
    'notify-interval=s' => \$notify_interval,
    'force'             => \$force,
    'window=s'          => \$window,
    'verbose'           => \$verbose,
    'help'              => sub { help(0); }
) or help(1);


# connect to osrf...
OpenSRF::System->bootstrap_client(config_file => $osrf_config);
Fieldmapper->import(IDL => 
    OpenSRF::Utils::SettingsClient->new->config_value("IDL"));
OpenILS::Utils::CStoreEditor::init();
$e = OpenILS::Utils::CStoreEditor->new;

check_params();

announce('info', "Processing event definition $event_def as $event_tag");

process_events(collect_events());


