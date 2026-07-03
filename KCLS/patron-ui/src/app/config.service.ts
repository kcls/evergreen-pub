import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';

// Site-wide runtime config, served at the web root outside any app's deploy
// tree so code deployments never touch it.  Each environment (cluster)
// provisions this file once; see site-config.json.example for the schema.
const CONFIG_URL = '/site-config.json';

interface SiteConfig {
    turnstile?: {
        sitekey?: string;
    };
}

const DEFAULT_CONFIG: SiteConfig = {};

/**
 * Loads site-wide runtime configuration before the app bootstraps (wired via
 * APP_INITIALIZER).  Loading is resilient: on failure (e.g. an un-provisioned
 * cluster) the app still starts with defaults.
 */
@Injectable({providedIn: 'root'})
export class ConfigService {

    private config: SiteConfig = DEFAULT_CONFIG;

    constructor(private http: HttpClient) {}

    load(): Promise<void> {
        return firstValueFrom(this.http.get<SiteConfig>(CONFIG_URL))
            .then(cfg => { this.config = cfg || DEFAULT_CONFIG; })
            .catch(err => {
                console.error(`Failed to load runtime config from ${CONFIG_URL}`, err);
            });
    }

    get turnstileSitekey(): string {
        return this.config.turnstile?.sitekey ?? '';
    }
}
