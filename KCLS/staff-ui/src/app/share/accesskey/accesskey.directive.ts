/**
 * Assign access keys to <a> tags.
 *
 * Access key action is peformed via .click(). hrefs, routerLinks,
 * and (click) actions are all supported.
 *
 *   <a
 *     routerLink="/staff/splash"
 *     egAccessKey
 *     keySpec="alt+h" i18n-keySpec
 *     keyDesc="My Description" 18n-keyDesc
 *   >
 */
import {Directive, ElementRef, Input, OnInit} from '@angular/core';
import {Location} from '@angular/common';
import {AccessKeyService} from '@eg/share/accesskey/accesskey.service';
import {Router} from '@angular/router';

@Directive({
  selector: '[egAccessKey]'
})
export class AccessKeyDirective implements OnInit {

    // Space-separated list of key combinations
    // E.g. "ctrl+h", "alt+h ctrl+y"
    @Input() keySpec: string;

    // Description to display in the accesskey info dialog
    @Input() keyDesc: string;

    // Context info to display in the accesskey info dialog
    // E.g. "navbar"
    @Input() keyCtx: string;

    constructor(
        private elm: ElementRef,
        private router: Router,
        private ngLocation: Location,
        private keyService: AccessKeyService
    ) { }

    ngOnInit() {

        if (!this.keySpec) {
            console.warn('AccessKey no keySpec provided');
            return;
        }

        this.keySpec.split(/ /).forEach(keySpec => {
            this.keyService.assign({
                key: keySpec,
                desc: this.keyDesc,
                ctx: this.keyCtx,
                action: () => this.performAction()
            });
        });
    }

    performAction() {
        const node = this.elm.nativeElement;
        const link = node.getAttribute('routerLink');

        if (link) {
            // Links that route back to the same page we are currently
            // on do not reload the page when done via routerLink.  That
            // is the desired behavior, though.
            const myUrl = this.ngLocation.prepareExternalUrl(this.router.url);
            const newUrl = this.ngLocation.prepareExternalUrl(link);

            if (myUrl === newUrl) {
                console.debug("Reloading current page on access key");
                // Force a page reload
                location.href = location.href;
                return;
            }
        }

        this.elm.nativeElement.click();
    }
}


