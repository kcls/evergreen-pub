import {Injectable} from '@angular/core';
import {Gateway, Hash} from './gateway.service';
import {ConfigService} from './config.service';

// Explicit render mode so we control when the widget mounts and executes.
const TURNSTILE_SCRIPT =
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Treat the session token as expired this many seconds early to avoid
// races with calls already in flight when it lapses.
const EXPIRY_SKEW_SECONDS = 30;

// Minimal shape of the global Turnstile API we use.
interface TurnstileApi {
    render(container: HTMLElement | string, options: Record<string, unknown>): string;
    execute(widgetId?: string): void;
    reset(widgetId?: string): void;
    remove(widgetId?: string): void;
}

declare global {
    interface Window { turnstile?: TurnstileApi; }
}

interface MintWaiter {
    resolve: (token: string) => void;
    reject: (err: unknown) => void;
}

/**
 * Obtains and caches a CAPTCHA-minted session token.
 *
 * A Cloudflare Turnstile widget produces a response token, which we exchange
 * via kcls.address.session.create for a short-lived session token.  Callers
 * use getToken() to retrieve a valid token (minting a new one on demand) and
 * refresh() to force a new one after the backend rejects the current token.
 *
 * Provided in root so any feature can require a session token.
 */
@Injectable({providedIn: 'root'})
export class CaptchaSessionService {

    private sessionToken: string | null = null;
    private expiresAt = 0; // epoch ms; 0 = none

    private widgetId: string | null = null;
    private overlay: HTMLElement | null = null;

    private scriptLoaded: Promise<void> | null = null;
    private rendered: Promise<void> | null = null;

    // Resolvers awaiting the in-flight mint.
    private waiters: MintWaiter[] = [];
    private minting = false;

    constructor(private gateway: Gateway, private config: ConfigService) {}

    /** Return a valid session token, minting a new one if needed. */
    getToken(): Promise<string> {
        if (this.sessionToken && Date.now() < this.expiresAt) {
            return Promise.resolve(this.sessionToken);
        }
        return this.mint();
    }

    /** Discard the current token and mint a fresh one. */
    refresh(): Promise<string> {
        this.sessionToken = null;
        this.expiresAt = 0;
        return this.mint();
    }

    // --- internals ----------------------------------------------------------

    private mint(): Promise<string> {
        return this.ensureRendered().then(() => new Promise<string>((resolve, reject) => {
            this.waiters.push({resolve, reject});

            // Coalesce concurrent callers into a single challenge.
            if (this.minting) { return; }
            this.minting = true;

            try {
                // Reset so a repeat execution gets a fresh challenge token.
                window.turnstile!.reset(this.widgetId!);
                window.turnstile!.execute(this.widgetId!);
            } catch (err) {
                this.failWaiters(err);
            }
        }));
    }

    // Turnstile success callback: trade the response for a session token.
    private onTurnstileToken(turnstileResponse: string) {
        this.gateway.requestOne(
            'kcls.address',
            'kcls.address.session.create',
            turnstileResponse
        ).then(resp => {
            const r = (resp || {}) as Hash;
            const token = r['token'] as string;
            const expiresIn = Number(r['expires_in'] || 0);

            if (!token) {
                this.failWaiters('No session token returned');
                return;
            }

            this.sessionToken = token;
            this.expiresAt =
                Date.now() + Math.max(0, expiresIn - EXPIRY_SKEW_SECONDS) * 1000;

            this.resolveWaiters(token);
        }).catch(err => this.failWaiters(err));
    }

    private resolveWaiters(token: string) {
        this.minting = false;
        const waiters = this.waiters;
        this.waiters = [];
        waiters.forEach(w => w.resolve(token));
    }

    private failWaiters(err: unknown) {
        this.minting = false;
        const waiters = this.waiters;
        this.waiters = [];
        waiters.forEach(w => w.reject(err));
    }

    private ensureScript(): Promise<void> {
        if (this.scriptLoaded) { return this.scriptLoaded; }

        this.scriptLoaded = new Promise<void>((resolve, reject) => {
            if (window.turnstile) { resolve(); return; }

            const script = document.createElement('script');
            script.src = TURNSTILE_SCRIPT;
            script.async = true;
            script.defer = true;
            script.onload = () => resolve();
            script.onerror = () => reject('Failed to load Turnstile script');
            document.head.appendChild(script);
        });

        return this.scriptLoaded;
    }

    // Build a hidden, centered modal overlay hosting the widget.  It is
    // revealed only while a challenge requires user interaction.  Returns
    // the element the widget should render into.
    private buildOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position: fixed; inset: 0; z-index: 2000;' +
            'display: flex; align-items: center; justify-content: center;' +
            'background: rgba(0, 0, 0, 0.5);' +
            'visibility: hidden; opacity: 0; transition: opacity 150ms ease;';

        const panel = document.createElement('div');
        panel.style.cssText =
            'background: #fff; color: #222; border-radius: 8px;' +
            'padding: 1.5rem 2rem; max-width: 90vw; text-align: center;' +
            'box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);' +
            'display: flex; flex-direction: column; align-items: center;' +
            'gap: 1rem; font: 500 1rem/1.4 Roboto, sans-serif;';

        const message = document.createElement('div');
        message.textContent =
            $localize`Please complete this quick security check to continue.`;

        const widgetHost = document.createElement('div');

        panel.appendChild(message);
        panel.appendChild(widgetHost);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        this.overlay = overlay;
        return widgetHost;
    }

    // Use visibility/opacity rather than display so the widget's iframe
    // keeps its layout while hidden.
    private setOverlayVisible(visible: boolean) {
        if (!this.overlay) { return; }
        this.overlay.style.visibility = visible ? 'visible' : 'hidden';
        this.overlay.style.opacity = visible ? '1' : '0';
    }

    private ensureRendered(): Promise<void> {
        if (this.rendered) { return this.rendered; }

        this.rendered = this.ensureScript().then(() => {
            const widgetHost = this.buildOverlay();

            this.widgetId = window.turnstile!.render(widgetHost, {
                sitekey: this.config.turnstileSitekey,
                // Only run the challenge when we call execute().
                execution: 'execute',
                // Stay invisible unless interaction is actually required.
                appearance: 'interaction-only',
                callback: (token: string) => {
                    this.setOverlayVisible(false);
                    this.onTurnstileToken(token);
                },
                'error-callback': () => {
                    this.setOverlayVisible(false);
                    this.failWaiters('Turnstile error');
                },
                'expired-callback': () => { this.sessionToken = null; this.expiresAt = 0; },
                'before-interactive-callback': () => this.setOverlayVisible(true),
                'after-interactive-callback': () => this.setOverlayVisible(false),
            });
        });

        return this.rendered;
    }
}
