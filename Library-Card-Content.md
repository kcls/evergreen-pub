# Library Card Content — Self-Registration Form Revisions

Source: `/home/berick/Library Card Content.odt` (includes 6 embedded images)
Related branch: `dev/berick/6332897196-self-register-angular-v7`
Code location: `KCLS/patron-ui/src/app/register/`

## Progress

- [x] **1. Graphics/Colors/Fonts** — done, committed `c3db357ad6`
- [x] **2. Your Information page** — done except deferred required-field items (see below); not yet committed
- [x] **3. Eligibility notices copy** — done (fixed Digital copy/punctuation; out-of-service link → kcls.org/cards; others already matched)
- [x] **4. Communication Preferences** — done except deferred sub-items (#9 preferred-method multi-select, #10 double-entry). Renamed step + intro; "Let's stay in touch." (System Messages locked + Library News + Foundation); "Same for text/SMS" checkbox; moved pickup location to Card Options.
- [x] **5. My Library Card** — done except deferred #11 ("different library" delivery option). Renamed step; relabeled holds-pickup question; selectable card tiles w/ artist descriptions; delivery copy ("local branch / by mail"). Auto-suggest of closest hold pickup lib already existed (applyHomeOrgFromAddr).
- [x] **6. Review Application page** — done. Regrouped summary into Your Information / Communication Preferences / Your Library Card, each with an Edit button jumping to its step (via #stepper ref, indices 0/2/3). Top-right "Your new library card" hero is commented out for now; the selected design instead shows enlarged (150px) in the Your Library Card section.
- [ ] 7. `/`'s not auto-populating — **DEFERRED to end**
- [ ] 8. Required-field changes (indicator + revised warning text) — **DEFERRED to end** (per user)
- [ ] 9. 'Preferred method of contact?' multi-select — **DEFERRED to end** (per user)

---

## Graphics/Colors/Fonts  — ✅ DONE (commit c3db357ad6)

Implementation notes:
- Branding scoped to the registration form via a new `.kcls-register` wrapper class
  (other patron-ui features — login, requests — keep the stock theme).
- App uses the prebuilt **indigo-pink** Material theme; its *accent* palette (`#ff4081`)
  is the pink. Overrode accent tokens → `#06436e` for checkboxes, radio buttons,
  focused form-field underline/label/caret, and stepper "pathway step" icon circles
  in `src/styles.scss`.
- Fonts loaded in `src/index.html` plus both generator templates
  (`src/tools/index.html.dist`, `index.html.tt2`) so they survive `create-index`/`revert-index`.
- NOTE: Bebas Neue is uppercase-only (no lowercase glyphs). The follow-up request to
  make headers non-all-caps was dropped for now — revisit if mixed-case headers are wanted.
- Not covered: `mat-select`/datepicker overlay popups render outside `.kcls-register`,
  so any stray pink there would need separate overlay overrides.
- Switch the pink outline everywhere → dark blue `#06436e`
- Update the pathway-step icon circles at top of form → dark blue `#06436e`
- Header font: **Bebas Neue**
- Body font: **Lato**

## Your Information Page
- `/`'s are not auto-populating as the form is filled out
- Remove the "Legal Name" header; lead with an auto-selected checkbox beneath the Last Name field: *"Legal name is the same as above."*
  - If unchecked, show the Legal Name fields. — ✅ DONE (header removed, checkbox text updated; `legalIsSame` already defaulted to checked + reveals legal fields when unchecked)
- First/Last name fields are missing the required indicator — ⏸ DEFERRED to end (task 8)
- Revise the required-field warning, e.g. *"First Name required, as appears on valid ID."* — ⏸ DEFERRED to end (task 8)
- Change "Residential Address" → *"Let us know where you live or own property in King County:"* — ✅ DONE

## Eligibility (notices per card type)
- **All-access eligible:** "Congratulations, you're eligible for an all-access library card! Complete your application to start enjoying all the library has to offer."
- **Digital eligible:** "Congratulations, you're eligible for a digital library card! Complete your application to enjoy instant 24/7 access to our complete digital collection of eBooks, audiobooks, video streaming, and more!"
- **Both eligible:** "Congratulations! You're eligible for both an all-access library card and a digital library card! You have the option to enjoy instant digital access today with a digital library card, or you may choose an all-access library card for full borrowing privileges online and at our library locations. To receive an all-access library card, you must complete the form and choose to pick up your library card at any KCLS location or have it sent by mail."
  - Prompt: *"Which card would you prefer?"* → All-access library card / Digital library card
- **Out of service area:** "This location is not in our service area. Unfortunately, we are unable to provide library card access to this area. Find more information here." → Route to KCLS.org/cards
- **Already has card:** "Whoops! We noticed that you already have a library card on file. Please proceed to the login page to access everything the library has to offer."

## Contact Information Page
- Rename "Contact Information" → **"Communication Preferences"**
- Intro language: *"Please share your communication preferences. This will be your preferred method for staying connected with the library."*
- Fields: Phone Number, Email Address
- *"Preferred method of contact?"* (multi-select): Phone / Email / Text
- *"Let's stay in touch."* (multi-select):
  - System Messages* (auto-selected & locked)
  - Library News and Events
  - KCLS Foundation Information
- Question: do phone/email need to be entered twice, or is once enough? Anything on the back end to avoid double entry?
- Assume the phone # is also the text #; add a checkbox like *"Same for text/SMS"* and bring up an additional field if it's a different number
- Move "Preferred pickup location" to the next page ("Card Options")

## Card Options Page → rename "My Library Card"
- Change section title to **"My Library Card"**
- Add "Preferred pickup location" question → *"What library location would you like to receive your holds?"*
  - Specific to all-access cardholders; library locations as a single-select; auto-suggests closest location based on mailing address
- Change to *"How would you like to receive your All-Access Library Card?"* with answers:
  - Available now: Pickup at my local branch [location] library
  - Available same day: Pickup at a different library — Select library location [they can choose]
  - By mail: Wait 1–2 weeks for my card to be mailed to [insert home address]
- Then show library card designs: *"Select your preferred library card design. You'll receive one wallet-size and one keychain-size card."*
- Use **selectable cards** for the designs instead of bullets. Descriptions to show below each artwork:
  - A portrait of everyday Black life, illustrated by Barry Johnson
  - Salmon rendered in Coast Salish formline art, illustrated by Bethany Fackrell
  - A Pacific Northwest legend brought to life, illustrated by Don Clark
  - An abstract multicultural flow, illustrated by Hernan Paganini
  - Tile patterns inspired by Michoacán, Mexico, illustrated by Marisol Ortega
  - A joyful outdoor gathering of community (and dogs!), illustrated by Stacy Nguyen
  - Folk art wildlife nodding to environmental stewardship, illustrated by Stevie Shao

## Review Application Page
- Have this page better reflect the sections of the application form. With the above edits: "Your Information; Communication Preferences; Your Library Card."
- Share all the information back with the patron that they provided, with an **Edit button** in each section that takes you back to that page to make changes.
- Fill the empty space in the top right with a large version of the card design: *"Your new library card: [image]"*
