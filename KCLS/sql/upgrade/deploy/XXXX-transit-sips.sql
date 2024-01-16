-- Deploy kcls-evergreen:XXXX-transit-sips to pg
-- requires: 0003-patron-requests

BEGIN;

INSERT INTO config.workstation_setting_type                                    
    (name, label, grp, datatype)                                               
VALUES (                                                                       
    'eg.circ.checkin.auto_print_transits',                                  
    'Checkin: Auto-Print Transit Slips',                                         
    'circ',                                                                    
    'bool'                                                                     
); 

COMMIT;
