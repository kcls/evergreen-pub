-- Revert kcls-evergreen:XXXX-checkout-emails from pg

BEGIN;

UPDATE config.usr_setting_type 
    SET opac_visible = FALSE WHERE name = 'notification.checkout.email';

UPDATE action_trigger.event_definition SET active = FALSE WHERE id = 231;

COMMIT;
