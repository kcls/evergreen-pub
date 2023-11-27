-- Deploy kcls-evergreen:0024-damaged-item-letter to pg
-- requires: 0023-on-order-call-numbers

BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT INTO config.print_template 
    (name, label, owner, locale, active, template) VALUES 
    ('damaged_item_letter', 'Damaged Item Letter', 1, 'en-US', TRUE, 
$TEMPLATE$

[%
  USE date;
  SET circ = template_data.circulation;
  SET title = template_data.title;
  SET copy = template_data.copy;
  SET patron = template_data.patron;
  SET cost = template_data.cost;
  SET note = template_data.note;
  SET dibs = template_data.dibs;
%]
<div>
<style type="text/css" media="print">
    @page {
        size: letter; margin: 1cm
    }
</style>
<style>
  .letter { font-family: "Trebuchet MS"; }
  .rotated { transform:rotate(90deg); margin-left: 15px; }
  .font1 { font-size: .80em; }
  .font2 { font-size: .90em; }
  .font3 { font-size: 3em; font-weight: bold; }
  .font5 { font-size: 1em; }
  .font6 { font-size: 2em; }
  .font7 { font-size: 2.25em; }
  .font8 { font-size: 2.5em; font-weight: bold;  }

</style>
  <table class = "letter">
    <tr>
      <td>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEoAAACTCAMAAAAeP3+kAAAAY1BMVEU1Hx8/Hh8rIB8hISAuLi08PDtJHR5THB5eGx5oGh1yGR18GB1KSklYWFdmZmV0dHOGFxyRFhybFRylFBuvExu5EhvEEhuCgoGQkI+dnZ2rq6u5ubnHx8fV1dXj4+Px8fH////Hk/DvAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5AcIEgIflgkfogAAA2pJREFUaN7tmg2PoyAQhjc7umk2WnO5i6Vq6/z/X3mAfAsIlbttU81mF3V4BGTeGWE/sNjx8RYo2H0cqOdGDVgKNWAxFJZCdVgKxUllUFgMha+B+vrT9/1eVK+PgqhTOdTvcqh+J+pUDgX/BvVVDvWrHKrfifrORmEI9Skw34k+2Nnnlg+estzZVbodyuBWfRjVqbRkL6ozUhwbRUJHCGWlS55L6yPcwbVZGsk37CvDNFLsDSrTGKnamKIOK40UcBybFSY1KT6YdJyTlCEwtA+F1HxWWK+yWRHpy2XFVDSTFRXkPFZc27NYG2Eih7UVcTJYm8ErnbWhV47HRsHbqLCj56NWSrIDZWgJ7kX5Y8hjKNEuLIHiLCyDovfnUiicsRgKfxR1LFkcqIz5FJhlb4biY1eZVGgNjfcllC0I+fGgnFDQulmpdX8GGG81+FE3qMKoq4syTtYo68vERcHNRUXGahVVLFQDjYWq46g5ghI/Vv/Y1xLxdxBiKKfdF1qe6KcXeegN2kPAIRhCDdYr3JgMAPcICq/mcK1R6ElBpjd05wP18qiBzd3aXqwQfjYJmwlU0CTSl5o1amY+VfMbcMFxURwDdXNRhFlUXkGuHXcDG8UqTmA6J5dwTwe10/PnI22Xg6JttVH0OmygDD0yUDRSrVBqk2ALNdgoauKgxG0XpVVfGDZOB1vdCo2KROfVsAOfJbJ6IopOBnIV9aupW2rRAZqaZYGz1XW3UHzFppEhHEatulyj24uRK8hyeyjDHtSRIf8YitzFIrZYyZ7VmrZT707IwP5eF8vB486T8QRD3bUTCYuJXaqEc/szZBulXJdlShKBMlbgkkFRb8UElJbtESzNVCgaDiAFpcPXWWglzVWrBUVaU9NSOriUzGoiGLYKQdJQKEcU7A2GiXV+zkHNoFCscFcBgI3VBaIouR0vTxo0o5EQZCKHHSKow51fWZCfGNXxAE8zB/6LCJNqOWNHJ4s1F7EwasJuHJfL7GSxIGfj23SSxZbb34xNXBu1WPJSB0u63JoLiu7+L320vm6jZrX3hNhJHSAxlMjmPGNl7nrqHdGzi1Id5Auv3g4a9kR3jGC4VdAhhFAg2kDM/cgxjIIqMOwsIjlNYaZ1BBV4g3e9fSBRNVfP9VjhBupYF/3fqOf8d8qnQ/0FoyAplAJi8qoAAAAASUVORK5CYII="/>
      </td>
      <td style="padding-left:15px">
        <h1>[% staff_org.name.remove('Library') %] Library</h1>
        [% SET org_addr = staff_org.billing_address || staff_org.mailing_address %]
        [% IF org_addr %]
          <div>[% org_addr.street1 %][% org_addr.street2 %]</div>
          <div>[% org_addr.city %], [% org_addr.state %] [% org_addr.post_code %]</div>
        [% END %]
      </td>
    </tr>
  </table>

  <br/>
<div class="letter font1" >
  <div>[% date.format(date.now, '%B %d, %Y') %]</div>


  <p>
    <div>[% patron.first_given_name %] [% patron.family_name %]</div>
    [% SET usr_addr = patron.mailing_address || patron.billing_address %]
    [% IF usr_addr %]
      <div>[% usr_addr.street1 %]</div>
      <div>[% usr_addr.city %], [% usr_addr.state %] [% usr_addr.post_code %]</div>
    [% END %]
  </p>

  <p>
  Dear Patron,
  <br/>
  <br/>
                                        
  When this item came back to the library, staff found that it was damaged:
  </p>

  <table class = "letter font2">
    <tr>
      <td>Title:</td>
      <td>[% title.substr(0,60)%][% IF title.length > 60 %]...[% END %]</td>
    </tr>
    <tr>
      <td>Barcode:</td>
      <td>[% copy.barcode %]</td>
    </tr>
    <tr>
      <td>Date returned:</td>
      <td>[% date.format(date.now, '%B %d, %Y') %]</td>
    </tr>
    <tr>
      <td>Noted damage:</td>
      <td>[% note %]</td>
    </tr>
    <tr>
      <td style="padding-right: 10px">Cost to repair/replace this item:</td>
      <td>$[% cost %]</td>
    </tr>
    <tr>
      <td>Patron record number:</td>
      <td>[% patron.card.barcode %]</td>
    </tr>
  </table>
  <br/>

  <p>
    We charge patrons for damage that occurs to items they have
    checked out. We will keep this item here at the library for six
    weeks until [% date.manip.UnixDate('in 6 weeks', '%B %d, %Y') %]
    so that you may look at it. After six weeks, we will dispose of
    the item, and the charge will remain on your account. If you have
    questions, please call or stop by the library to talk to library
    staff about the damage.
  </p>

  <p>
	In addition, you may not check out library materials if your account
	balance is over $75; however, we want you to continue to use the
	library. You may still use the apps and databases in the KCLS Online
	Library where you can find eBooks, music, databases, and films.
  </p>

  Find library branch open hours at www.kcls.org.

  Our payment options are:

  <ul>
    <li>Pay in person at any KCLS library</li>
    <li>Online from our website, www.kcls.org</li>
    <li>
      <div>Mail a check payable to King County Library System to:</div>
      <div style="margin-left: 50px">
        <div>Bellevue Library</div>
        <div>1111 110th Avenue NE</div>
        <div>Bellevue WA 98004</div>
      </div>
    </li>
  </ul>
                                      
  <p>
    Thank you for your attention. We look forward to hearing from you.
  </p>

  <div>Sincerely,</div>
  <div>[% dibs %]</div>
  <div>[% staff_org.name %] Library - [% staff_org.phone %]</div>
</div>

$TEMPLATE$
);


END IF; END $INSERT$;                                                          

COMMIT;
