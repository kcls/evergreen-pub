-- Deploy kcls-evergreen:XXXX-ill-req-perm to pg
-- requires: 0017-org-select-short-names

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT INTO permission.perm_list (code, description) VALUES 
    ('REQUEST_ILL_ITEMS', 'Allows users to create request for ILL items');

INSERT INTO permission.grp_perm_map (perm, depth, grp) VALUES (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        1003 -- ADA Circulation                                                   
    ), (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        91  -- Enumclaw Migration                                                 
    ), (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        13  -- Full Privileges                                                    
    ), (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        38  -- KCLS Staff                                                         
    ), (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        18  -- Outreach                                                           
    ), (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        28  -- Parental Limit 10                                                  
    ), (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        27  -- Parental Limit 5                                                   
    ), (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        29  -- Parental Limit 5                                                   
    ), (
        (SELECT id FROM permission.perm_list WHERE code = 'REQUEST_ILL_ITEMS'), 
        0,
        92  -- Set Expiration - Full                                               
    )
;

END IF; END $INSERT$;                                                          

COMMIT;
