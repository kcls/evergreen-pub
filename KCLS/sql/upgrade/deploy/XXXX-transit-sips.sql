-- Deploy kcls-evergreen:XXXX-transit-sips to pg
-- requires: 0003-patron-requests

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT INTO config.workstation_setting_type                                    
    (name, label, grp, datatype)                                               
VALUES (                                                                       
    'eg.circ.checkin.auto_print_transits',                                  
    'Checkin: Auto-Print Transit Slips',                                         
    'circ',                                                                    
    'bool'                                                                     
); 

END IF; END $INSERT$;                                                          

COMMIT;
