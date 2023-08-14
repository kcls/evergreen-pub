-- Deploy kcls-evergreen:0025-refund-summary-letter to pg
-- requires: 0024-damaged-item-letter

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT INTO config.print_template 
    (name, label, owner, locale, active, template) VALUES 
    ('refund_summary', 'Refund Summary', 1, 'en-US', TRUE, 
$TEMPLATE$

[%
  USE date;
  USE money = format('$%.2f');
  SET refundable_xact = template_data.refundable_xact;
  SET refund_actions = template_data.refund_actions;
  SET patron = refundable_xact.usr;
%]

<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEoAAACTCAMAAAAeP3+kAAAAY1BMVEU1Hx8/Hh8rIB8hISAuLi08PDtJHR5THB5eGx5oGh1yGR18GB1KSklYWFdmZmV0dHOGFxyRFhybFRylFBuvExu5EhvEEhuCgoGQkI+dnZ2rq6u5ubnHx8fV1dXj4+Px8fH////Hk/DvAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5AcIEgIflgkfogAAA2pJREFUaN7tmg2PoyAQhjc7umk2WnO5i6Vq6/z/X3mAfAsIlbttU81mF3V4BGTeGWE/sNjx8RYo2H0cqOdGDVgKNWAxFJZCdVgKxUllUFgMha+B+vrT9/1eVK+PgqhTOdTvcqh+J+pUDgX/BvVVDvWrHKrfifrORmEI9Skw34k+2Nnnlg+estzZVbodyuBWfRjVqbRkL6ozUhwbRUJHCGWlS55L6yPcwbVZGsk37CvDNFLsDSrTGKnamKIOK40UcBybFSY1KT6YdJyTlCEwtA+F1HxWWK+yWRHpy2XFVDSTFRXkPFZc27NYG2Eih7UVcTJYm8ErnbWhV47HRsHbqLCj56NWSrIDZWgJ7kX5Y8hjKNEuLIHiLCyDovfnUiicsRgKfxR1LFkcqIz5FJhlb4biY1eZVGgNjfcllC0I+fGgnFDQulmpdX8GGG81+FE3qMKoq4syTtYo68vERcHNRUXGahVVLFQDjYWq46g5ghI/Vv/Y1xLxdxBiKKfdF1qe6KcXeegN2kPAIRhCDdYr3JgMAPcICq/mcK1R6ElBpjd05wP18qiBzd3aXqwQfjYJmwlU0CTSl5o1amY+VfMbcMFxURwDdXNRhFlUXkGuHXcDG8UqTmA6J5dwTwe10/PnI22Xg6JttVH0OmygDD0yUDRSrVBqk2ALNdgoauKgxG0XpVVfGDZOB1vdCo2KROfVsAOfJbJ6IopOBnIV9aupW2rRAZqaZYGz1XW3UHzFppEhHEatulyj24uRK8hyeyjDHtSRIf8YitzFIrZYyZ7VmrZT707IwP5eF8vB486T8QRD3bUTCYuJXaqEc/szZBulXJdlShKBMlbgkkFRb8UElJbtESzNVCgaDiAFpcPXWWglzVWrBUVaU9NSOriUzGoiGLYKQdJQKEcU7A2GiXV+zkHNoFCscFcBgI3VBaIouR0vTxo0o5EQZCKHHSKow51fWZCfGNXxAE8zB/6LCJNqOWNHJ4s1F7EwasJuHJfL7GSxIGfj23SSxZbb34xNXBu1WPJSB0u63JoLiu7+L320vm6jZrX3hNhJHSAxlMjmPGNl7nrqHdGzi1Id5Auv3g4a9kR3jGC4VdAhhFAg2kDM/cgxjIIqMOwsIjlNYaZ1BBV4g3e9fSBRNVfP9VjhBupYF/3fqOf8d8qnQ/0FoyAplAJi8qoAAAAASUVORK5CYII="/>

<div>[% patron.first_given_name %] [% patron.family_name %]</div>
<br/>
<br/>

<div>REFUND HAPPENED: [% money(refundable_xact.refund_amount) %]</div>

$TEMPLATE$
);


END IF; END $INSERT$;                                                          

COMMIT;
