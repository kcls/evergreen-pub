-- Revert kcls-evergreen:XXXX-ill-req-perm from pg

BEGIN;

DELETE FROM permission.grp_perm_map WHERE grp = 
    (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'); 

DELETE FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS';

COMMIT;

