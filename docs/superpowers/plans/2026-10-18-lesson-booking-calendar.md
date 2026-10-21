# Lesson Booking Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/bookings` request form with an in-house week-grid booking calendar: Shaun's availability blocks in Directus, visitor-local times, held slots paid via the existing cart + Square, pack credits, account management, ICS feed, email + SMS notifications.

**Architecture:** Pure booking logic (time zones, availability expansion, slot fitting) lives in `src/lib/booking/*` with vitest unit tests. A thin Directus data layer (`src/lib/booking/repo.ts`) and SSR API routes under `src/pages/api/bookings/*` wrap it. Double booking is prevented by a Postgres exclusion constraint on `bookings`. Payment reuses `/api/checkout` + the Square webhook, extended with a post-payment `fulfillPaidOrder`. Notifications are Directus flows that template pre-formatted strings stored on the booking.

**Tech Stack:** Astro 6 SSR (`@astrojs/node`), React 19, Tailwind 4 + shadcn, nanostores, dayjs (+ `utc`, `timezone` plugins, already a dependency), vitest (new dev dep), Directus 12.5 REST + flows on se-cms (Postgres 16), Square Checkout Links API, AWS SNS via `directus-extension-operation-sms-aws-sns` with its ticketing bootstrap disabled (Task 12), later `directus-extension-messaging` for WhatsApp.

**Spec:** `docs/superpowers/specs/2026-10-18-lesson-booking-calendar-design.md` — read it alongside this plan.

## Global Constraints

- Business time zone `Australia/Sydney`; Shaun's blocks are Sydney wall-clock; all stored instants are UTC (`timestamp with time zone`).
- Start times on `:00` / `:30` only (`booking_slot_step_mins` = 30).
- `globals` defaults: `booking_min_notice_hours` 24, `booking_horizon_weeks` 8, `booking_padding_before_mins` 0, `booking_padding_after_mins` 0, `booking_hold_minutes` 15, `booking_slot_step_mins` 30, `booking_cancel_cutoff_hours` 24, `booking_notify_email` `shaun@shaunevans.com`.
- Credits expire `credit_expiry_months` after `paid_at` (default 12).
- Currency is **AUD, GST-inclusive** everywhere; checkout default `AUD`; keep `createOrder`'s 1/11 GST back-calculation.
- Late (< cutoff) changes: no self-service; copy: "Need to change this? Get in touch." + "Shaun reserves the right to charge for a no-show." linking `/contact`.
- Reminders: email 24 h before, always. A phone reminder (SMS now, WhatsApp later) 2 h before goes only to a **verified** `users.phone_e164` (`phone_verified_at` set) with a ledger-backed opt-in. `users.phone` is never messaged. See Task 12.
- Every new React/Astro element gets a contextual class name alongside Tailwind utilities (e.g. `booking-grid-cell ...`). Fonts: existing `font-overpass-mono` / `font-inconsolata`.
- se-cms writes go through the `mcp__se-cms__*` tools or REST with an admin token; raw DDL via `ssh -i ~/.ssh/coolify_hz_localhost_key root@coolify-hz` → `docker exec postgresql-wxinv1oyzrgdrwgupv4tlw2d psql -U $POSTGRES_USER -d directus`. Never touch crf-cms.
- API routes set `export const prerender = false`. Use the `@/*` alias.
- After any Directus flow change, run the `directus-flow-tidy` skill.

## Review Focus

- **DST weeks** (first Sunday of April / October): a weekly "Tue 19:00–21:00" block must stay 19:00 Sydney on both sides of the change; its UTC instant shifts by an hour → test in Task 3.
- **Two students grab the same start concurrently** → exactly one hold succeeds, the other gets 409 → test in Task 5.
- **Square webhook delivered twice / after the order is already `paid`** → booking confirmed once, credits created once → test in Task 8.
- **Hold expired before payment landed and the time was taken meanwhile** → no double booking; order gets `needs_attention` + Shaun is emailed → test in Task 8.
- **Visitor date differs from Sydney date** (Sydney Tue 07:00 = London Mon 21:00) and blocks crossing midnight → grid groups by visitor-local day; overnight block `22:00–01:00` yields starts after midnight → tests in Tasks 3 and 9.

---

## File Structure

```
src/lib/booking/
  time.ts            Sydney wall-clock ↔ UTC, zoned parts (pure)
  availability.ts    AvailabilityRow, rowActiveOn, expandAvailability, interval ops (pure)
  slots.ts           BookingSettings, computeStarts, buildAvailabilityView (pure)
  policy.ts          canSelfManage, whenLabel (pure)
  repo.ts            Directus reads/writes for availability/bookings/credits/settings
  fulfil.ts          fulfillPaidOrder (post-payment)
  ics.ts             renderIcs (pure)
  __tests__/*.test.ts
src/pages/api/bookings/
  availability.ts    GET  — grid data
  hold.ts            POST — create hold (single session)
  [id]/release.ts    POST — release own hold
  credit.ts          POST — book with credit
  [id]/cancel.ts     POST
  [id]/reschedule.ts POST
src/pages/api/account/contact.ts   POST phone + sms_opt_in
src/pages/api/calendar/bookings.ics.ts
src/components/bookings/
  BookingPanel.tsx   lesson/credit selector, tz control, grid, summary bar
  WeekGrid.tsx       presentational grid
  LessonCard.tsx     (modify) per-kind CTA
src/components/account/
  LessonsSection.tsx upcoming/past/credits + cancel/reschedule
src/lib/cart.ts, src/components/shop/CartSheet.tsx   (modify) lesson lines
src/pages/api/checkout.ts, src/lib/orders.ts, src/lib/payments/square.ts, src/pages/api/webhooks/square.ts  (modify)
src/pages/bookings/index.astro, src/pages/account.astro  (modify)
```

---

### Task 1: Land in-flight work

**Files:** working tree on `claude/directus-frontend-wiring` (Footer, Header, BaseLayout, Homepage, homePage.js, directus.ts, index.astro, se-logo-loop.js, cart/sidebar/AuthOverlay/sheet/global.css fixes, bookings LessonCard/BookingForm/lessons.ts, AuthOverlay 6-digit default, CLAUDE.md is gitignored).

- [ ] **Step 1:** `pnpm astro check` → `0 errors`; `pnpm build` → exit 0 and `grep -cE "403|fetch failed"` on the log → `0`.
- [ ] **Step 2:** Commit in logical commits (hero video; header logo + footer; mobile cart/sidebar; lesson price_from/contact mode; OTP 6 digits). `git status -s` → clean except untracked scratch.
- [ ] **Step 3:** `git push`.

### Task 2: Make shop checkout actually reach `paid` (AUD + Square order id + sandbox E2E)

**Files:**
- Modify: `src/lib/payments/square.ts` (createPaymentLink return), `src/pages/api/checkout.ts:31` (currency default), `src/lib/payments/types.ts` (no change to interface)
- Directus: `orders.currency` choices add `AUD`; `lessons.price` note → "Price in AUD, GST incl."
- Test: `src/lib/payments/__tests__/square.test.ts`
- Create: `vitest.config.ts`; `package.json` scripts `"test": "vitest run"`; dev dep `vitest`

**Interfaces:** Produces: `CreatePaymentLinkResult.session_id` = **Square order id** (`payment_link.order_id`), matching `parsePaymentEvent().payment_session_id` (= `payment.order_id`).

- [ ] **Step 1: Write failing test** `square.test.ts`:
  - `createPaymentLink returns payment_link.order_id as session_id` — mock `fetch` to return `{payment_link:{id:"PL1",url:"https://sq/x",order_id:"ORD1"}}` → `expect(res.session_id).toBe("ORD1")`.
  - `parsePaymentEvent maps COMPLETED to paid with order_id` — body `{data:{object:{payment:{id:"P1",order_id:"ORD1",status:"COMPLETED"}}}}` → `{payment_session_id:"ORD1",payment_intent_id:"P1",status:"paid"}`.
  - `verifyWebhookSignature accepts HMAC of url+body` with key `"k"`.
- [ ] **Step 2:** `pnpm test` → first test FAILS (`"PL1"`).
- [ ] **Step 3:** Return `session_id: json.payment_link.order_id` (throw if missing). In checkout default `currency` to `"AUD"`.
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5: Sandbox E2E.** Run `pnpm build && HOST=127.0.0.1 PORT=4410 node dist/server/entry.mjs` with `.env` `SQUARE_ENVIRONMENT=sandbox`; expose it via `tailscale funnel` on a free path/port; create a **temporary** sandbox webhook subscription (Square API `POST /v2/webhooks/subscriptions`, event `payment.updated`) to `<funnel>/api/webhooks/square` and use its signature key; set `PUBLIC_SITE_URL` to the funnel origin for the run. Create a test product order in the cart, pay with Square sandbox card `4111 1111 1111 1111`. Expected: Directus `orders` row → `status=paid`, `payment_intent_id` set. If the webhook 401s, fix signature URL construction (must equal the subscribed notification URL). Delete the temporary subscription afterwards.
- [ ] **Step 6:** Commit `fix(checkout): store Square order id, default AUD; add vitest`.

### Task 3: Time + availability expansion (pure)

**Files:** Create `src/lib/booking/time.ts`, `src/lib/booking/availability.ts`, `src/lib/booking/__tests__/availability.test.ts`

**Interfaces — Produces:**
```ts
// time.ts
export const BOOKING_TZ = "Australia/Sydney";
export function sydneyWallToUtc(dateIso: string, hhmm: string): number; // epoch ms
export function zonedParts(ms: number, tz: string): { date: string; hhmm: string; isoWeekday: number }; // 1=Mon..7=Sun
export function addDaysIso(dateIso: string, n: number): string;
// availability.ts
export type Interval = { start: number; end: number }; // epoch ms, half-open
export type AvailabilityRow = {
  id: string; entry_type: "available" | "unavailable";
  recurrence: "none" | "weekly" | "fortnightly";
  day_of_week: number | null;            // ISO 1=Mon..7=Sun
  start_date: string; end_date: string | null; // YYYY-MM-DD, Sydney dates
  start_time: string; end_time: string;  // "HH:MM" Sydney; end <= start ⇒ ends next day
};
export function rowActiveOn(row: AvailabilityRow, dateIso: string): boolean;
export function mergeIntervals(xs: Interval[]): Interval[];
export function subtractIntervals(from: Interval[], minus: Interval[]): Interval[];
export function expandAvailability(rows: AvailabilityRow[], fromDate: string, toDate: string): Interval[]; // available minus unavailable, merged
```
Port `rowActiveOn` from `/home/shaun/crf-newsched/src/availabilityMatch.ts` (`availabilityActiveOn`): `none` = date within `[start_date, end_date ?? start_date]`; weekly/fortnightly = weekday matches, date within range (open end if null), fortnightly parity = whole weeks since `start_date`'s week is even. Use dayjs `utc` + `timezone` for `sydneyWallToUtc`.

- [ ] **Step 1: Failing tests** (`availability.test.ts`):
  - `weekly Tue 19:00–21:00 AEDT` on `2026-10-20` → `[{start: Date.UTC(2026,9,20,8,0), end: Date.UTC(2026,9,20,10,0)}]`.
  - `same block in AEST` on `2026-06-16` → starts `Date.UTC(2026,5,16,9,0)`.
  - `DST change weeks`: `2026-04-07` (after 5 Apr end of DST) start = `09:00Z`; `2026-10-06` (after 4 Oct start) start = `08:00Z`.
  - `fortnightly parity`: start_date `2026-10-20`, active `2026-11-03`, inactive `2026-10-27`.
  - `unavailable one-off cuts available`: weekly Tue 18–21 minus none 2026-10-20 19:00–20:00 → two intervals 18–19, 20–21 (Sydney).
  - `unavailable date range blocks whole days`: none, start_date `2026-12-24`, end_date `2026-12-28`, 00:00–00:00 → no availability on 25 Dec.
  - `overnight block` weekly Fri 22:00–01:00 on `2026-10-23` → end = Sydney `2026-10-24 01:00`.
  - `end_date null is open-ended`; `end_date in past excludes`.
  - `mergeIntervals` joins touching intervals; `subtractIntervals` handles full/partial/no overlap.
- [ ] **Step 2:** `pnpm test availability` → FAIL (module missing).
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** `pnpm test availability` → PASS.
- [ ] **Step 5:** Commit `feat(booking): availability expansion with Sydney DST handling`.

### Task 4: Slot fitting + view model + policy (pure)

**Files:** Create `src/lib/booking/slots.ts`, `src/lib/booking/policy.ts`, tests `slots.test.ts`, `policy.test.ts`

**Interfaces — Consumes:** Task 3. **Produces:**
```ts
export type BookingSettings = {
  minNoticeHours: number; horizonWeeks: number; paddingBeforeMins: number; paddingAfterMins: number;
  holdMinutes: number; slotStepMins: number; cancelCutoffHours: number; notifyEmail: string;
};
export const DEFAULT_SETTINGS: BookingSettings; // values from Global Constraints
export function padInterval(i: Interval, s: BookingSettings): Interval;
export function computeStarts(free: Interval[], durationMins: number, s: BookingSettings, now: number): number[];
export type AvailabilityView = { blocks: Interval[]; busy: Interval[]; starts: number[] };
export function buildAvailabilityView(args: {
  rows: AvailabilityRow[]; busy: Interval[]; // busy already padded (stored busy_start/busy_end)
  fromDate: string; toDate: string; durationMins: number; settings: BookingSettings; now: number;
}): AvailabilityView;
// policy.ts
export function canSelfManage(startAt: number, now: number, s: BookingSettings): boolean; // start - now >= cutoff
export function whenLabel(startAt: number, endAt: number, visitorTz: string): string;
// e.g. "Wed 22 Oct 2026, 09:00–10:00 (London) · 18:00 Sydney"
```
`computeStarts`: candidate `t` on multiples of `slotStepMins` (UTC minute alignment == Sydney alignment, offsets are whole hours); keep `t` if `[t − padBefore, t + duration + padAfter)` ⊆ some free interval, `t ≥ now + minNotice`, `t ≤ now + horizon`. `blocks` = expanded availability; free = blocks − busy.

- [ ] **Step 1: Failing tests:**
  - 60-min lesson in Sydney 18:00–21:00 block → starts 18:00, 18:30, 19:00, 19:30, 20:00 (Sydney), none at 20:30.
  - lesson ending exactly at block end is allowed; one minute over is not (block 18:00–19:30, 60 min → 18:00, 18:30).
  - busy 19:00–20:00 in block 18–21 → starts 18:00, 20:00 only.
  - padding before=15 after=15: block 18–21, busy none → starts 18:30, 19:00, 19:30 (first needs 17:45 free).
  - min notice: `now` = block start − 23h → no starts; `now` = − 25h → starts present.
  - horizon: block 9 weeks out → no starts.
  - `canSelfManage`: exactly 24h before → true; 23h59m → false.
  - `whenLabel` for `Date.UTC(2026,9,21,8,0)`–`+60m`, tz `Europe/London` → `"Wed 21 Oct 2026, 09:00–10:00 (London) · 19:00 Sydney"`; tz `Australia/Sydney` → no duplicate Sydney suffix.
- [ ] **Step 2:** `pnpm test slots policy` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(booking): slot fitting and cancellation policy`.

### Task 5: Directus schema, constraint, permissions, seed config

**Files:** none in repo except `docs/booking-schema.md` (record of what was created, incl. the DDL).

**Interfaces — Produces (Directus):**
- `availability`: `id` uuid, `status` (published|draft), `entry_type`, `recurrence`, `day_of_week` int (1–7), `start_date` date, `end_date` date nullable, `start_time` time, `end_time` time, `note` text. Display template `{{entry_type}} {{recurrence}} {{start_time}}–{{end_time}}`.
- `bookings`: `id` uuid, `status` (held|confirmed|cancelled|completed|no_show), `user` M2O users, `lesson` M2O lessons, `start_at`/`end_at`/`busy_start`/`busy_end` timestamptz, `hold_expires_at` timestamptz, `source` (purchase|credit), `order` M2O orders, `order_item` M2O order_items, `credit` M2O lesson_credits, `meet_link` string, `student_notes` text, `visitor_timezone` string, `when_label` string, `cancelled_at` timestamptz, `cancel_reason` string, `reminder_email_sent_at`, `reminder_sms_sent_at` timestamptz.
- `lesson_credits`: `id` uuid, `status` (active|expired|void), `user`, `pack` M2O lessons, `lesson` M2O lessons, `order_item` M2O order_items, `credits_total` int, `expires_at` timestamptz.
- `lessons` + `duration_minutes` int, `kind` (single|pack|contact), `credits` int, `credit_lesson` M2O lessons, `credit_expiry_months` int default 12, `requires_phone` bool.
- `globals` + the eight `booking_*` fields with Global Constraints defaults.
- `order_items`: `product` nullable; + `lesson` M2O lessons, `booking` M2O bookings. `orders` + `needs_attention` bool default false.
- `users` + `sms_opt_in` bool default false.

- [ ] **Step 1:** Create the collections/fields/relations above via `mcp__se-cms__collections` / `fields` / `relations`.
- [ ] **Step 2:** DDL (record verbatim in `docs/booking-schema.md`):
  ```sql
  ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (tstzrange(busy_start, busy_end, '[)') WITH &&)
    WHERE (status IN ('held','confirmed'));
  ```
  Verify: inserting two overlapping `confirmed` rows via psql → second fails with `23P01`.
- [ ] **Step 3:** Seed: `lessons` rows → Single (id 1) `kind=single, duration_minutes=60`; Four-Pack (2) `kind=pack, credits=4, credit_lesson=1`; Composition Mentorship (3) `kind=pack, credits=6, credit_lesson=1, requires_phone=true`; In-Person (4) `kind=contact`. `globals` defaults. `orders.currency` must already include AUD (Task 2).
- [ ] **Step 4:** Permissions on the `DIRECTUS_TOKEN` policy ("Production", `9f9decc2-…`): read `availability`; create/read/update `bookings`, `lesson_credits`; create `order_items.lesson/booking`; update `orders.needs_attention,notes`; update `users.phone,sms_opt_in`; read new `globals`/`lessons` fields. Verify with `curl -H "Authorization: Bearer $DIRECTUS_TOKEN"` on each → 200.
- [ ] **Step 5:** Commit `docs(booking): schema record`.

### Task 6: Booking data layer + grid/hold/credit APIs

**Files:** Create `src/lib/booking/repo.ts`, `src/pages/api/bookings/availability.ts`, `hold.ts`, `[id]/release.ts`, `credit.ts`; test `src/lib/booking/__tests__/repo.test.ts` (mock `fetch`).

**Interfaces — Consumes:** Tasks 3–5. **Produces:**
```ts
// repo.ts
export async function getBookingSettings(): Promise<BookingSettings>;      // globals → BookingSettings, fallback DEFAULT_SETTINGS
export async function listAvailabilityRows(): Promise<AvailabilityRow[]>;  // status=published
export async function listBusy(from: number, to: number): Promise<Interval[]>; // confirmed + held with hold_expires_at > now, busy_start/busy_end
export async function expireStaleHolds(): Promise<void>;                   // PATCH held & hold_expires_at < $NOW → cancelled
export type HoldResult = { ok: true; id: string; holdExpiresAt: string } | { ok: false; reason: "conflict" | "not_bookable" };
export async function createBooking(input: {
  userId: number; lessonId: number; startAt: number; durationMins: number; status: "held" | "confirmed";
  source: "purchase" | "credit"; creditId?: string; visitorTz: string; settings: BookingSettings;
}): Promise<HoldResult>;
export async function getActiveCredits(userId: number): Promise<Array<{ id: string; packName: string; lessonId: number; remaining: number; expiresAt: string }>>;
export async function updateBookingStatus(id: string, status: BookingStatus, extra?: Record<string, unknown>): Promise<void>;
```
- `createBooking` flow: `expireStaleHolds()` → re-run `buildAvailabilityView` for that day and require `startAt ∈ starts` (else `not_bookable`) → POST `bookings` with `busy_start/busy_end` = `padInterval`, `when_label` = `whenLabel(...)`, `hold_expires_at` = now + holdMinutes for held → on Directus error whose message contains `bookings_no_overlap` or `23P01` → `conflict`.
- API contracts:
  - `GET /api/bookings/availability?lesson=<slug>&from=YYYY-MM-DD&to=YYYY-MM-DD` → `200 AvailabilityView` (ms numbers); 400 on bad range (> 14 days or outside horizon). No auth. Never returns notes or student data.
  - `POST /api/bookings/hold {lesson_slug, start_at (ISO), visitor_tz}` → auth required (401) → lesson must be `kind=single` → `201 {booking_id, hold_expires_at, when_label, price}` | `409 {error:"slot_taken"}` | `422 {error:"not_bookable"}`.
  - `POST /api/bookings/:id/release` → own `held` booking → `cancelled` → 204.
  - `POST /api/bookings/credit {credit_id, start_at, visitor_tz}` → credit belongs to user, active, unexpired, remaining > 0 → `createBooking(status:"confirmed", source:"credit")` → `201 {booking_id, when_label}` | 409 | 422 | `403` wrong owner.
- [ ] **Step 1: Failing tests** (`repo.test.ts`, mocked Directus): `createBooking returns conflict when Directus rejects with 23P01`; `createBooking returns not_bookable for a start outside availability`; `getActiveCredits subtracts held/confirmed/completed/no_show bookings and hides expired`; `listBusy excludes expired holds`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Concurrency check (live, sandbox data):** seed one available block; fire two `POST /api/bookings/hold` for the same start in parallel (two signed-in sessions) → one 201, one 409.
- [ ] **Step 6:** Commit `feat(booking): data layer and hold/credit APIs`.

### Task 7: Cart + checkout support lesson lines and packs

**Files:** Modify `src/lib/cart.ts`, `src/components/shop/CartSheet.tsx`, `src/pages/api/checkout.ts`, `src/lib/orders.ts`; test `src/lib/__tests__/checkout-lines.test.ts`

**Interfaces — Consumes:** Task 6. **Produces:**
```ts
// cart.ts
export type CartItem = { id: string; slug: string; name: string; price: number; image: string; quantity: number;
  kind?: "product" | "lesson_booking" | "lesson_pack"; bookingId?: string; lessonId?: number;
  whenLabel?: string; holdExpiresAt?: string };
export function addLessonBooking(b: { bookingId: string; lessonId: number; name: string; price: number; whenLabel: string; holdExpiresAt: string }): void; // id = `booking:${bookingId}`, qty 1
// checkout request body
type CheckoutItem = { kind?: "product"; product_id: string; quantity: number }
  | { kind: "lesson_booking"; booking_id: string }
  | { kind: "lesson_pack"; lesson_id: number };
// orders.ts
export type OrderLineInput = { product_id?: string; lesson_id?: number; booking_id?: string; name: string; slug: string; unit_price: number; quantity: number };
export async function resolveCheckoutLines(items: CheckoutItem[], userId: number): Promise<OrderLineInput[]>;
```
Rules: `lesson_booking` → booking must be the user's, `held`, `hold_expires_at > now`, lesson `kind=single` → price from `lessons.price`, qty 1; else 409 `{error:"hold_expired", booking_id}`. `lesson_pack` → lesson `kind=pack`; if `requires_phone` and the user has no `phone` → 400 `{error:"phone_required"}`. Missing `kind` = product (back-compat). After `createOrder`, PATCH each booking with `order` + `order_item`.
CartSheet: lesson lines show `whenLabel`, a live "held for mm:ss" countdown, no qty stepper; remove → `POST /api/bookings/:id/release`; expired → line greys out with "Time released — pick again" linking `/bookings`. Pack lines behave like products (qty locked to 1). `phone_required` → inline phone field posting to `/api/account/contact` then retry.

- [ ] **Step 1: Failing tests:** `resolveCheckoutLines rejects expired hold with hold_expired`; `rejects someone else's booking`; `prices lesson_booking from lessons.price`; `phone_required for mentorship without phone`; `legacy {product_id, quantity} still resolves as product`.
- [ ] **Step 2–4:** FAIL → implement (+ `POST /api/account/contact {phone (E.164), sms_opt_in}` → PATCH `users`) → PASS.
- [ ] **Step 5: Manual:** hold a slot, add to cart, wait past hold (set `booking_hold_minutes`=1 temporarily) → line shows released; checkout of a valid hold redirects to Square sandbox.
- [ ] **Step 6:** Commit `feat(checkout): lesson booking and pack lines`.

### Task 8: Post-payment fulfilment

**Files:** Create `src/lib/booking/fulfil.ts`; modify `src/pages/api/webhooks/square.ts`; test `fulfil.test.ts`

**Interfaces — Consumes:** Tasks 6–7. **Produces:** `export async function fulfillPaidOrder(orderId: string): Promise<{ confirmed: string[]; credits: string[]; attention: string[] }>;`

Behaviour (idempotent — safe to run repeatedly):
- For each `order_items` row with `booking`: `held`/`confirmed` → set `confirmed`, clear `hold_expires_at`. `cancelled` (hold expired) → try to re-occupy (`createBooking` semantics on same start, status `confirmed`, linked to same order_item, old row stays cancelled); on conflict → `orders.needs_attention = true`, append to `orders.notes` `"Booking <id> could not be confirmed: slot taken after hold expired — refund or rebook."`, add to `attention`.
- For each row with `lesson` of `kind=pack` and no existing `lesson_credits` for that `order_item` → create credits (`credits_total = lessons.credits`, `lesson = credit_lesson`, `expires_at = paid_at + credit_expiry_months`). If pack `requires_phone` → email to `booking_notify_email` is sent by the flow in Task 11 (flag via `lesson_credits` create event).
- Webhook: after `markOrderPaid` returns an order (including when already `paid`), call `fulfillPaidOrder(order.id)`; errors → 500 so Square retries.

- [ ] **Step 1: Failing tests:** `confirms held booking`; `running twice creates credits once`; `expired hold with free slot is re-occupied and confirmed`; `expired hold with taken slot sets needs_attention and does not create an overlapping booking`; `webhook calls fulfil when order already paid`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Sandbox E2E** (Task 2 setup): pay for a held single → booking `confirmed`; pay for Four-Pack → `lesson_credits` with 4, expiry +12 months.
- [ ] **Step 6:** Commit `feat(booking): fulfil paid orders`.

### Task 9: Booking page — week grid

**Files:** Create `src/components/bookings/BookingPanel.tsx`, `WeekGrid.tsx`; modify `LessonCard.tsx`, `src/pages/bookings/index.astro`; remove `BookingForm.tsx` usage (delete file if unused); test `src/components/bookings/__tests__/grid-model.test.ts` for a pure `toGridModel` helper.

**Interfaces — Consumes:** `GET /api/bookings/availability`, `POST /api/bookings/hold`, `POST /api/bookings/credit`, `addLessonBooking`, `getActiveCredits` via `GET /api/bookings/credits` (add: auth'd, returns Task 6 shape). **Produces:**
```ts
export function toGridModel(view: AvailabilityView, days: string[] /* visitor-local YYYY-MM-DD */, tz: string, durationMins: number):
  { rows: string[] /* "HH:MM" half-hours with any block */; cells: Record<string /* day|HH:MM */, "available" | "booked" | "unavailable" | "start">; };
```
UI per spec + mockup `.superpowers/brainstorm/1875596-1792224327/content/slot-picker-layouts.html` option A: selector (single lessons + "Use a credit — <pack> (<n> left, expires <date>)" when signed in), tz line `Times in <City> (GMT±h) · change` (default `Intl.DateTimeFormat().resolvedOptions().timeZone`, change = searchable `Intl.supportedValuesOf("timeZone")` select, persisted in localStorage `se:tz`), week nav (bounded by horizon), legend, selecting a `start` cell highlights `durationMins` span, summary bar `whenLabel` + **Add to cart** (single → hold → `addLessonBooking`) or **Book with credit** (→ confirmation state with link to `/account`). Not signed in → open existing `AuthOverlay` first. When signed in, the summary bar also shows an optional mobile field + "Text me lesson reminders" checkbox (prefilled from the user; saved via `POST /api/account/contact` before holding/booking). 409 → toast "Someone just took that time" + refetch. Mobile (< 800px, site's `sm`): 3 visitor-local days, arrows + swipe. LessonCard CTA: single "Pick a time" (scrolls to panel, preselects), pack "Buy pack" (adds `lesson_pack` line), contact "Contact Shaun". Keep a "Not sure which package? Get in touch" link.

- [ ] **Step 1: Failing tests** for `toGridModel`: London tz turns a Sydney Tue 07:00 block into Mon 21:00 cells; busy interval marks `booked`; empty half-hours outside any block are omitted from `rows` when no day has them.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Visual check** with Playwright (`/home/shaun/chordcards/node_modules/playwright/index.mjs`) at 390×844 and 1280×800 against seeded availability: screenshots show legend, tz line, selection span, summary bar; no horizontal overflow (`document.documentElement.scrollWidth === innerWidth`).
- [ ] **Step 6:** Commit `feat(bookings): week grid booking panel`.

### Task 10: Account — lessons, credits, cancel/reschedule, purchases, orders

**Files:** Create `src/components/account/LessonsSection.tsx`, `src/pages/api/bookings/[id]/cancel.ts`, `[id]/reschedule.ts`; modify `src/pages/account.astro`, `src/lib/bookings.ts`; test `cancel.test.ts`

**Interfaces — Consumes:** `canSelfManage`, `createBooking`, `getActiveCredits`. **Produces:**
- `POST /api/bookings/:id/cancel` → owner only (403), `confirmed`, `canSelfManage` (else `409 {error:"too_late"}`) → `cancelled` + `cancelled_at`; if `source=purchase` → create `lesson_credits` (`credits_total 1`, `pack null`, `lesson` = booking lesson, `order_item` = booking's, expiry now + 12 months). Credit bookings free their credit automatically.
- `POST /api/bookings/:id/reschedule {start_at, visitor_tz}` → same checks → `createBooking(confirmed, same source/credit)` first; only on success cancel the old one (reason `rescheduled`) → `201 {booking_id, when_label}`.
- `export async function getBookingsForUser(userId: number): Promise<{ upcoming: BookingView[]; past: BookingView[] }>` (`BookingView = { id; lessonName; startAt; endAt; status; meetLink: string|null; canSelfManage: boolean }`).
Account page sections: **Lessons** (upcoming with Meet link when set, Cancel/Reschedule when `canSelfManage`, else the late-change copy; past; credits remaining + expiry; "Book a lesson" link), **Purchases** (paid `order_items` with `product` — sheet music — name, date, order status), **Orders** (each order with its line items, totals, GST line — existing markup). Contact block: phone + "Text me lesson reminders" toggle → `/api/account/contact`. Legacy `booking_requests` list stays under a collapsed "Earlier requests".

- [ ] **Step 1: Failing tests:** `cancel 25h before a paid single creates a 1-credit row`; `cancel 23h before returns too_late`; `cancel of a credit booking frees the credit (remaining +1)`; `reschedule to a taken time leaves the original booking confirmed`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Visual check of `/account` signed in (OTP test account) at mobile + desktop.
- [ ] **Step 6:** Commit `feat(account): lessons, credits, purchases`.

### Task 11: ICS feed + notification flows

**Files:** Create `src/lib/booking/ics.ts`, `src/pages/api/calendar/bookings.ics.ts`, test `ics.test.ts`; Directus flows (record in `docs/booking-schema.md`).

**Interfaces — Produces:** `export function renderIcs(events: Array<{ uid: string; start: number; end: number; summary: string; description: string; url?: string; transparent?: boolean }>, now: number): string;` (RFC 5545, UTC `Z` times, CRLF, line folding at 75 octets, escaping `,;\` and newlines). Endpoint: `GET /api/calendar/bookings.ics?token=…` — compare to `BOOKINGS_ICS_TOKEN` with `timingSafeEqual`, mismatch/missing → 404; events = confirmed bookings (UID `booking-<id>@shaunevans.com`, summary `<student name> — <lesson>`, description email/notes/meet link/admin URL `https://content.shaunevans.com/admin/content/bookings/<id>`) from −30 days to horizon, plus availability blocks (`Open`, `TRANSP:TRANSPARENT`) unless `&blocks=0`. `Content-Type: text/calendar; charset=utf-8`.

Flows (all on se-cms, emails via the mail operation, bodies use `when_label`):
1. `Booking confirmed` — event `bookings.items.update`/`create` where `status = confirmed` → email student (when_label, lesson, "your Meet link will be emailed", policy copy, `/account` link) + email `booking_notify_email`.
2. `Meet link added` — update where payload has non-empty `meet_link` → email student.
3. `Booking cancelled` — status → `cancelled` and `cancel_reason != hold_expired` → email student + Shaun.
4. `Pack purchased` — `lesson_credits.items.create` → email Shaun; if pack `requires_phone`, include student phone + "add to the Composition Mentorship WhatsApp group".
5. `Booking upkeep` — schedule `0 */15 * * * *`: holds past `hold_expires_at` → `cancelled` (`cancel_reason hold_expired`); `confirmed` with `end_at < $NOW` → `completed`; credits past `expires_at` → `expired`; 24 h reminder email where `start_at <= $NOW(+24 hours)`, `start_at > $NOW`, `reminder_email_sent_at` null → send + set timestamp.

- [ ] **Step 1: Failing tests** (`ics.test.ts`): folds a 100-char description; escapes `;` and `,`; times end with `Z`; output starts `BEGIN:VCALENDAR` ends `END:VCALENDAR\r\n`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Generate `BOOKINGS_ICS_TOKEN` (`openssl rand -hex 24`), set in local `.env` and the site's Coolify env; `curl` feed with/without token → 200 / 404; import URL into a Google Calendar test (Shaun) — note in hand-off.
- [ ] **Step 6:** Build flows 1–5, run `directus-flow-tidy`; trigger each with a sandbox booking and confirm emails arrive (check `admin@pepperhorn.com` via Gmail MCP).
- [ ] **Step 7:** Commit `feat(booking): ICS feed and notification flows`.

### Task 12: Phone reminders (SMS now, WhatsApp later), verified phones only

**This task replaces its first draft. The rewrite was approved by the operator on 2026-10-21.** The first draft had two defects:
1. **It installed the crf bundle on se-cms as-is.** The bundle is `directus-extension-operation-sms-aws-sns`. Its bootstrap hook is in `src/hook/index.ts`, with the schema in `src/hook/ticketing-schema.ts` and the names in `src/constants.ts`. The hook runs on every `app.before`, and nothing turns it off. On se-cms it would:
   - Create `sms_settings`, a singleton with plaintext `aws_*` credential fields.
   - Create `client_ticket` and `client_message`.
   - Create relations, starting with `client_ticket.client → family`. se-cms has no `family` collection, so Directus's `RelationsService.createOne` throws `Collection "family" doesn't exist`. The hook catches the error and logs `SMS extension bootstrap failed`.

   That leaves two orphan collections. Their `client`, `assignee` and `ticket` fields are plain uuid columns with no foreign keys, and the partial unique index is never created. The same error is logged on **every** boot. The bundle also mounts a public `/sms-inbound` endpoint, which reads `family`.
2. **It texted an unverified number.** It sent to `users.phone` whenever `users.sms_opt_in` was set, but nothing ever proved that the number belongs to the client. A typo would text a stranger. That costs money, breaks the GDPR accuracy principle (Art. 5(1)(d)) and tells the stranger about the lesson. The client never gets the reminder.

**Decisions this task follows (2026-10-19 to 2026-10-21):**
- SMS everywhere, and WhatsApp wherever it is available.
- shaunevans.com is its own business. It gets its **own** AWS account and its own WhatsApp Business Account, separate from PepperHorn's.
- Email stays required and is always sent. Phone channels are opt-in.

Two designs are cited below:
- **The messaging design:** pepperhorn-platform `apps/connect/docs/superpowers/specs/2026-10-19-whatsapp-client-messaging-design.md`, the client-messaging design.
- **PR #7:** directus-otp-auth `docs/superpowers/specs/2026-10-19-phone-channel-design.md`, the phone-verification design.

**Channel rules (these replace the reminder line in Global Constraints):**
- The 24 h email reminder from Task 11 always goes out. It is the record.
- The 2 h phone reminder goes only to `users.phone_e164`, and only when **all** of these hold:
  - `users.phone_verified_at IS NOT NULL`;
  - the opt-in flag for that channel is on;
  - the newest `contact_consent` row for that channel is an `opt_in`.
- `users.phone` is never messaged by any flow. It is free text, unverified, and kept only for the Mentorship WhatsApp-group hand-off in Task 11 flow 4.
- WhatsApp is used when the client chose it (`users.preferred_phone_channel = whatsapp`), but only once phase 2 (Step 8) exists. Until then every phone reminder is SMS.
- The server never switches a client to another channel on its own (PR #7 INV-28). A failed send is not retried on another channel, because the email has already gone.

**Phone verification: reminders stay email-only until PR #7's phone channel is live on se-cms.** This task builds no code sender of its own. A client verifies a mobile number only through PR #7's `POST /phone/start` and `POST /phone/confirm`, from `/account`, after re-confirming by email. Confirming writes `phone_e164`, `phone_country`, `phone_verified_at` and `phone_channel`. This is the simplest safe option because:
- It is the only option that adds **no new way to send codes**. A home-grown "text me a code" form would be a target for SMS pumping (fraudulent sends that run up the SMS bill). It would lack PR #7's deny-list, its per-country caps, and its per-IP, per-phone and per-account limits.
- A home-grown form would also pass codes through a Directus flow, which PR #7 INV-26 forbids.
- It writes the same columns PR #7 owns, so nothing needs migrating later.
- Email already carries every reminder, so the wait costs a convenience, not a missed lesson.

Steps 1 and 2 can ship now. Nothing sends a text until Prerequisites A, B and C are all done.

**Prerequisites (none of them are done in this repo):**

- **A. A flag in sms-interface (a separate PR in `/home/shaun/sms-interface`). This is the default path for SMS.**

  Add the env var `SMS_TICKETING_BOOTSTRAP`. It defaults to `true`, so crf-admin behaves exactly as it does now. Acceptance criteria:
  1. When it is `false`, the hook skips `ensureTicketing` entirely: no `client_ticket` or `client_message` collection, no relations and no partial index. It logs one info line, `SMS ticketing bootstrap disabled`.
  2. `sms_settings` is still created, because the operation reads it when the `SMS_AWS_*` env is incomplete.
  3. When it is `false`:
     - `/sms-inbound` answers `404` and never queries `family`;
     - `sms-ticket-reply` and `sms-number-backfill` throw `ticketing disabled` without touching the database.
  4. `true`, unset, and any value other than `false` or `0` keep the current behaviour.
  5. A vitest hook test, with mocked `CollectionsService` and `RelationsService`, asserts:
     - no `createOne` calls for the ticketing payloads when the flag is `false`;
     - the current calls when the flag is unset.
  6. The existing tests pass, and the README documents the flag.

  Why a flag rather than the new bundle: the flag is a small, testable change to a sender that already runs in production. The new `directus-extension-messaging` bundle from the messaging design does not exist yet. That bundle takes collection names from env, has no CRF bootstrap, and its `messaging-send` operation looks up the verified number itself. WhatsApp needs it (phase 2), and it **replaces** the crf bundle on se-cms when it ships.

- **B. PR #7's phone channel, live on se-cms.**
  - directus-otp-auth runs with `OTP_AUTH_CHANNELS` including `sms`.
  - `users` gets four columns: `phone_e164` (E.164 format, unique among verified numbers), `phone_country`, `phone_verified_at` and `phone_channel`.
  - An "Add a mobile" form on `/account` calls `/phone/start` and `/phone/confirm`.

- **C. shaunevans.com's own AWS account (Shaun), in `ap-southeast-2`.**
  - An IAM user whose only permission is `sns:Publish`.
  - The sender ID `ShaunEvans`, registered on ACMA's SMS Sender ID Register through AWS (End User Messaging SMS → Registrations → AU sender ID). Branded sender IDs must be registered since 1 July 2026.
  - If the credentials have not been provided, do Steps 1–2 and stop.

- **D. WhatsApp only (blocks phase 2, but not SMS).**
  - shaunevans.com's own Meta business portfolio and WhatsApp Business Account, set up through AWS End User Messaging Social.
  - **A number of its own.** Today the two businesses share one phone number. A number belongs to exactly one WhatsApp Business Account and must not be on consumer WhatsApp, so shaunevans.com needs its own number before WhatsApp can start.
  - An approved utility template, `lesson_reminder_2h`.
  - The messaging bundle.

**Files:**
- Create: `src/lib/legal/consent-text.ts`, `src/lib/booking/__tests__/contact-consent.test.ts`
- Modify:
  - `src/pages/api/account/contact.ts`
  - `src/lib/auth.ts` (`getUserContact` and `updateUserContact`)
  - `src/components/bookings/BookingPanel.tsx` (the summary-bar phone field and checkbox from Task 9)
  - `src/components/account/LessonsSection.tsx` (the contact block from Task 10)
  - the privacy page
  - `docs/booking-schema.md`
- se-cms: the `contact_consent` collection, `users` fields, the extension, env vars and the reminder flow.

- [ ] **Step 1: Consent schema on se-cms.** Record everything in `docs/booking-schema.md`.
  - Create **`contact_consent`**, append-only. It uses the shape from §3.2 of the messaging design, keyed to `users`:
    - `id`: uuid.
    - `user`: M2O to `users`, SET NULL on delete.
    - `phone_hash`: an HMAC-SHA256 of the E.164 number, keyed with `CONSENT_PHONE_HMAC_KEY`, so an opt-out survives account deletion.
    - `channel`: `sms` or `whatsapp`.
    - `purpose`: `service`.
    - `action`: `opt_in` or `opt_out`.
    - `source`: `account_page`, `booking`, `keyword` or `staff`.
    - `consent_text_version`.
    - `occurred_at`: timestamptz.
  - Add to `users`:
    - `whatsapp_opt_in`: bool, default false;
    - `preferred_phone_channel`: `sms` or `whatsapp`, nullable.
  - Keep `users.sms_opt_in` as the current SMS setting. The messaging bundle reads field names from env, so nothing needs renaming.
  - Grants on the Production policy:
    - **create** on `contact_consent` only, with no read, update or delete;
    - update on `users.sms_opt_in`, `whatsapp_opt_in` and `preferred_phone_channel`.
  - One-time cleanup: `UPDATE users SET sms_opt_in = false WHERE sms_opt_in`. No consent record backs those opt-ins, and no phone is verified yet. Record how many rows changed.
  - Verify: a `PATCH` or `DELETE` on a `contact_consent` row with `$DIRECTUS_TOKEN` returns 403.

- [ ] **Step 2: Opt-in capture (repo, test-first).**
  - **Consent text.** Put it in `consent-text.ts` as `PHONE_REMINDER_CONSENT = { version: "se-phone-reminders-v1", sms: …, whatsapp: … }`. The text sits beside a checkbox that starts **unticked**:
    - SMS: *"Text me a reminder 2 hours before each lesson, at my verified mobile. Sent by Shaun Evans through Amazon Web Services. Turn it off here any time."*
    - WhatsApp, shown only once phase 2 exists: *"Send my lesson reminders on WhatsApp instead. Sent by Shaun Evans through Meta (WhatsApp) and Amazon Web Services. Reply STOP or turn it off here any time."*
  - **`POST /api/account/contact`:**
    - It still saves `phone` as the unverified contact number.
    - `sms_opt_in: true` (or `whatsapp_opt_in: true`) without a `phone_verified_at` returns `409 {error:"phone_unverified"}`.
    - Each change to an opt-in flag first writes **one** `contact_consent` row, then updates the flag. The row records the source (`booking` from the booking panel, `account_page` from `/account`), the current consent text version and `occurred_at`. If nothing changed, no row is written.
    - The `GET` response adds `phone_verified: boolean` and `verified_phone_last3`.
  - **UI:** while the client has no verified mobile, the checkbox is disabled and reads "Verify a mobile in your account to get text reminders", linking to `/account#contact`. Shaun approves the wording.
  - **Privacy page:** add the processor text from §7 of the messaging design, adapted to shaunevans.com:
    - AWS from now on, and Meta once WhatsApp ships;
    - the US named as where data is transferred;
    - how long data is kept.

    Publish it **before** the first opt-in is collected.
  - Write failing tests in `contact-consent.test.ts` (Directus mocked):
    - `opt-in without verified phone → 409 phone_unverified`
    - `opt-in with verified phone writes one ledger row with version and source, then sets the flag`
    - `opt-out writes an opt_out row`
    - `re-saving the same state writes no row`
    - `ledger write failure → 500 and flag unchanged`
  - Run them and see them fail, implement, and see them pass.
  - Commit `feat(account): verified-phone reminder opt-in with consent ledger`.

- [ ] **Step 3: Install the sender (needs A and C).**
  - Build the crf bundle at a commit that includes Prerequisite A: `npm ci && npm run build && npm test`.
  - Copy it into `wxinv1oyzrgdrwgupv4tlw2d_directus-extensions`, the same way the OTP extension was installed.
  - Set the Coolify env:
    - `SMS_TICKETING_BOOTSTRAP=false`
    - `SMS_AWS_REGION=ap-southeast-2`
    - `SMS_AWS_ACCESS_KEY_ID`
    - `SMS_AWS_SECRET_ACCESS_KEY`
    - `SMS_AWS_SNS_SENDER_ID=ShaunEvans`

    Set **all four** `SMS_AWS_*` vars so `sms_settings` is never read. Do **not** set `SMS_AWS_TWO_WAY_NUMBER` or `SMS_AWS_SPRAY_NUMBER`.
  - Restart the **whole service**, because env changed: `mcp__ph-coolify__control`, restart service.
  - Check:
    - the log shows the bundle loaded and `SMS ticketing bootstrap disabled`, and no `bootstrap failed`;
    - compared with a snapshot taken before the install, the only new collection is `sms_settings`;
    - `GET /sms-inbound` returns 404.
  - **Stop condition:** if `client_ticket` or `client_message` appears, remove the extension, drop both collections, restart, and report.

- [ ] **Step 4: Reminder flow (needs B).** Add it to `Booking upkeep`. Turn **off** the flow's activity and log tracking, so phone numbers and message text never reach `directus_activity` or revisions.
  - **Select** `confirmed` bookings where:
    - `start_at <= $NOW(+2 hours)` and `start_at > $NOW`;
    - `reminder_sms_sent_at` is null;
    - `user.phone_verified_at` is not null, and `user.phone_e164` is not null;
    - `user.sms_opt_in = true`;
    - `user.preferred_phone_channel` is null or `sms`, while WhatsApp is not live.
  - **Daily cap.** Read `globals.sms_daily_cap`, a new field with default `20`. Count today's sends (`reminder_sms_sent_at` on or after Sydney midnight). At or over the cap, send nothing and email `booking_notify_email` once that day.
  - **Mark first.** Set `reminder_sms_sent_at` *before* sending, so a retry never texts twice.
  - **Message text.** A Run Script step builds it from `when_label` and converts it to plain SMS characters (GSM-7) so it fits in one message. It replaces `–` with `-` and `·` with `/`, and drops any other unsupported character. The text is: `Your lesson with Shaun starts at <when>. Details or stop texts: shaunevans.com/account`. The bundle appends `\n\n(do not reply)`. Check that the total is 160 characters or fewer; if it is longer, shorten `<when>` to the client's local time only.
  - **Send** with the SMS operation to `user.phone_e164`, type `Transactional`.
  - Run `directus-flow-tidy`.
  - **STOP:** a named sender like `ShaunEvans` cannot receive replies, so SMS cannot offer "Reply STOP". The way to opt out is the toggle on `/account`, which every text names. Turning it off writes an `opt_out` row and takes effect on the next run. Replying STOP or START arrives with the messaging bundle in phase 2.

- [ ] **Step 5: Test in the SNS sandbox.**
  - Add Shaun's number to the SNS sandbox destination list.
  - On a test account, verify that number through PR #7's `/phone/start` and `/phone/confirm`, and opt in.
  - Turn on SNS delivery-status logging.
  - Book a test lesson 2 h ahead. Expected:
    - the SMS arrives from `ShaunEvans`;
    - it is one message part (`numberOfMessageParts = 1` in the delivery log);
    - `reminder_sms_sent_at` is set.
  - Each of these must send no SMS and make no SNS call:
    - a second account that has opted in but has `phone_verified_at` cleared;
    - an account that has opted out;
    - a run with the cap set to `0`.

- [ ] **Step 6: Go-live controls (Shaun in the AWS console; Claude checks each one).**
  - The ACMA sender-ID registration from Prerequisite C is **approved**. Do not leave the sandbox before then, because an unregistered ID is shown as "Unverified" or blocked.
  - SMS production access has been requested.
  - The account's SMS spend limit (`MonthlySpendLimit`) is raised from the sandbox's US$1 to a small fixed amount, e.g. US$10, not unlimited.
  - A CloudWatch alarm on `AWS/SNS SMSMonthToDateSpentUSD` fires at 80% of the limit and emails `shaun@shaunevans.com`.
  - `globals.sms_daily_cap` is set (the daily cap).
  - Any country beyond Australia needs its own sender registration before numbers there are enabled.

- [ ] **Step 7: GDPR record.** Write it in `docs/booking-schema.md`:
  - **Lawful basis.** The reminder serves the lesson the client booked (Art. 6(1)(b)), and the phone channel is used only after the client opts in. The consent ledger meets the Art. 7(1) standard, so the record still holds if the opt-in is treated as consent.
  - **Processors.**
    - AWS, under the AWS DPA in its Service Terms, from now on.
    - Meta, under the WhatsApp Business Data Processing Terms, from phase 2.
    - Transfers to the US rely on the EU–US Data Privacy Framework, with standard contractual clauses as a fallback. Add a note for Australian Privacy Principle 8.
  - **Retention.** The consent ledger is kept for the life of the account plus 6 years. After that only `phone_hash` and the opt-out remain. No message text is stored.
  - **Erasure** clears `phone_e164` and `phone`, and keeps the opt-out hash.

- [ ] **Step 8: WhatsApp, phase 2 (blocked on D).**
  - Install `directus-extension-messaging`. Its env names `users`, `phone_e164`, `phone_verified_at`, `whatsapp_opt_in` and `preferred_phone_channel`.
  - Replace the Step 4 send with `messaging-send`, passing `template_key lesson_reminder_2h`, `account` and the variables, and **no phone number**.
  - Turn on the WhatsApp consent text.
  - Turn on replying STOP and START on both channels, through `/messaging/inbound`.
  - Remove the crf bundle and drop `sms_settings` (a whole-service restart).
  - Optionally move SMS to the same long code (a full phone number), so replies can come back.

- [ ] **Step 9:** Commit `docs(booking): phone reminders record`. Push.

### Task 13: Docs + final verification

**Files:** Modify `CLAUDE.md` (gitignored locally — update anyway), `docs/booking-schema.md`.

- [ ] **Step 1:** CLAUDE.md: replace "Booking flow (lessons)" with the new flow, code map (`src/lib/booking/*`, APIs), new env `BOOKINGS_ICS_TOKEN`, new permissions, fix stale lines ("Checkout endpoint is stubbed", "No `orders` collection exists yet", "Tax is hardcoded to 0"), and the Square session-id fix.
- [ ] **Step 2:** `pnpm test` → all pass; `pnpm astro check` → 0 errors; `pnpm build` → exit 0, no 403s.
- [ ] **Step 3:** Full sandbox walk-through: guest → pick time → sign in → cart → Square sandbox → confirmed → emails → appears in ICS → cancel from `/account` (≥24h) → credit created → rebook with credit.
- [ ] **Step 4:** Commit + push; update PR #2 description (or open a new PR off this branch if #2 merged) and link it via `mcp__t3-code__link_pull_request`.
