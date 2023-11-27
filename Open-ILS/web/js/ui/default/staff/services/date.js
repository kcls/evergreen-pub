/**
 * Core Service - egDate
 *
 * Date utility functions.
 *
 */
angular.module('egCoreMod')

.factory('egDate', function() {

    var service = {};

    /**
     * Converts an interval string to seconds.
     *
     * egDate.intervalToSeconds('1 min 2 seconds')) => 62
     * egDate.intervalToSeconds('2 days')) => 172800 (except across time changes)
     * egDate.intervalToSeconds('02:00:23')) => 7223
     */
    service.intervalToSeconds = function(interval) {
        var d = new Date();
        var start = d.getTime();
        var parts = interval.split(' ');

        for(var i = 0; i < parts.length; i += 2)  {

            if (!parts[i+1]) {
                // interval is a bare hour:min:sec string
                var times = parts[i].split(':');
                d.setHours(d.getHours() + Number(times[0]));
                d.setMinutes(d.getMinutes() + Number(times[1]));
                d.setSeconds(d.getSeconds() + Number(times[2]));
                continue;
            }

            var count = Number(parts[i]);
            var type = parts[i+1].replace(/s?,?$/,'');

            if (type.match(/^s/)) {
                d.setSeconds(d.getSeconds() + count);
            } else if (type.match(/^min/)) {
                d.setMinutes(d.getMinutes() + count);
            } else if (type.match(/^h/)) {
                d.setHours(d.getHours() + count);
            } else if (type.match(/^d/)) {
                d.setDate(d.getDate() + count);
            } else if (type.match(/^mon/)) {
                d.setMonth(d.getMonth() + count);
            } else if (type.match(/^y/)) {
                d.setFullYear(d.getFullYear() + count);
            }
        }

        return Number((d.getTime() - start) / 1000);
    }

    // Returns the provided date as YYYY-MM-DD for the local time zone.
    // If no date is provided, the current date is used.
    service.getYmd= function(d) {
        if (d) {
            // avoid clobbering (below) the date object passed by the caller.
            d = new Date(d.getTime());
        } else {
            d = new Date();
        }

        // toISOString returns a UTC date.  Mangle our 'now' date to
        // force its UTC verion to match that of the local version
        // once the timezone is stripped away.
        // E.g. if the local time zone is -0500, subract 5 hours
        // from the date before translating to an ISO string.
        // Note: tz offset is positive for locales behind UTC.
        d.setTime(d.getTime() - (d.getTimezoneOffset() * 60 * 1000));

        return d.toISOString().replace(/T.*/, '');
    }


    return service;
})



