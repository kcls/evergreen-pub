import {Injectable, EventEmitter} from '@angular/core';
import {Gateway, Hash} from './gateway.service';

const AUTH_STORE_KEY = 'authtoken';
const AUTH_POLL_TIME = 330;

// Place to store common data

@Injectable()
export class AppService {

    // Make sure multiple auth load requests that typically happen at
    // page load time do not fire multiple network calls.
    authsessionPromise: Promise<void> | null = null;

    authsession: Hash | null = null;
    authSessionLoad: EventEmitter<Hash> = new EventEmitter<Hash>();

    authPollTimeoutId: number | null = null;

    orgTree: Hash | null = null;
    orgHash: {[id: number]: Hash} = {};

    constructor(private gateway: Gateway) {
        this.gateway.authSessionEnded.subscribe(() => {
            console.debug('Clearing auth data on timeout');
            this.clearAuth()
        });
    }

    setAuthtoken(token: string | null) {
        if (token === null || token === undefined) {
            window.sessionStorage.removeItem(AUTH_STORE_KEY);
        } else {
            window.sessionStorage.setItem(AUTH_STORE_KEY, token);
        }
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
                this.pollAuth();
            } else {
                this.gateway.authSessionEnded.emit();
            }
        });

        this.authsessionPromise.catch(() => this.clearAuth());
        this.authsessionPromise.finally(() => this.authsessionPromise = null);

        return this.authsessionPromise;
    }

    pollAuth() {
        if (this.authPollTimeoutId) {
            clearTimeout(this.authPollTimeoutId);
        }

        // Calling fetchAuthSession() will suffice to result in emission
        // of authSessionEnded() event and clear things up.
        this.authPollTimeoutId = setTimeout(
            () => {
                console.debug('Polling auth session...');
                this.fetchAuthSession(true);
            },
            AUTH_POLL_TIME * 1000 // millis
        );
    }

    clearAuth() {
        this.authsession = null;
        this.setAuthtoken(null);
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
            {flesh: -1, flesh_fields: {aou: ["children"]}}
        ).then((tree: unknown) => {
            this.orgTree = tree as Hash;

            let flatten = (node: Hash) => {
                this.orgHash[node.id as number] = node;
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

