-- Deploy kcls-evergreen:XXXX-patron-edit-dibs to pg
-- requires: 0026-disable-sysmspell

BEGIN;

ALTER TABLE actor.usr ADD COLUMN dibs TEXT;
SELECT auditor.update_auditors();

COMMIT;
