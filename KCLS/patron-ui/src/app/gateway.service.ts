import {Injectable, EventEmitter} from '@angular/core';
import {Observable, Observer} from 'rxjs';
import {HttpClient, HttpRequest} from '@angular/common/http';
import {HttpEvent, HttpResponse, HttpErrorResponse} from '@angular/common/http';
import {take} from 'rxjs/operators';

// Simple hash; useful for casting 'unknown' API responses to something that
// makes the linter happier.
export type Hash = Record<string | number, unknown>;

interface GatewayResponse {
    status: number;
    payload: Array<unknown>;
}

const GATEWAY_PATH = '/osrf-gateway-v1';

@Injectable()
export class Gateway {

    authSessionEnded: EventEmitter<void> = new EventEmitter<void>();

    constructor(private http: HttpClient) { }

    // Sends an API request to the OpenSRF gateway w/ caveats.
    //
    // No Evergreen/IDL parsing occurs.  Simple JSON values only.
    //
    // The gateway packages API responses into a single array.  This
    // returns the contents of the array via an observable, one emission
    // per array value.
    request(service: string, method: string, ...params: unknown[]): Observable<unknown> {
        console.debug(`Gateway service=${service}\n  method=${method}\n  paramCount=${params.length}`);

        let postData =
          `service=${encodeURIComponent(service)}&method=${encodeURIComponent(method)}`;

        for (const param of params) {
            postData += `&param=${encodeURIComponent(JSON.stringify(param))}`;
        }

        const req = new HttpRequest('POST', GATEWAY_PATH, postData, {responseType: 'json'});

        return Observable.create((obs: Observer<unknown>) => {
            this.http.request<GatewayResponse>(req).subscribe(
                (evt: HttpEvent<GatewayResponse>) => {
                    if (!(evt instanceof HttpResponse)) {
                        // We don't care about non-completion events.
                        return;
                    }

                    //console.debug("Gateway response: ", evt);

                    const resp = evt as HttpResponse<GatewayResponse>;
                    const body = resp.body || {payload: [], status: 0};
                    const payload = body.payload || [];

                    if (!Array.isArray(payload) || Number(body.status) !== 200) {
                        console.error("Gateway returned unexpected payload: ", evt);
                        obs.error("Gatway Error");
                        return;
                    }

                    // If the first item in the response list is a
                    // NO_SESSION event, emit the session-ended event
                    // and return no responses to the caller.
                    const egEvt = payload[0];
                    if (typeof egEvt === 'object'
                        && !Array.isArray(egEvt)
                        && egEvt !== null
                        && (egEvt as Hash).textcode === 'NO_SESSION') {

                        this.authSessionEnded.emit();
                        obs.error("Auth Session Expired");
                        return;
                    }

                    payload.forEach((p: unknown) => obs.next(p));
                    obs.complete();
                },
                (evt: HttpErrorResponse) => {
                    console.error("Gateway error: ", evt);
                }
            );
        });
    }

    /// Send an API request and return promise of the first response from the gateway.
    requestOne(service: string, method: string, ...params: unknown[]): Promise<unknown> {
        return this.request(service, method, ...params).pipe(take(1)).toPromise();
    }
}

