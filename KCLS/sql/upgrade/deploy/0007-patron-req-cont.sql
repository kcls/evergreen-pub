-- Deploy kcls-evergreen:XXXX-patron-req-cont to pg
-- requires: 0004-damaged-item-letter

BEGIN;

CREATE TABLE config.ill_reject_reason (
    id SERIAL NOT NULL,
    label TEXT NOT NULL, 
    content TEXT
);

ALTER TABLE actor.usr_item_request
    ADD COLUMN ill_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN id_matched BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN patron_notes TEXT,
    ADD COLUMN requestor INTEGER NOT NULL,
    -- store the denial as plain text (no foreign key) since 
    -- staff may modify the message.
    ADD COLUMN ill_denial TEXT,
    ADD COLUMN lineitem INTEGER REFERENCES acq.lineitem(id),
    ADD COLUMN hold INTEGER REFERENCES action.hold_request(id)
;


DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT into config.org_unit_setting_type
    (name, grp, label, description, datatype, fm_class) 
VALUES (
    'patron_requests.max_active', 
    'opac', 
    'Max Active Patron Purchase/ILL Requests',
    'Max Active Patron Purchase/ILL Requests',
    'integer',
    NULL
);

INSERT INTO actor.org_unit_setting (org_unit, name, value) 
    VALUES (1, 'patron_requests.max_active', '20');

INSERT INTO permission.perm_list (code, description) VALUES (
    'CREATE_USER_ITEM_REQUEST', 
    'Allows staff to create purchase/ill requests on behalf of a patron'
);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.grid.staff.cat.requests', 'cat', 'bool',
    oils_i18n_gettext(
        'eg.grid.staff.cat.requests',
        'Patron Requests Management Grid Settings',
        'cwst','label'
    )
);

INSERT INTO config.ill_reject_reason (label, content) VALUES (
    'Staff attempted to borrow this item  for you, but unfortunately it was unavailable for loan from other library systems at this time.',
    'Staff attempted to borrow this item  for you, but unfortunately it was unavailable for loan from other library systems at this time.'
), (
    'Unfortunately, the only libraries that own this are outside of North America. We do not engage in International Interlibrary Loan at this time.',
    'Unfortunately, the only libraries that own this are outside of North America. We do not engage in International Interlibrary Loan at this time.'
), (
    'There are only a few libraries in the country that own this book and it has been in continual use. Please resubmit this request again in 2 months if still needed.',
    'There are only a few libraries in the country that own this book and it has been in continual use. Please resubmit this request again in 2 months if still needed.'
), (
    'Staff made every effort to borrow this item at no cost; however the only libraries left to ask charge loan fees of $ XX.XX Would you like to continue with this request and pay this amount if they will loan? (Please do not pre-pay.)',
    'Staff made every effort to borrow this item at no cost; however the only libraries left to ask charge loan fees of $ XX.XX Would you like to continue with this request and pay this amount if they will loan? (Please do not pre-pay.)'
), (
    'There are only a few libraries in the country that own this bookand the book has only recently been added to their collections. Libraries give priority to their patrons for new materials and are unable to loan material added recently to other libraries .  Please resubmit this request again in 3-6 months and we can try again.',
    'There are only a few libraries in the country that own this bookand the book has only recently been added to their collections. Libraries give priority to their patrons for new materials and are unable to loan material added recently to other libraries .  Please resubmit this request again in 3-6 months and we can try again.'
), (
    'Unfortunately, this item is not available in the format/language requested at this time.',
    'Unfortunately, this item is not available in the format/language requested at this time.'
), (
    'Currently, this item is available as an electronic book or audiobook only.  We can''t borrow audiovisual materials through Interlibrary Loan.',
    'Currently, this item is available as an electronic book or audiobook only.  We can''t borrow audiovisual materials through Interlibrary Loan.'
), (
    'KCLS currently owns this book. Interlibrary loan is strictly for books that we do not own. Please see reference staff to arrange a reference loan if needed.',
    'KCLS currently owns this book. Interlibrary loan is strictly for books that we do not own. Please see reference staff to arrange a reference loan if needed.'
), (
    'We were unfortunately unable to obtain a loan from other library systems. The good news is that this seems to be available full text online at the following address:',
    'We were unfortunately unable to obtain a loan from other library systems. The good news is that this seems to be available full text online at the following address:'
);



END IF; END $INSERT$;                                                          

COMMIT;
