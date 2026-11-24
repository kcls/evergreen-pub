#!perl -T

use strict; use warnings;
use Test::More tests => 17;

BEGIN {
    use_ok('OpenILS::Application::AppUtils');
}

my $U = 'OpenILS::Application::AppUtils';

# Stands in for an au object; stgu has no pref_prefix/pref_suffix.
package TestUser {
    for my $field (qw/
        prefix first_given_name second_given_name family_name suffix
        pref_prefix pref_first_given_name pref_second_given_name
        pref_family_name pref_suffix/) {
        no strict 'refs';
        *{$field} = sub {
            my $self = shift;
            $self->{$field} = shift if @_;
            return $self->{$field};
        };
    }
    sub new { my ($class, %args) = @_; return bless({%args}, $class); }
}

package TestStagedUser {
    for my $field (qw/first_given_name pref_first_given_name prefix/) {
        no strict 'refs';
        *{$field} = sub {
            my $self = shift;
            $self->{$field} = shift if @_;
            return $self->{$field};
        };
    }
    sub new { my ($class, %args) = @_; return bless({%args}, $class); }
}

package main;

my $user = TestUser->new(
    first_given_name => 'WILLIAM',
    pref_first_given_name => 'BILL',
    second_given_name => 'Q',
    pref_second_given_name => '',
    family_name => 'SMITH'
);

is($U->user_name_part($user, 'first_given_name'), 'BILL', 'pref value wins');
is($U->user_name_part($user, 'second_given_name'), 'Q', 'empty pref falls back');
is($U->user_name_part($user, 'family_name'), 'SMITH', 'undef pref falls back');
is($U->user_name_part($user, 'suffix'), '', 'missing part is an empty string');

my $staged = TestStagedUser->new(prefix => 'DR');
is($U->user_name_part($staged, 'prefix'), 'DR', 'class without a pref field');

# As submitted by a registration form: required name in the base
# fields, optional legal name in the pref fields.
$user = TestUser->new(
    first_given_name => 'BILL',
    pref_first_given_name => 'WILLIAM',
    second_given_name => '',
    pref_second_given_name => 'Q',
    family_name => 'SMITH',
    pref_family_name => 'SMITH',
    suffix => 'JR',
    pref_suffix => ''
);

$U->store_legal_names_in_base($user);

is($user->first_given_name, 'WILLIAM', 'legal first name stored in base');
is($user->pref_first_given_name, 'BILL', 'chosen first name stored in pref');
is($user->second_given_name, 'Q', 'legal middle name stored in base');
is($user->pref_second_given_name, undef, 'empty chosen name is not stored');
is($user->family_name, 'SMITH', 'matching names leave base alone');
is($user->pref_family_name, undef, 'matching names clear pref');
is($user->suffix, 'JR', 'no legal value leaves base alone');
is($user->pref_suffix, undef, 'empty pref is stored as undef');

my $row = {
    first_given_name => 'WILLIAM',
    pref_first_given_name => 'BILL',
    family_name => 'SMITH',
    pref_family_name => undef
};

$U->apply_pref_names_to_hash($row);

is_deeply(
    $row, {first_given_name => 'BILL', family_name => 'SMITH'},
    'pref values replace base values in a hash'
);
is($U->apply_pref_names_to_hash(undef), undef, 'no hash, no problem');
is_deeply($U->apply_pref_names_to_hash({id => 1}), {id => 1},
    'hash without names is left alone');
