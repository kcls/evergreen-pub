import {Injectable, EventEmitter} from '@angular/core';
import {Gateway, Hash} from './gateway.service';

const AUTH_STORE_KEY = 'authtoken';
const AUTH_TIME_STORE_KEY = 'authtime';

// Validate auth sessions at most once a minute.
const MIN_AUTH_DURATION = 60;

// Check for patron activity this often (in seconds) and reset the
// auth timeout on the server when activity is detected.
const AUTH_ACTIVITY_POLL_TIME = 60;

// Place to store common data

@Injectable()
export class AppService {

    // Make sure multiple auth load requests that typically happen at
    // page load time do not fire multiple network calls.
    authsessionPromise: Promise<void> | null = null;

    authsession: Hash | null = null;
    authSessionLoad: EventEmitter<Hash> = new EventEmitter<Hash>();
    patronActivityOccurred = false;

    lastAuthResetTime = new Date();

    authPollTimeoutId: number | null = null;

    orgTree: Hash | null = null;
    orgHash: {[id: number]: Hash} = {};

    constructor(private gateway: Gateway) {
        this.gateway.authSessionEnded.subscribe(() => {
            // console.debug('Clearing auth data on timeout');
            this.clearAuth();
            location.reload();
        });
    }

    // Apply the auth token and auth duration
    setAuthtoken(token: string, duration: number) {
        window.sessionStorage.setItem(AUTH_STORE_KEY, token);
        window.sessionStorage.setItem(AUTH_TIME_STORE_KEY, duration + '');
    }

    clearAuthtoken() {
        window.sessionStorage.removeItem(AUTH_STORE_KEY);
        window.sessionStorage.removeItem(AUTH_TIME_STORE_KEY);
    }

    // Return a sane non-null value in all cases to avoid settimeouts
    // with funky behavior.
    getAuthDuration(): number {
        let dur = Number(window.sessionStorage.getItem(AUTH_TIME_STORE_KEY));
        if (isNaN(dur) || dur < MIN_AUTH_DURATION) {
            dur = MIN_AUTH_DURATION;
        }
        return dur;
    }

    getAuthtoken(): string | null {
        return window.sessionStorage.getItem(AUTH_STORE_KEY);
    }

    // Returns the previously fetched session.
    getAuthSession(): Hash | null {
        return this.authsession;
    }

    fetchAuthSession(force?: boolean): Promise<void> {
        if (this.authsession && !force) {
            return Promise.resolve();
        }

        const token = this.getAuthtoken();
        if (!token) { return Promise.resolve(); }

        if (this.authsessionPromise) {
            return this.authsessionPromise;
        }

        this.authsessionPromise = this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.session.retrieve.hash',
            token
        ).then((ses: unknown) => {
            if (ses) {
                this.authsession = ses as Hash;
                this.authSessionLoad.emit(this.authsession);
                this.lastAuthResetTime = new Date();
                this.watchForActivity();
                this.pollAuth();
            } else {
                this.gateway.authSessionEnded.emit();
            }
        });

        this.authsessionPromise.catch(() => this.clearAuth());
        this.authsessionPromise.finally(() => this.authsessionPromise = null);

        return this.authsessionPromise;
    }


    // Periodically check for patron activity and reset the auth session
    // timeout on the server.
    pollAuth() {
        if (this.authPollTimeoutId) {
            clearTimeout(this.authPollTimeoutId);
        }

        this.authPollTimeoutId = setTimeout(
            () => this.resetAuthTimeout(),
            AUTH_ACTIVITY_POLL_TIME * 1000
        );
    }

    // Reset the server auth timeout and the local activity-occurred flag
    resetAuthTimeout(): Promise<unknown> {
        this.pollAuth();

        if (!this.patronActivityOccurred) {
            // console.debug('No activity has occurred');

            let spanMillis = new Date().getTime() - this.lastAuthResetTime.getTime();

            if (spanMillis < (this.getAuthDuration() * 1000)) {
                // console.debug('auth session is still valid, duration', this.getAuthDuration());
                // Auth session is still valid.
                return Promise.resolve();
            }

            // console.debug('Forcing logout on auth timeout');

            // Auth session has theoretically timed out.  Force a logout,
            // regardless of the validity of the session on the server.
            return this.logout();
        }

        this.lastAuthResetTime = new Date();
        this.patronActivityOccurred = false;

        // console.debug('resetting auth on activity', this.lastAuthResetTime);

        return this.gateway.requestOne(
            'open-ils.auth',
            'open-ils.auth.session.reset_timeout',
            this.getAuthtoken() || ""
        ).then(resp => {
            // console.debug('auth reset returned', resp);
        });
    }

    // Delete the auth token and emit a session-ended event for cleanup.
    logout(): Promise<void> {
        return this.gateway.requestOne(
            'open-ils.auth',
            'open-ils.auth.session.delete',
            this.getAuthtoken()
        ).then(_ => {
            // This will force a local auth clear and page reload.
            this.gateway.authSessionEnded.emit();
        });
    }

    // Watches for certain patron actions.
    watchForActivity() {
        window.addEventListener('click', () => this.patronActivityOccurred = true);
        window.addEventListener('keypress', () => this.patronActivityOccurred = true);
    }

    clearAuth() {
        this.authsession = null;
        this.clearAuthtoken();
        this.authsessionPromise = null;

        if (this.authPollTimeoutId) {
            clearTimeout(this.authPollTimeoutId);
            this.authPollTimeoutId = null;
        }
    }

    getOrgTree(): Promise<Hash> {
        if (this.orgTree) {
            return Promise.resolve(this.orgTree);
        }

        return this.gateway.requestOne(
            'open-ils.pcrud',
            'open-ils.pcrud.search.aou',
            'ANONYMOUS',
            {parent_ou: null},
            {flesh: -1, flesh_fields: {aou: ["children", "ou_type"]}}
        ).then((tree: unknown) => {
            this.orgTree = tree as Hash;

            let flatten = (node: Hash) => {
                this.orgHash[Number(node.id)] = node;
                (node.children as Hash[]).forEach(flatten);
            }

            flatten(tree as Hash);

            // When first retrieving the tree, create a hash version
            // as well for easier lookup.

            return this.orgTree;
        });
    }

    // Values will only be available if getOrgTree() has been called.
    getOrgUnit(id: number): Hash | null {
        return this.orgHash[id];
    }
}

