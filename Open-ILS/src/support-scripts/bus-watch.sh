#!/bin/bash
#
# Quick and dirty script to scan for orphaned OpenSRF message keys and
# set them to expire so they don't linger on the message bus indefinitely.
#

REDIS="redis-cli --raw"
REDIS_ACCOUNTS="/openils/conf/redis-accounts.txt"
NAMESPACES=("opensrf:client" "opensrf:server" "opensrf:router");
EXPIRE=7200 # 2 hours

if [ -z "$REDISCLI_AUTH" ]; then

    # See if we can get the password for the default user
    # from the Redis accounts file.
    password=$(grep "ACL SETUSER default on" $REDIS_ACCOUNTS | cut -d '>' -f2)

    if [ -n "$password" ]; then
        export REDISCLI_AUTH=$password;
    else
        echo "Usage: REDISCLI_AUTH=password $0"
        exit 1;
    fi;
fi;

# Set a key to expire after $EXPIRE seconds, but only if the key
# is not already set to expire.
function set_expire {
    key=$1

    ttl=$($REDIS ttl $key)

    if [ $ttl == -1 ]; then
        logger -p local0.info -t bus-watch "Setting expire for $key to $EXPIRE";
        $REDIS EXPIRE $key $EXPIRE
    fi;
}

# The KEYS command is not recommended for large data sets.  In the context of
# a message bus, though, keys are created and removed practically immediately.
# IOW, there bus as a whole should be empty on average.
#
# We could change this to use SCAN instead, which is the preferred option,
# it's just a little more clunky to work with.

for namespace in "${NAMESPACES[@]}"; do
    for key in $($REDIS KEYS "$namespace:*"); do
        set_expire "$key"
    done;
done;
