-- Deploy kcls-evergreen:0025-refund-summary-letter to pg
-- requires: 0024-damaged-item-letter

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

DELETE FROM config.print_template WHERE name = 'refund_summary';

INSERT INTO config.print_template 
    (name, label, owner, locale, active, template) VALUES 
    ('refund_summary', 'Refund Summary', 1, 'en-US', TRUE, 
$TEMPLATE$

[%
  USE date;
  USE Math;
  USE money = format('$%.2f');
  SET refundable_xact = template_data.refundable_xact;
  SET refund_actions = template_data.refund_actions;
  SET patron = refundable_xact.usr;
%]
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEoAAACTCAMAAAAeP3+kAAAAY1BMVEU1Hx8/Hh8rIB8hISAuLi08PDtJHR5THB5eGx5oGh1yGR18GB1KSklYWFdmZmV0dHOGFxyRFhybFRylFBuvExu5EhvEEhuCgoGQkI+dnZ2rq6u5ubnHx8fV1dXj4+Px8fH////Hk/DvAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5AcIEgIflgkfogAAA2pJREFUaN7tmg2PoyAQhjc7umk2WnO5i6Vq6/z/X3mAfAsIlbttU81mF3V4BGTeGWE/sNjx8RYo2H0cqOdGDVgKNWAxFJZCdVgKxUllUFgMha+B+vrT9/1eVK+PgqhTOdTvcqh+J+pUDgX/BvVVDvWrHKrfifrORmEI9Skw34k+2Nnnlg+estzZVbodyuBWfRjVqbRkL6ozUhwbRUJHCGWlS55L6yPcwbVZGsk37CvDNFLsDSrTGKnamKIOK40UcBybFSY1KT6YdJyTlCEwtA+F1HxWWK+yWRHpy2XFVDSTFRXkPFZc27NYG2Eih7UVcTJYm8ErnbWhV47HRsHbqLCj56NWSrIDZWgJ7kX5Y8hjKNEuLIHiLCyDovfnUiicsRgKfxR1LFkcqIz5FJhlb4biY1eZVGgNjfcllC0I+fGgnFDQulmpdX8GGG81+FE3qMKoq4syTtYo68vERcHNRUXGahVVLFQDjYWq46g5ghI/Vv/Y1xLxdxBiKKfdF1qe6KcXeegN2kPAIRhCDdYr3JgMAPcICq/mcK1R6ElBpjd05wP18qiBzd3aXqwQfjYJmwlU0CTSl5o1amY+VfMbcMFxURwDdXNRhFlUXkGuHXcDG8UqTmA6J5dwTwe10/PnI22Xg6JttVH0OmygDD0yUDRSrVBqk2ALNdgoauKgxG0XpVVfGDZOB1vdCo2KROfVsAOfJbJ6IopOBnIV9aupW2rRAZqaZYGz1XW3UHzFppEhHEatulyj24uRK8hyeyjDHtSRIf8YitzFIrZYyZ7VmrZT707IwP5eF8vB486T8QRD3bUTCYuJXaqEc/szZBulXJdlShKBMlbgkkFRb8UElJbtESzNVCgaDiAFpcPXWWglzVWrBUVaU9NSOriUzGoiGLYKQdJQKEcU7A2GiXV+zkHNoFCscFcBgI3VBaIouR0vTxo0o5EQZCKHHSKow51fWZCfGNXxAE8zB/6LCJNqOWNHJ4s1F7EwasJuHJfL7GSxIGfj23SSxZbb34xNXBu1WPJSB0u63JoLiu7+L320vm6jZrX3hNhJHSAxlMjmPGNl7nrqHdGzi1Id5Auv3g4a9kR3jGC4VdAhhFAg2kDM/cgxjIIqMOwsIjlNYaZ1BBV4g3e9fSBRNVfP9VjhBupYF/3fqOf8d8qnQ/0FoyAplAJi8qoAAAAASUVORK5CYII="/>

<style>
  table { border-collapse: collapse; }
  td {padding-right: 10px; }
  div.border-top { border-top: 1px solid grey; }
</style>

<br/>
<div>[% patron.first_given_name %] [% patron.family_name %]</div>
[% IF addr %]
<div>[% addr.street1 %][% addr.street2 %]</div>
<div>[% addr.city %], [% addr.state %] [% addr.post_code %]</div>
[% END %]
<br/>

<h3>Refund Information</h3>

<span>Item Information</span>
<br/>

<div class="border-top">
  <table>
    <tr><td>Title</td><td>[% refundable_xact.title %]</td></tr>
    <tr><td>Barcode</td><td>[% refundable_xact.copy_barcode %]</td></tr>
  </table>
</div>

<br/>
<span>The following refundable payments were made:</span>
<br/>
<br/>

[% FOR ref_pay IN refundable_xact.refundable_payments %]
  <div class="border-top">
    <table>
      <tr>
        <td>Receipt #:</td>
        <td>[% ref_pay.receipt_code %]</td>
      </tr>
      <tr>
        <td>Payment Date:</td>
        <td>[% date.format(ref_pay.payment_time, '%x %r') %]</td>
      </tr>
      <tr>
        <td>Last Payment Type:</td>
        <td>[% refundable_xact.xact.summary.last_payment_type %]</td>
      </tr>
      <tr>
        <td>Last Payment Date:</td>
        <td>[% refundable_xact.xact.summary.last_payment_ts %]</td>
      </tr>
      <tr>
        <td>Amount:</td>
        <td>[% money(ref_pay.amount) %]</td>
      </tr>
    </table>
  </div>
[% END %]

<br/>
<span>
  The following actions were taken on your account due to the return
  of a lost and paid item:
</span>
<br/>
<br/>

[% FOR action IN refund_actions %]
[% SET xact = action.payment.xact %]
[% SET copy = xact.circulation.target_copy %]
  [% IF action.action == 'credit'; NEXT; END %]
  <div class="border-top">
    <table>
      <tr>
        <td>Transaction: </td>
        <td>#[% action.payment.xact.id %]</td>
      </tr>
      [% IF copy %]
      <tr>
        <td>Title: </td>
        <td>[% copy.call_number.record.simple_record.title %]</td>
      </tr>
      <tr>
        <td>Last Billing Type:</td>
        <td>[% xact.summary.last_billing_type %]</td>
      </tr>
      [% ELSE %]
      <tr>
        <td>Charge Type:</td>
        <td>[% xact.summary.last_billing_type %]</td>
      </tr>
      [% END %]
      <tr>
        <td>Last Billing Date:</td>
        <td>[% date.format(xact.summary.last_billing_ts, '%x %r') %]</td>
      </tr>
      <tr>
        <td>Last Payment Type: </td>
        <td>[% xact.summary.last_payment_type %]
      </tr>
      <tr>
        <td>Last Payment Date: </td>
        <td>[% date.format(xact.summary.last_payment_ts, '%x %r') %]
      </tr>
      <tr>
        <td>Refund Amount Applied: </td>
        <td>[% money(Math.abs(action.payment.amount)) %]</td>
      </tr>
      <tr>
        <td>Transaction Balance:</td>
        <td>[% money(xact.summary.balance_owed) %]</td>
      </tr>
    </table>
  </div>
[% END %]
<hr/>

<div>Remaining Refund Due: <b>[% money(refundable_xact.refund_amount) %]</b></div>
<br/>

[% IF refundable_xact.refund_amount > 0 %]
  [% FOR ref_pay IN refundable_xact.refundable_payments %]
    [% IF ref_pay.payment.payment_type == 'credit_card_payment' %]
      <div>Refund for payment #[% ref_pay.receipt_code %] will be applied as a credit to your credit card.</div>
    [% ELSE %]
      <div>Refund for payment #[% ref_pay.receipt_code %] will be mailed as a check.</div>
    [% END %]
  [% END %]
[% END %]

<br/>
<p>KCLS Staff: [% refundable_xact.dibs %]</p>

<div style="border: 1px solid grey; padding: 5px;">
  <div>[% staff_org.name.remove('Library') %] Library</div>
  [% SET org_addr = staff_org.billing_address || staff_org.mailing_address %]
  [% IF org_addr %]
    <div>[% org_addr.street1 %][% org_addr.street2 %]</div>
    <div>[% org_addr.city %], [% org_addr.state %] [% org_addr.post_code %]</div>
  [% END %]
  <div>[% staff_org.phone %]</div>
</div>


$TEMPLATE$
);

INSERT INTO permission.perm_list (code, description) VALUES (
    'CHECKIN_BYPASS_REFUND',
    'Allows a user to check in refundable item without automatically processing the refund'
);

END IF; END $INSERT$;                                                          

COMMIT;
