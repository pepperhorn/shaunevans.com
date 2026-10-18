# Lesson booking calendar — design

Date: 2026-10-18 · Site: shaunevans.com (Astro 6 SSR + React 19 + Tailwind 4 + shadcn) · CMS: se-cms (Directus 12.5, `https://content.shaunevans.com`)

## Intent

Shaun teaches online lessons (coaching, composition mentorship) to students in many time zones. Today `/bookings` is a request form: the student describes what they want, Shaun emails back proposed times. That is slow and manual.

Replace it with an in-house booking calendar:

- Shaun advertises **blocks of availability** in Directus (regular and irregular).
- Students see a **week grid** of when Shaun is available vs unavailable, in **their own time zone**, pick a start time, and book.
- Single sessions are paid through the **existing cart + Square checkout**. Multi-session packs are bought as **credits** and booked one at a time later.
- Shaun sees bookings in **Google Calendar** via a subscribed ICS feed.

Why in-house rather than Cal.com: the site already has a cart, OTP sign-in, `users`, `orders` and Square; bundle/credit logic and the student's account view should live alongside shop purchases, not in a third-party tool.

## Goals

1. Shaun can publish availability as one-off and recurring blocks, and carve out unavailable time, entirely in Directus.
2. A visitor can see availability for a chosen lesson type and book a time that fits, in their local time zone, with AEST shown alongside.
3. No double bookings, including two people trying to grab the same time at once.
4. Single sessions: pick time → cart → Square → confirmed booking. Packs: buy credits → book sessions with credits, no payment step.
5. Students manage lessons from `/account` (upcoming, past, credits, cancel/reschedule within policy).
6. Shaun gets an ICS feed for Google Calendar, plus email notices.
7. Students get confirmation and reminder notifications (email; SMS if opted in).

## Non-goals (this spec)

- Automatic Google Meet creation via the Google Calendar API — **phase 2**. Phase 1: Shaun pastes a Meet link onto the booking.
- Two-way Google Calendar sync (reading Shaun's busy times from Google). Availability comes only from Directus.
- In-person bookings. The In-Person Intensive stays `booking_mode = contact` ("Contact Shaun").
- Automated refunds. Refunds are done manually in Square.
- Licensed sheet-music / ph-connect integration (recorded separately; not part of this work).
- Multiple teachers. There is one teacher (Shaun).

## Anti-goals (would make this a failure even if it "works")

- A student is shown a time that turns out to be taken, or two students end up booked into overlapping times.
- Times shown in the wrong zone, or AEST/AEDT daylight-saving shifts silently moving Shaun's blocks.
- A credit or payment lost without a record Shaun can see and fix in Directus.
- Shaun needing a developer to change booking rules (notice period, horizon, padding).

## Decisions already made (by Shaun)

**Availability**
- Shaun enters **blocks** of availability, not fixed slots. The system works out which start times fit the selected lesson's duration inside a block.
- Must support both **regular** (repeating) and **irregular** (one-off) availability, plus unavailable time. Plan for maximum flexibility: one-off and repeating.
- Shaun works in **AEST** (Sydney). Visitors see times in their **detected local time zone**. Shaun will choose blocks that suit all regions.

**Booking rules**
- Start times on the **hour and half hour only** (minimises wasted block time).
- **No gap** between lessons by default (back-to-back allowed).
- Add **lesson padding before and after, in minutes, as settings in `globals`**, both **0** for now. Rules must be revisable later without code changes.
- Minimum notice: **24 hours**. Booking horizon: **8 weeks** ahead. (Also `globals` settings.)

**Holds & payment**
- A chosen time is **held during checkout** and released if payment doesn't complete.
- Payment uses the **existing Square checkout** used by the shop.

**Packs / credits**
- A pack (e.g. Four-Pack) = **N credits**. Students book one session at a time and a credit is deducted per lesson.
- Credits **expire 12 months** after purchase.

**Cancellation policy**
- ≥ 24 h before: student can cancel or reschedule themselves; credit returned (single session → becomes a credit; no automatic money refund).
- < 24 h before: student is offered to **get in touch**; the site states **Shaun reserves the right to charge for a no-show**. Late cancels / no-shows consume the credit; Shaun can manually return it in Directus.

**UI**
- Slot picker is a **week grid** (option A from the mockups): days as columns, Shaun's available blocks white, booked grey, unavailable hatched; tap a start time inside a block; summary bar shows visitor-local time with AEST beneath, then Add to cart / Book with credit.

**Lesson link**
- Phase 1: a `meet_link` field on the booking that Shaun fills in; the student is emailed when it's set. Phase 2: Google Calendar API creates the event + Meet and invites the student.

**Notifications**
- Student: confirmation on booking; **email reminder 24 h before**; **SMS reminder 2 h before** for students who opted in.
- Shaun: notice on each new booking / cancellation.
- SMS via the existing `directus-extension-operation-sms-aws-sns` (source `~/sms-interface/directus-extension-operation-sms-aws-sns`, currently installed only on crf-admin) — to be installed on se-cms with AWS SNS set up.

**Account page** (`/account`) shows: lessons (upcoming/past, credits + expiry, cancel/reschedule), **purchases** (sheet music bought), and **orders with their line items**.

## Current state (what exists)

- `lessons` collection (int id): `name, slug, price ("Price in USD" note), duration (free text e.g. "4 × 60 min"), format, tagline, description, includes, popular, price_from, currency, booking_mode (book|contact)`. Rows today: Single Coaching Session (60 min, $90), Four-Pack (4 × 60, $320), Composition Mentorship (currently says 6 × 75; correct is 6 × 60 — see Open questions), In-Person Intensive (contact, from $400).
- `booking_requests` collection + `src/components/bookings/BookingForm.tsx` (browser POSTs straight to Directus) + `LessonCard.tsx` on `src/pages/bookings/index.astro`.
- Cart: `src/lib/cart.ts` — nanostores persisted in localStorage `se:cart`; `CartItem = {id, slug, name, price, image, quantity}`; products only.
- Checkout: `src/pages/api/checkout.ts` — requires OTP session; resolves items via `getProduct`; `createOrder` → `orders` + `order_items` (`order_items.product` is an M2O to `products`, uuid); `SquareProvider.createPaymentLink` (Checkout Links API); redirect to `/shop/orders/<id>/confirmation`.
- Webhook: `src/pages/api/webhooks/square.ts` — verifies signature, on `paid` calls `markOrderPaid(payment_session_id, payment_intent_id)`. Square webhook subscriptions exist (sandbox + production) but the handler is only on the unmerged branch (live URL 404s), and checkout → webhook has **not** been tested end-to-end in sandbox.
- Auth: OTP via the `directus-otp-auth` extension; `users` collection (int id, has `phone`). Session user `{id, email, name}`.
- `orders.currency` choices are GBP/USD/EUR; checkout defaults to GBP; `products.price` is noted "AUD"; `lessons.price` is noted "USD". **Currency is inconsistent today** (see Open questions).
- Reusable prior art in `/home/shaun/crf-newsched` and `/home/shaun/crf-staff` (CRF staff scheduling — not a public booking system):
  - `crf-newsched/src/availabilityMatch.ts` — `availabilityActiveOn(row, date)` (date-range + weekly/fortnightly parity), `dayMatches`, `hhmmToMins`. Pure; port it.
  - `crf-newsched/src/conflictCheck.ts` — interval overlap (`a.start < b.end && a.end > b.start`). Pure; port the overlap core.
  - `crf-staff/src/pages/api/calendar/ical.ts` — hand-rolled ICS with per-user secret token. Port the structure (or use `ical-generator`).
  - `crf-staff/src/lib/nonce.ts` — single-use, short-TTL tokens for email action links.
  - Note: CRF stores naive Sydney times; its conflict guard is check-then-write (racy). Don't copy those two aspects.

## Design

### Data model (se-cms)

**`availability`** (new) — Shaun's blocks. Modelled on CRF `staff_availability`:
- `entry_type`: `available` | `unavailable`
- `recurrence`: `none` | `weekly` | `fortnightly`
- `day_of_week` (for recurring)
- `start_date` (date) and optional `end_date` (date; empty = open-ended). For `none`, the single date (or a date range for multi-day unavailability).
- `start_time`, `end_time` (time of day, **Australia/Sydney wall-clock**)
- `note` (private)
- `status` (published/draft) so Shaun can stage changes.
- Unavailable entries override available ones. Fortnightly parity counts weeks from `start_date`.

**`bookings`** (new):
- `user` (M2O `users`), `lesson` (M2O `lessons`)
- `start_at`, `end_at` — **UTC instants** (timestamp with tz)
- `status`: `held` | `confirmed` | `cancelled` | `completed` | `no_show`
- `hold_expires_at` (for `held`)
- `source`: `purchase` (paid single) | `credit`
- `order` / `order_item` (M2O, for paid singles), `credit` (M2O `lesson_credits`, for credit bookings)
- `meet_link`, `student_notes`, `visitor_timezone` (IANA, as booked), `cancelled_at`, `cancel_reason`
- `reminder_email_sent_at`, `reminder_sms_sent_at`

**`lesson_credits`** (new) — one row per purchased pack (or per converted cancelled single):
- `user`, `pack` (M2O `lessons`, the pack bought), `lesson` (the lesson type the credits book — the pack's `credit_lesson`), `order_item`
- `credits_total`, `expires_at` (paid_at + the pack's `credit_expiry_months`, default 12)
- `status`: `active` | `expired` | `void`
- Credits remaining = `credits_total` − bookings against it in `held|confirmed|completed|no_show` (+ manual returns: a returned booking is `cancelled`, so it frees the credit). Shaun "returns" a credit by setting a late-cancelled/no-show booking to `cancelled` in Directus.

**`lessons`** (extend): add `duration_minutes` (int, used for fitting), `kind`: `single` | `pack` | `contact`, and for packs `credits` (int), `credit_lesson` (M2O `lessons` — which single lesson type a credit books) and `credit_expiry_months` (int, default 12). Both packs (Four-Pack, Composition Mentorship) point at the 60-minute Single Coaching Session type. Existing free-text `duration` stays for display.

**`globals`** (extend): `booking_min_notice_hours` (24), `booking_horizon_weeks` (8), `booking_padding_before_mins` (0), `booking_padding_after_mins` (0), `booking_hold_minutes` (15 — builder's default, my call), `booking_slot_step_mins` (30). Also `booking_timezone` = `Australia/Sydney`.

**`order_items`** (extend): add optional `lesson` (M2O `lessons`) and `booking` (M2O `bookings`) so a line can be a lesson rather than a product. `product` becomes optional.

**`users`**: use existing `phone`; add `sms_opt_in` (bool).

**Double-booking guard (required):** enforce at the database, not by check-then-write. Recommended: a Postgres exclusion constraint on `bookings` over `tstzrange(start_at - padding_before, end_at + padding_after)` `WITH &&`, filtered to `status IN ('held','confirmed')` with unexpired holds (expired holds must be flipped to `cancelled` or excluded — see Holds). If an exclusion constraint is impractical through Directus, use the CRF tasks pattern: insert, re-query overlaps ordered by `(date_created, id)`, keep the earliest, delete the loser and return 409. Builder decides which; the guarantee is what matters.

### Slot generation (server)

`GET /api/bookings/availability?lesson=<slug>&from=<date>&to=<date>` (SSR, `prerender = false`) returns, for the date range:
- `blocks`: available intervals (UTC) after subtracting unavailable entries — for painting the grid white/hatched.
- `busy`: confirmed bookings + unexpired holds (UTC), with padding applied — painted grey, no student details.
- `starts`: bookable start instants for the requested lesson.

Algorithm:
1. Expand `availability` rows for each date in range in **Australia/Sydney** (wall-clock → UTC with the correct AEST/AEDT offset for that date). Port `availabilityActiveOn` for recurrence.
2. Subtract unavailable intervals from available ones.
3. Subtract busy intervals (bookings `held` with `hold_expires_at > now` and `confirmed`), each expanded by padding before/after.
4. Candidate starts = every `:00`/`:30` (slot step from globals, aligned to Sydney wall-clock) where `[start, start + duration_minutes)` plus padding fits entirely inside a remaining free interval.
5. Drop starts earlier than now + min notice, or later than now + horizon.

The client never decides availability; booking endpoints re-run the same check server-side.

### Time zones

- Shaun's blocks are Sydney wall-clock; a "Tue 19:00" weekly block stays 19:00 Sydney through DST (visitors abroad see it shift).
- All instants stored/transmitted in UTC.
- Visitor zone from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`), with a "change" control. Builder's call; the site isn't behind Cloudflare, so CF geo headers aren't available.
- Every displayed time shows the visitor zone; the summary bar and emails also show AEST/AEDT ("= 18:00 Sydney").

### Booking flows

**Single session (paid)**
1. Student picks the lesson + a start on the grid → **Add to cart**.
2. Server creates a `bookings` row `status=held`, `hold_expires_at = now + hold minutes`. Requires sign-in (OTP) — if not signed in, open the existing `AuthOverlay` first. On conflict → 409, refresh grid.
3. Cart item carries the booking id (cart line type "lesson booking", qty fixed at 1, shows time + countdown). Checkout (`/api/checkout`) accepts lesson lines: re-validates the hold is still valid and owned by the user, creates the `order_item` with `lesson` + `booking`, links booking ↔ order_item. If the hold expired at checkout time, reject that line and ask the student to re-pick.
4. Square paid webhook → `markOrderPaid` → for each lesson line, flip its booking `held → confirmed` (idempotent). If the hold had expired before payment landed but the time is still free, confirm it; if the time was taken in between, mark the order for Shaun's attention (refund/rebook manually) — builder must make this visible in Directus (e.g. order note + notification).
5. Unpaid holds expire (scheduled flow sets `held → cancelled` after `hold_expires_at`, or treat expired holds as free at read time — both is safest).

**Pack purchase**
1. Pack is added to cart like a product (no time picked). Checkout creates an `order_item` with `lesson` = the pack.
2. On paid webhook → create `lesson_credits` (`credits_total` from `lessons.credits`, `expires_at` = paid_at + `credit_expiry_months`). Idempotent per order_item. For Composition Mentorship, also email Shaun the student's name/email/phone so he can add them to the private WhatsApp group (phone collected at checkout for this package).

**Booking with a credit**
1. Grid's lesson selector shows "Use a credit — Four-Pack (3 left, expires 18 Oct 2027)" when the signed-in student has active credits.
2. Pick a start → **Book with credit** → server creates `bookings` `status=confirmed`, `source=credit`, `credit` = the oldest-expiring active credit row with remaining > 0 that matches the lesson type. Same overlap guard. No cart/payment.

**Cancel / reschedule (student, from `/account`)**
- ≥ 24 h before start: Cancel → booking `cancelled`. Paid single → create a 1-credit `lesson_credits` row (12-month expiry) for that lesson type. Credit booking → credit is freed automatically. Reschedule = pick a new start in the grid for that booking (atomic: new time must pass the overlap guard before the old one is released).
- < 24 h: no buttons; show "Need to change this? Get in touch" (link to `/contact`) and the no-show note.

**Credits consumed**: a booking counts against the credit from the moment it's booked; it stays counted when it becomes `completed` or `no_show`. Shaun marks `no_show` / returns credits in Directus. Builder's call whether `completed` is set automatically after `end_at` (recommended: scheduled flow).

### Pages & UI

- **`/bookings`**: package cards (existing `LessonCard`, updated: single → "Pick a time", pack → "Buy pack", contact → "Contact Shaun") + the **week grid** booking panel. Replaces `BookingForm` (keep a "Not sure which package? Get in touch" link). Week grid per the mockup (`.superpowers/brainstorm/*/content/slot-picker-layouts.html`, option A): week nav, zone line ("Times in London (GMT+1) · change"), legend (available / booked / unavailable), selection highlights the full lesson span, summary bar with local + Sydney time and the action button. **Mobile: 3-day window, swipe/arrow between** (my call).
- **Cart**: lesson booking lines show date/time (visitor zone) and hold countdown; qty not editable; removing the line releases the hold.
- **`/account`**: sections **Lessons** (upcoming with Meet link when set + cancel/reschedule per policy; past; credits remaining + expiry), **Purchases** (sheet music bought, with status), **Orders** (each with its line items). Phone + SMS opt-in editable here and at booking.
- Existing class-name convention applies (contextual class names alongside Tailwind utilities); typography = site fonts (Overpass Mono / Inconsolata), not Poppins.

### Calendar feed

- `GET /api/calendar/bookings.ics?token=<secret>` — secret from env (`BOOKINGS_ICS_TOKEN`), constant-time compare, 404 on mismatch.
- Includes **confirmed bookings** (summary: student name + lesson; description: email, notes, Meet link, Directus admin link) and **availability blocks** as separate "Open" events so Shaun can see gaps (Shaun's guess-confirmed preference: both — builder may put blocks behind `&blocks=1` if it clutters).
- Window: past 30 days to horizon. Stable `UID` per booking so Google updates rather than duplicates. Port structure from `crf-staff/src/pages/api/calendar/ical.ts` (with real tz handling), or use `ical-generator`.

### Notifications

Implemented as Directus flows (preferred, consistent with existing form-notification flow) or site-side — builder's call; email via Directus `MailService`/SMTP (se-cms SMTP is on port 587).
- On booking confirmed: email student (time in their booked zone + Sydney, lesson, how the link will arrive, cancellation policy, link to `/account`) and email Shaun.
- On `meet_link` set/changed: email student.
- On cancel/reschedule: email student + Shaun.
- Reminder email 24 h before; reminder SMS 2 h before if `users.sms_opt_in` and `phone` set. Scheduled flow every ~15 min; idempotent via `reminder_*_sent_at`.
- SMS setup: install `directus-extension-operation-sms-aws-sns` on se-cms (same deploy method as the OTP extension: extensions volume + restart), configure via `SMS_AWS_*` env in Coolify (not the settings collection), dedicated IAM user with `sns:Publish` only, alphanumeric sender ID (e.g. "ShaunEvans" — AU supports it). New SNS accounts are sandboxed (verified numbers only, US$1/month cap) until production access is requested — Shaun to request.

### Permissions (se-cms)

`DIRECTUS_TOKEN` role gains: read `availability`; create/read/update `bookings`, `lesson_credits`; update `order_items` link fields; read new `globals` fields. Public role: none (availability is served via the site API, which strips private notes and student details).

## Constraints

- se-cms is Directus 12.5 on Postgres 16 (raw DDL possible via host access, as done for the OTP tables).
- Square: Checkout Links API; webhook `payment.updated`; signature verified against `PUBLIC_SITE_URL`. Must be exercised end-to-end in **sandbox** before this work relies on it.
- No automated test suite exists in the repo; slot generation, overlap, DST and credit accounting are pure logic and should get unit tests (builder may add vitest).
- Site sessions are filesystem-backed and reset on redeploy (known gap).

## Left to the builder

- Exact Directus field types/interfaces, collection display templates, and admin UX (e.g. a calendar layout for `bookings`/`availability` in Directus).
- Exclusion constraint vs insert-then-verify for the overlap guard.
- Whether expired holds are cleaned by a scheduled flow, filtered at read time, or both (both recommended).
- Flows vs site-side code for notifications and the `completed` status.
- Libraries: date/tz handling (e.g. `date-fns-tz` or `Temporal` polyfill), ICS generation.
- Hold length default (15 min, in `globals`).
- Mobile grid interaction details (3-day window).

## Sequencing (my call)

1. Land the current uncommitted work on `claude/directus-frontend-wiring` (cart/AuthOverlay/sidebar fixes, hero video, bookings copy, header logo, footer) and build on that branch — not `main` — because this work touches the same files.
2. First plan task: run the shop checkout → Square **sandbox** → webhook → order `paid` path end-to-end with the sandbox credentials already in `.env` (via a tunnel or a deployed preview so Square can reach the webhook). Booking work starts only once that passes.

## Notes from builder check

- `createOrder` (`src/lib/orders.ts`) already treats all prices as **AUD-style 10% GST-inclusive** and back-calculates `tax` (commit `bf9004c`); CLAUDE.md's "tax is hardcoded to 0" is stale.

## Open questions (Shaun to answer before planning)

1. ~~Currency & GST~~ — **Answered (Shaun): AUD for everything, GST-inclusive.** Lesson and product prices are AUD incl. 10% GST (existing `createOrder` back-calculation stays). Builder: add `AUD` to `orders.currency` choices and make it the checkout default (replace the GBP default); fix the `lessons.price` note ("Price in USD" → AUD incl. GST); ensure the Square location/currency is AUD; display prices as A$ where a symbol is shown. Existing lesson prices ($90/$320/$540/$400) are taken as AUD.
2. ~~Composition Mentorship mapping~~ — **Answered (Shaun):** Composition Mentorship is **6 × 60 min** sessions, plus an **online connection over 3 months via a private WhatsApp group**, in **AEST business hours**. So:
   - It's a `kind = pack` with `credits = 6`, `credit_lesson` = a 60-minute session type. No 75-minute lessons exist; the grid only ever fits 60-minute sessions for now (the fitting logic stays duration-driven so other lengths work later).
   - The WhatsApp group is set up by Shaun manually: on Mentorship purchase, notify Shaun (email) with the student's name, email and phone; the purchase flow must collect a mobile number for this package (reuse `users.phone`).
   - "AEST business hours" describes the WhatsApp support window — display it in the package copy. _(My reading; if it also means Mentorship sessions may only be booked in business hours, add a per-package allowed-hours rule.)_
   - Credit expiry: per-package `credit_expiry_months` on `lessons` (default 12 per Shaun's rule). _(My call: the field exists so Shaun can set Mentorship to 3 if the 3-month window should bound its sessions; it defaults to 12.)_
   - Content updates for the `lessons` row (duration text "6 × 60 min", description/includes mentioning the 3-month WhatsApp group in AEST business hours) are copy edits Shaun approves separately.
