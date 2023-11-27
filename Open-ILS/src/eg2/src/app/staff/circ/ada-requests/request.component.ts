import {Component, OnInit, Renderer2, ViewChild} from '@angular/core';
import {Router, ActivatedRoute} from '@angular/router';
import {Observable, empty} from 'rxjs';
import {mergeMap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {GridDataSource} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {DialogComponent} from '@eg/share/dialog/dialog.component';


@Component({
    selector: 'eg-ada-request-dialog',
    templateUrl: 'request.component.html'
})

export class AdaRequestDialogComponent extends DialogComponent {

    request: IdlObject;

    constructor(
        private modal: NgbModal,
        private router: Router,
        private org: OrgService,
        private auth: AuthService,
        private pcrud: PcrudService
    ) { super(modal); }

    user(): IdlObject {
        return this.request.usr();
    }

    approveRequest() {
        if (this.request.approved_by()) { return; }
        this.request.approve_time('now');
        this.request.approved_by(this.auth.user().id());
        this.pcrud.update(this.request).toPromise().then(_ => this.close(this.request));
    }

    rejectRequest() {
        if (this.request.rejected_by()) { return; }
        this.request.reject_time('now');
        this.request.rejected_by(this.auth.user().id());
        this.pcrud.update(this.request).toPromise().then(_ => this.close(this.request));
    }

}
