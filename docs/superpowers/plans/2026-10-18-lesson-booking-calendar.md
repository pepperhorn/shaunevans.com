# Lesson Booking Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/bookings` request form with an in-house week-grid booking calendar: Shaun's availability blocks in Directus, visitor-local times, held slots paid via the existing cart + Square, pack credits, account management, ICS feed, email + SMS notifications.

**Architecture:** Pure booking logic (time zones, availability expansion, slot fitting) lives in `src/lib/booking/*` with vitest unit tests. A thin Directus data layer (`src/lib/booking/repo.ts`) and SSR API routes under `src/pages/api/bookings/*` wrap it. Double booking is prevented by a Postgres exclusion constraint on `bookings`. Payment reuses `/api/checkout` + the Square webhook, extended with a post-payment `fulfillPaidOrder`. Notifications are Directus flows that template pre-formatted strings stored on the booking.

**Tech Stack:** Astro 6 SSR (`@astrojs/node`), React 19, Tailwind 4 + shadcn, nanostores, dayjs (+ `utc`, `timezone` plugins, already a dependency), vitest (new dev dep), Directus 12.5 REST + flows on se-cms (Postgres 16), Square Checkout Links API, AWS SNS via `directus-extension-operation-sms-aws-sns`.

**Spec:** `docs/superpowers/specs/2026-10-18-lesson-booking-calendar-design.md` — read it alongside this plan.

## Global Constraints

- Business time zone `Australia/Sydney`; Shaun's blocks are Sydney wall-clock; all stored instants are UTC (`timestamp with time zone`).
- Start times on `:00` / `:30` only (`booking_slot_step_mins` = 30).
- `globals` defaults: `booking_min_notice_hours` 24, `booking_horizon_weeks` 8, `booking_padding_before_mins` 0, `booking_padding_after_mins` 0, `booking_hold_minutes` 15, `booking_slot_step_mins` 30, `booking_cancel_cutoff_hours` 24, `booking_notify_email` `shaun@shaunevans.com`.
- Credits expire `credit_expiry_months` after `paid_at` (default 12).
- Currency is **AUD, GST-inclusive** everywhere; checkout default `AUD`; keep `createOrder`'s 1/11 GST back-calculation.
- Late (< cutoff) changes: no self-service; copy: "Need to change this? Get in touch." + "Shaun reserves the right to charge for a no-show." linking `/contact`.
- Reminders: email 24 h before; SMS 2 h before only if `users.sms_opt_in` and `users.phone`.
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

### Task 12: SMS reminders (AWS SNS)

**Prerequisite (Shaun):** AWS IAM access key for a dedicated user with only `sns:Publish`, region (e.g. `ap-southeast-2`). If not provided, stop after Step 1 and report.

**Files:** none in repo; se-cms extension + env + flow (record in `docs/booking-schema.md`).

- [ ] **Step 1:** Build `/home/shaun/sms-interface/directus-extension-operation-sms-aws-sns` (`npm ci && npm run build && npm test`) → tests pass.
- [ ] **Step 2:** Install into se-cms extensions volume (same method as the OTP extension: copy into `wxinv1oyzrgdrwgupv4tlw2d_directus-extensions`), set Coolify env `SMS_AWS_REGION`, `SMS_AWS_ACCESS_KEY_ID`, `SMS_AWS_SECRET_ACCESS_KEY`, `SMS_AWS_SNS_SENDER_ID=ShaunEvans`; full service restart (`mcp__ph-coolify__control` restart service). Log shows the extension loaded.
- [ ] **Step 3:** Add to `Booking upkeep` flow: confirmed bookings with `start_at <= $NOW(+2 hours)`, `> $NOW`, `reminder_sms_sent_at` null, user `sms_opt_in` and `phone` set → Send SMS (`Transactional`, body `"Reminder: your lesson with Shaun is at <when_label>. Details: shaunevans.com/account"`) → set `reminder_sms_sent_at`. Run `directus-flow-tidy`.
- [ ] **Step 4:** SNS sandbox: verify Shaun's number in the SNS console; book a test lesson 2h ahead → SMS received. Remind Shaun to request SNS production access + raise spend cap.
- [ ] **Step 5:** Commit doc update.

### Task 13: Docs + final verification

**Files:** Modify `CLAUDE.md` (gitignored locally — update anyway), `docs/booking-schema.md`.

- [ ] **Step 1:** CLAUDE.md: replace "Booking flow (lessons)" with the new flow, code map (`src/lib/booking/*`, APIs), new env `BOOKINGS_ICS_TOKEN`, new permissions, fix stale lines ("Checkout endpoint is stubbed", "No `orders` collection exists yet", "Tax is hardcoded to 0"), and the Square session-id fix.
- [ ] **Step 2:** `pnpm test` → all pass; `pnpm astro check` → 0 errors; `pnpm build` → exit 0, no 403s.
- [ ] **Step 3:** Full sandbox walk-through: guest → pick time → sign in → cart → Square sandbox → confirmed → emails → appears in ICS → cancel from `/account` (≥24h) → credit created → rebook with credit.
- [ ] **Step 4:** Commit + push; update PR #2 description (or open a new PR off this branch if #2 merged) and link it via `mcp__t3-code__link_pull_request`.
