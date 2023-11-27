#!/bin/bash
# Look for SCP failures on XML notice files.

LAST_SCP_FAILURE=$(egrep -B1 'Connection refused' /var/spool/mail/opensrf | grep '^[0-9]' | cut -d' ' -f1 | tail -n 1)

echo "LAST FAILURE $LAST_SCP_FAILURE";                                         
                                                                               
TODAY=$(date +'%F')                                                            
                                                                               
echo "TODAY = $TODAY";                                                         
                                                                               
if [ "${LAST_SCP_FAILURE}x" == "${TODAY}x" ]; then
    mailx -s "UMS SCP FAILURE FOR $TODAY" bserickson@kcls.org,bbonner@kcls.org,dtmoore@kcls.org
fi; 
