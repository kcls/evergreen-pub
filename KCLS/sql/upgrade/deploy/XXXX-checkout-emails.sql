-- Deploy kcls-evergreen:XXXX-checkout-emails to pg
-- requires: 0004-damaged-item-letter

BEGIN;

UPDATE config.usr_setting_type SET opac_visible = TRUE 
    WHERE name = 'notification.checkout.email';

UPDATE action_trigger.event_definition SET 
    validator = 'NOOP_True', 
    active = TRUE, 
    delay = '00:00:10',
    opt_in_setting = 'notification.checkout.email'
    WHERE id = 231;

COMMIT;
