import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {Observable, throwError, from, empty} from 'rxjs';
import {tap, map, switchMap} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {OrgService} from '@eg/core/org.service';
import {StringComponent} from '@eg/share/string/string.component';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {StaffService} from '@eg/staff/share/staff.service';

/**
 * Dialog for managing copy notes.
 */

@Component({
  selector: 'eg-copy-notes-dialog',
  templateUrl: 'copy-notes-dialog.component.html'
})

export class CopyNotesDialogComponent
    extends DialogComponent implements OnInit {

    @Input() copyId: number = null;

    copy: IdlObject;

    creating = false;
    curNote: string;
    curNoteTitle: string;
    curNotePublic = false;
    curDibs: string;
    newNote: IdlObject;

    @ViewChild('successMsg', { static: true }) private successMsg: StringComponent;
    @ViewChild('errorMsg', { static: true }) private errorMsg: StringComponent;

    constructor(
        private modal: NgbModal, // required for passing to parent
        private toast: ToastService,
        private net: NetService,
        private idl: IdlService,
        private pcrud: PcrudService,
        private staff: StaffService,
        private org: OrgService,
        private auth: AuthService) {
        super(modal); // required for subclassing
    }

    ngOnInit() {
    }

    /**
     */
    open(args: NgbModalOptions): Observable<IdlObject[]> {
        this.copy = null;

        if (!this.copyId) {
            return throwError('copy ID required');
        }

        // Observify data loading
        const obs = from(this.getCopy());

        // Return open() observable to caller
        return obs.pipe(switchMap(_ => super.open(args)));
    }

    getCopy(): Promise<any> {

        return this.pcrud.retrieve('acp', this.copyId,
            {flesh: 1, flesh_fields: {acp: ['notes']}}
        )
        .toPromise().then(copy => this.copy = copy);
    }

    create() {
        this.creating = true;
        setTimeout(() => {
            const node = document.getElementById('note-title');
            if (node) { node.focus(); }
        });
    }

    removeNote(note: IdlObject) {
        if (note.isnew()) { return; }

        const existing = this.copy.notes().filter(n => n.id() === note.id())[0];
        if (!existing) { return; }

        existing.isdeleted(true);

        return this.pcrud.remove(existing).toPromise()
        .then(_ => {
            this.copy.notes(this.copy.notes().filter(n => n.id() !== note.id()));
        });
    }

    addNew() {
        if (!this.curDibs || !this.curNote) { return; }

        const note = this.idl.create('acpn');
        note.isnew(true);
        note.creator(this.auth.user().id());
        note.pub(this.curNotePublic ? 't' : 'f');
        note.title(this.curNoteTitle || ''); // Not required in XUL
        note.value(this.staff.appendInitials(this.curNote, this.curDibs));
        note.owning_copy(this.copyId);

        this.pcrud.create(note).toPromise().then(newNote => {

            this.curDibs = '';
            this.curNote = '';
            this.curNoteTitle = '';
            this.curNotePublic = false;

            this.copy.notes().push(newNote);

            this.creating = false;
            this.successMsg.current().then(msg => this.toast.success(msg));
        });
    }
}

