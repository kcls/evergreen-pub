import {ErrorHandler, Injectable} from '@angular/core';

/**
 * Recovers from lazy-chunk load failures that occur after a deploy.
 *
 * When a new build is published the content-hashed chunk filenames
 * change.  A browser still running the previous build (or holding a
 * stale entry bundle) can request a chunk that no longer resolves on
 * the server, producing a ChunkLoadError.  For a lazy-loaded route
 * (e.g. /requests) this leaves the app shell rendered but the routed
 * body empty.  Forcing a full reload pulls the current index.html and
 * the matching new chunks, clearing the error transparently.
 */

// Patterns emitted by webpack / the browser when a JS or CSS chunk or
// dynamic import fails to load.
const CHUNK_FAILURE =
    /ChunkLoadError|Loading chunk \S+ failed|Loading CSS chunk|dynamically imported module/i;

// If we already force-reloaded within this window, do not reload again:
// the chunk is genuinely unavailable and another reload would loop.
const RELOAD_GUARD_MS = 10000;
const RELOAD_STAMP_KEY = 'chunkReloadAt';

@Injectable()
export class ChunkErrorHandler extends ErrorHandler {

    override handleError(error: any): void {
        const message = (error && (error.message || error.toString())) || '';

        if (CHUNK_FAILURE.test(message)) {
            const last = Number(window.sessionStorage.getItem(RELOAD_STAMP_KEY)) || 0;
            const now = Date.now();

            if (now - last > RELOAD_GUARD_MS) {
                console.debug('Chunk load failure detected; reloading to fetch current build', error);
                window.sessionStorage.setItem(RELOAD_STAMP_KEY, '' + now);
                window.location.reload();
                return;
            }
        }

        // Preserve default logging for everything else (and for a
        // chunk failure that recurs within the guard window).
        super.handleError(error);
    }
}
