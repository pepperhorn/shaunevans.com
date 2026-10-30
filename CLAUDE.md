<!-- ph-orch:begin v2 — managed by orch-init -->
@AGENTS.md

## Claude-specific notes

- **As lead**, use the `orch-dispatch` skill. Ask the human questions with AskUserQuestion. Dispatch through T3 `delegate_task`, not the native Agent tool, because native subagents can't target Codex or apply T3 model options.
- **As implementer or reviewer**, your brief is the handoff doc whose path you were given, not this conversation. The `.claude/agents/orch-implementer.md` and `orch-reviewer.md` definitions encode the same rules for native use.
- Don't poll async tasks. The completion notification wakes this thread.
<!-- ph-orch:end -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this site is

Personal site for Shaun Evans (saxophonist, arranger, musical director) plus a small e-commerce shop and a lessons booking flow. Astro 6 + React 19 + Tailwind 4, SSR via `@astrojs/node` (standalone), deployed via Coolify.

The codebase originated as a fork of the Revista photography-portfolio theme; the `README.md`, the `*-README.md` files under `src/`, and `package.json` (`"name": "Revistav4"`) still reflect that lineage. Treat them as historical — the actual product is a music-focused site driven by a headless CMS.

## CMS — se-cms (Directus)

**All content is now in Directus at `https://content.shaunevans.com` (instance `032cee79`).** The site fetches at build time. MDX content under `src/content/` has been removed; `src/content.config.ts` exports an empty `collections = {}` and exists only to satisfy `astro:content`.

Directus collections used by this app:

- `posts` — blog content (single collection, distinguished by `post_tags`). Posts tagged `featured` feed the homepage hero (one random pick per load, `src/pages/index.astro` → `Homepage.astro` + `src/scripts/homePage.js`). Optional `hero_video` file field (WebM/MP4, Public folder) plays muted/looping over the post's `image`, which acts as poster + fallback; skipped for reduced-motion / Save-Data visitors.
- `post_tags` + `posts_post_tags` junction — categorisation (folder-name tags: `shared`, `stories`, `new-charts`, `authors`; plus content tags)
- `pages` + `page_blocks` (M2A) + `block_richtext` / `block_video` / `block_audio` / `block_spotify` / `block_youtube` / `block_form` — page builder for `/about`, `/contact`, `/cv`, and `/`
- `forms` + `form_fields` + `form_submissions` + `form_submission_values` — dynamic form builder (Directus template); rendered via `block_form` and submitted through `/api/forms/submit`
- `products` — shop catalogue
- `lessons` — booking packages. Booking fields: `kind` (`single` | `pack` | `contact`), `duration_minutes`, `credits`, `credit_lesson` (M2O → the lesson type a pack credit books), `credit_expiry_months` (default 12), `requires_phone`. Prices are AUD, GST-inclusive.
- `availability` — Shaun's teaching blocks (Sydney wall-clock `start_time`/`end_time`, `recurrence` none|weekly|fortnightly, `entry_type` available|unavailable, `status` published|draft, private `note`)
- `bookings` — lesson bookings (`held` → `confirmed` → `completed`/`no_show`, or `cancelled`; UTC `start_at`/`end_at` + padded `busy_start`/`busy_end`; `source` purchase|credit; links to `order`, `order_item`, `credit`; `meet_link`, `when_label`, `reminder_*_sent_at`)
- `lesson_credits` — credits from packs (`pack` set) and refund credits from self-service cancels (`pack` null); `credits_total`, `expires_at`, `status` active|expired|void
- `globals` (singleton, row 1) — `booking_*` settings: min notice 24 h, horizon 8 weeks, padding before/after 0, hold 15 min, slot step 30, cancel cutoff 24 h, `booking_notify_email` (Shaun's copies; must stay `shaun@shaunevans.com`)
- `booking_requests` — **legacy.** Written by the old `BookingForm` (deleted with the booking calendar). `/account` still lists a user's old rows under "Earlier requests"; nothing writes to it any more.
- `users` (NOT `directus_users`) — app-level customers (integer `id`, `email`, `name`, `status` active|suspended, `email_verified`, `last_login_at`, billing + newsletter fields). This is the principal collection for the `directus-otp-auth` extension. The legacy `otp_code_hash` / `otp_expires_at` columns and the old `OTP — request/verify code` flows were removed (2026-10-16) — the extension keeps codes and sessions in its own Postgres tables (`auth_code`, `auth_session`, `auth_rate_limit`, …; created by raw DDL, not Directus collections). A daily scheduled flow POSTs `/otp-auth/purge`.
- `directus-otp-auth` endpoint extension, mounted at `/otp-auth` (app slug `shaunevans`) — passwordless email-code sign-in. Source: `/home/shaun/directus-otp-auth` (see its `SPEC.md` §6). Routes used: `POST /code`, `POST /verify`, `GET /session`, `POST /logout`. Codes are 6 digits (`OTP_AUTH_CODE_DIGITS=6` on se-cms) and emailed via Directus `MailService` using `/directus/templates/otp-code.liquid`. se-cms SMTP must use port **587** (STARTTLS) — Hetzner blocks outbound 465/25, and a blocked port makes `/otp-auth/code` hang for minutes before silently failing.
- Existing Directus flows: `Form submission — email notification` (event hook on `form_submissions:items.create` → reads first config in `forms.emails`, merge-substitutes `{# field-name #}` tags, sends via SMTP)
- Booking flows (7, all active on se-cms; details + ids in `docs/booking-schema.md`): `Utils → Send booking email` (shared mail sub-flow), `Booking confirmed`, `Meet link added`, `Booking cancelled`, `Pack purchased`, `Order needs attention`, `Booking upkeep` (every 15 min: expire stale holds, mark ended lessons `completed`, expire credits, 24 h reminder email). After changing any flow, run the `directus-flow-tidy` skill.
- Booking DDL guards (raw SQL, not visible in Directus Studio): exclusion constraint `bookings_no_overlap` (GiST over `tstzrange(busy_start, busy_end)` for `held`/`confirmed` rows) is the real double-booking guard, and partial unique index `lesson_credits_one_per_pack_item` (`order_item` WHERE `pack IS NOT NULL`) keeps duplicate webhooks from minting credits twice. Directus masks the 23P01 exclusion violation as a generic 500, so `createBooking` probes for an overlapping live booking after a failed insert to decide whether it was a conflict.

There is a sibling Directus instance at `https://cms.creativeranges.org` (crf-cms) — **don't use it**. Stray `lessons` / `booking_requests` collections were created there by mistake during the bookings migration; cleanup is pending via the admin UI (the MCP for that instance has delete actions disabled). See `docs/HANDOVER_bookings.md` for the migration history.

Data-access layers (mirror the same caching pattern):

- `src/lib/directus.ts` — thin REST client + typed fetchers (`fetchPosts`, `fetchPostsByTag`, `fetchPostBySlug`, `fetchPages`, `fetchPageByPermalink`, `fetchProducts`, `fetchLessons`); also exports `assetUrl(uuid, fallback)` helper
- `src/lib/posts.ts` — post/page accessors with per-build caching (`getPostsByTag`, `getPost`, `getPage`, `getCategoryPostsWithTag`, `getCategoryTags`, `getAllPosts`, `getAllPages`). **Throws if Directus env vars missing** — there is no MDX fallback.
- `src/lib/catalog.ts` — products/lessons with stub fallback. When `DIRECTUS_URL`/`DIRECTUS_TOKEN` are absent it serves `src/data/products.ts` / `src/data/lessons.ts`. Useful for offline dev.
- `src/lib/cart.ts` — client-side cart (nanostores persistent atom in localStorage as `se:cart`). Line kinds: `product`, `lesson_booking` (a held slot: qty fixed at 1, hold countdown, removing it releases the hold) and `lesson_pack`. Checkout is live — see "Shop checkout" below.

CMS-driven rendering primitives:

- `src/layouts/CmsPostLayout.astro` — detail page for a Directus post (hero image, tags, HTML body via `set:html`)
- `src/components/CmsBlogPost.astro` — listing card (accepts URL-string images, not `ImageMetadata`)
- `src/components/CmsPageRenderer.astro` — renders a `pages.blocks` array. Implemented: `block_richtext`, `block_video`, `block_audio` (wavesurfer.js), `block_spotify`, `block_youtube`, `block_form`. Unknown block types render a visible placeholder.
- `src/components/cms/FormRenderer.tsx` — React form renderer driven by `forms` + `form_fields` schema; honeypot + client validation, POSTs to `/api/forms/submit`
- `src/pages/api/forms/submit.ts` — server endpoint; honeypot drop, server-side re-validation, file uploads to the "Form Quarantine" folder (`ff3972b6-aceb-4512-a644-8c3119190a02`), creates `form_submissions` + nested `form_submission_values`

URL convention: `/shared/<slug>`, `/stories/<slug>`, `/new_charts/<slug>`, `/authors/<slug>` — slug comes from the Directus `posts.slug` field (not the old MDX filename id). Old MDX-id URLs will 404; if a redirect is needed, the Directus `redirects` collection already exists.

## Required environment variables

```
DIRECTUS_URL=https://content.shaunevans.com
DIRECTUS_TOKEN=<see "Directus permissions" below>
PUBLIC_DIRECTUS_URL=https://content.shaunevans.com
# Legacy — only the deleted BookingForm used it; safe to drop from Coolify
PUBLIC_DIRECTUS_BOOKING_TOKEN=<write-only token>

# Checkout (server-only, read from process.env at runtime)
PAYMENT_PROVIDER=square
SQUARE_ENVIRONMENT=sandbox|production
# Split names, picked by SQUARE_ENVIRONMENT (SANDBOX_ or PRODUCTION_):
SQUARE_SANDBOX_ACCESS_TOKEN=…        SQUARE_PRODUCTION_ACCESS_TOKEN=…
SQUARE_SANDBOX_LOCATION_ID=…         SQUARE_PRODUCTION_LOCATION_ID=…
SQUARE_WEBHOOK_SANDBOX_SIGNATURE_KEY=…  SQUARE_WEBHOOK_PRODUCTION_SIGNATURE_KEY=…
# Fallback if a split name is unset: SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID / SQUARE_WEBHOOK_SIGNATURE_KEY
# (the fallback ignores SQUARE_ENVIRONMENT, so don't mix it with the split names)
PUBLIC_SITE_URL=https://shaunevans.com   # inlined at BUILD time (import.meta.env) — must be a build variable in Coolify

# Lesson bookings (server-only, runtime)
BOOKINGS_ICS_TOKEN=<long random secret>  # gates /api/calendar/bookings.ics; set runtime-only on Coolify app shaunevans-com-new

# OTP sign-in (directus-otp-auth extension on se-cms)
OTP_AUTH_APP_SLUG=shaunevans          # optional, defaults to "shaunevans"; must be in the extension's OTP_AUTH_APP_SLUGS
OTP_AUTH_CALLER_KEY=<origin secret>   # optional; sent as x-otp-auth-key once the extension's origin allowlist is configured
PUBLIC_OTP_AUTH_CODE_DIGITS=6         # optional; UI copy only — match the extension's OTP_AUTH_CODE_DIGITS (input accepts 6–10)
```

`PUBLIC_*` vars end up in the browser bundle — keep tokens minimal-permission. `astro.config.mjs` already adds `content.shaunevans.com` to image domains so Astro's Sharp pipeline can optimise remote images. Without `DIRECTUS_URL` + `DIRECTUS_TOKEN` the build will throw — there is no longer an MDX fallback.

## Commands

```bash
pnpm install
pnpm dev -- --host 0.0.0.0    # bind to LAN so other devices can hit it (global preference)
pnpm build                    # full SSR build + Pagefind index (postbuild hook)
pnpm preview                  # serve dist/
pnpm astro check              # type-check .astro files (no separate `pnpm check` script defined)
```

`pnpm test` runs vitest (booking engine, repo, fulfilment + webhook, cancel, ICS, grid model, checkout line validation, Square provider — Directus and Square are mocked). `pnpm build:github-pages` exists from the Revista template but the GitHub Pages deploy path is no longer used. Live booking/checkout behaviour still needs a hand check against the Square sandbox (see "Verifying checkout locally" below).

## Deployment

Site deploys via **Coolify** from `main` — Coolify pulls the repo, runs the Docker build (`Dockerfile` at repo root), and serves the resulting Node SSR app. There is no GitHub Actions CI in this repo (the upstream Revista template's `.github/workflows/deploy.yml` was deleted because every deploy job in it expected secrets we don't set, and Coolify is the real deploy path). If you want PR-time build verification back, add a single-job workflow that runs `pnpm install && pnpm build` — don't restore the multi-target Revista pipeline.

## Booking flow (lessons)

Design: `docs/superpowers/specs/2026-10-18-lesson-booking-calendar-design.md`. Schema, DDL, permissions and flow ids: `docs/booking-schema.md`.

Business time zone is `Australia/Sydney`; availability is Sydney wall-clock, every stored instant is UTC, and the grid groups by the visitor's zone. Starts fall on `:00`/`:30`.

**Flows:**

- **Single session (paid):** `/bookings` grid → pick a start → **Add to cart** (OTP sign-in via `AuthOverlay` if needed) → `POST /api/bookings/hold` creates a `bookings` row `held` for `booking_hold_minutes` (max 4 live holds per user; 409 on overlap) → cart line `lesson_booking` → `/api/checkout` re-validates the hold (409 `hold_expired` if gone; 409 `already_paid` if the booking's order is already `paid`/`fulfilled` — the cart drops that line) and links booking ↔ `order_item` → Square → webhook → `fulfillPaidOrder` flips the booking to `confirmed`. A hold that expired before payment is re-occupied if the time is still free (bypassing notice/horizon checks); if the time was taken, or the booking now points at a newer order, the order gets `needs_attention` + a note and Shaun is emailed.
- **Pack:** `lesson_pack` cart line (no time) → on paid, one `lesson_credits` row per pack line (`credits_total` = `lessons.credits`, `expires_at` = paid_at + `credit_expiry_months`). Packs with `requires_phone` (Composition Mentorship) need a phone at checkout; Shaun is emailed it for the WhatsApp group.
- **Book with credit:** signed-in users with active credits see "Use a credit — …" in the grid → `POST /api/bookings/credit` creates a `confirmed` `source=credit` booking against the credit the student picked in the selector (the client sends `credit_id`; the route checks it's theirs and active — there's no server-side oldest-expiring pick) (post-insert recount backs out an overspend → 409 `no_credits`).
- **Cancel / reschedule (`/account`):** allowed while ≥ `booking_cancel_cutoff_hours` (24 h) remain. Cancelling a paid single creates a 1-credit refund credit (`pack` null, 12-month expiry); cancelling a credit booking frees the credit. Reschedule goes through the grid (`/bookings?reschedule=<id>`) and only releases the old time once the new one is held. Inside the cutoff: no buttons, "Need to change this? Get in touch." + the no-show note.
- **Notifications** are Directus flows (see CMS section), not site code. SMS reminders (2 h, `users.sms_opt_in` + `phone`) are **not live yet** — the AWS SNS extension is built but waiting on Shaun's IAM key, region and sender ID (Task 12).
- **Calendar feed:** `GET /api/calendar/bookings.ics?token=<BOOKINGS_ICS_TOKEN>` — confirmed + completed bookings (−30 days → horizon) plus open availability blocks (`&blocks=0` to hide). Wrong token → 404. Shaun subscribes in Google Calendar → Other calendars → From URL.

**Code map:**

- `src/lib/booking/time.ts` (Sydney wall-clock ↔ UTC), `availability.ts` (expand `availability` rows into intervals), `slots.ts` (`buildAvailabilityView`: blocks, busy, bookable starts; padding/notice/horizon), `policy.ts` (`canSelfManage`, `whenLabel`) — pure, unit-tested.
- `src/lib/booking/repo.ts` — server-only Directus layer (`getBookingSettings`, `listAvailabilityRows`, `listBusy`, `expireStaleHolds`, `createBooking`, `cancelConfirmedBooking`, `getActiveCredits`, `createRefundCredit`, `flagOrderAttention`, `listFeedBookings`, …). Normalises Directus `HH:MM:SS` times to `HH:MM`.
- `src/lib/booking/fulfil.ts` — `fulfillPaidOrder`, idempotent; called by the webhook on every `paid` delivery including replays.
- `src/lib/booking/ics.ts` — RFC 5545 writer + `icsTokenMatches` (constant-time).
- `src/lib/bookings.ts` — `/account` readers (`getBookingsForUser`, `getLessonTimesByOrderItem`, legacy `getBookingsForEmail`).
- APIs (all `prerender = false`): `api/bookings/{availability,hold,credit,credits}.ts`, `api/bookings/[id]/{release,cancel,reschedule}.ts`, `api/account/contact.ts` (phone + SMS opt-in), `api/calendar/bookings.ics.ts`.
- UI: `src/pages/bookings/index.astro` (**prerendered** — lessons and `booking_horizon_weeks` are baked in at build, so changing them needs a redeploy; the grid data itself is fetched live), `src/components/bookings/{BookingPanel,WeekGrid,LessonCard}.tsx` + `gridModel.ts`/`timeLabels.ts`, `src/components/account/LessonsSection.tsx`.

## Shop checkout

Digital goods only — no shipping, manual email delivery after payment.

**Flow:** cart sheet (products, lesson holds, packs) → `CheckoutButton` → if no session, `AuthOverlay` (Sheet) runs OTP (request → verify) via `/api/auth/{request,verify}-otp`, which proxy server-side to the `/otp-auth` extension → Astro's built-in session (`Astro.session.set("user", …)` plus the extension's bearer token in `session.set("otp", …)`, httpOnly cookie, filesystem-backed via `@astrojs/node`) → POST `/api/checkout` reads `session.get("user")`, validates lines (`resolveCheckoutLines`), creates `orders` + `order_items` via Directus REST (currency `AUD`) → `PaymentProvider.createPaymentLink()` → buyer redirected to Square hosted checkout → on return, lands on `/shop/orders/<id>/confirmation` (also session-gated) → Square POSTs to `/api/webhooks/square` (signature-verified) → order flipped to `paid` with `payment_intent_id`/`paid_at` → `fulfillPaidOrder` confirms lesson bookings / mints pack credits → for sheet music, operator manually emails digital goods, sets `delivered_at` and status `fulfilled` in Directus admin.

**Code map:**

- `src/lib/payments/` — `PaymentProvider` interface + `SquareProvider` (Checkout Links API). Add a `StripeProvider` here later; factory in `index.ts` picks by `PAYMENT_PROVIDER` env var and reads the `SQUARE_*` secrets from `process.env` at runtime (split `SANDBOX_`/`PRODUCTION_` names, unsplit fallback). `createPaymentLink` returns the Square **order id** (`payment_link.order_id`) as `session_id` — that is what `payment.updated` carries as `payment.order_id`, so `markOrderPaid` matches it against `orders.payment_session_id`. (It used to store the payment-link id, which never matched.)
- `src/lib/orders.ts` — `createOrder` (AUD, GST-inclusive: GST back-calculated as total/11), `resolveCheckoutLines` + `CheckoutError` (lesson/pack/product line validation), `linkBookingsToOrder`, `attachPaymentSession`, `markOrderPaid` (closed — `cancelled`/`refunded` — orders are never revived), `getOrdersForUser`, `getOrderForUser`, `getPurchasesForUser`. All Directus REST with `DIRECTUS_TOKEN`.
- `src/lib/auth.ts` — server-only client for the `directus-otp-auth` extension (`requestCode`, `verifyCode`, `getOtpSession`, `logoutOtpSession`) plus `users` helpers (`findUserByEmail`, `getUserById`, `createUser`, `markUserVerified`) via `DIRECTUS_TOKEN`. Verify requests `transport: "bearer"` (needs `OTP_AUTH_TRANSPORT=both` on the extension); the token is stored server-side in the Astro session and replayed to Directus as `Cookie: otp_auth_session__<slug>=<token>` (Directus swallows `Authorization` before extensions see it). Mirrors `pepperhorn-platform/apps/primary/src/lib/otp-auth.ts`.
  - request-otp: find-or-create the `users` row (`status: active`, `email_verified: false`; suspended rows are left alone) then `POST /otp-auth/code`; always returns a uniform `{ ok: true }` (no account enumeration).
  - verify-otp: `POST /otp-auth/verify` → token → `GET /otp-auth/session` → principal id → load `users` row, PATCH `email_verified: true` + `last_login_at` → `session.regenerate()` → `session.set("user", {id,email,name})` + `session.set("otp", {token,expiresAt,lastCheckedAt})`. The token never reaches the browser.
  - me: returns the session user; re-validates the token against `/otp-auth/session` at most every 5 min and destroys the session on 401 / expiry.
  - signout: best-effort `POST /otp-auth/logout`, then always destroys the Astro session.
- `src/lib/sessionClient.ts` — browser-side nanostores atom + `/api/auth/me` fetch, plus `setSessionUser` and `signOut` helpers. There is no client-side persistence — the session lives in an httpOnly cookie managed by Astro.
- `src/pages/api/auth/{request-otp,verify-otp,me,signout}.ts` + `api/{checkout,webhooks/square}.ts` — each sets `export const prerender = false`. Auth state is read via `context.session.get("user")` / written via `session.set("user", …)` + `session.regenerate()` after OTP verify. `checkout`, `account.astro` and the confirmation page only read `session.get("user")`; token revalidation happens in `/api/auth/me`.
- `src/components/shop/{AuthOverlay,CheckoutButton}.tsx` — single Sheet-based OTP overlay; checkout button auto-opens it when not signed in.
- `src/pages/shop/orders/[id]/confirmation.astro` — server-rendered; reads `Astro.session.get("user")` directly.
- `src/pages/account.astro` — server-rendered account page: Lessons (upcoming/past, cancel/reschedule, credits, SMS opt-in), Purchases, Orders with line items (by `user_id`), legacy "Earlier requests" (`booking_requests` by email), plus an optional `CmsPageRenderer` driven by a Directus `pages` row at permalink `/account`.

**Directus permissions required on the `DIRECTUS_TOKEN` role:**

- **Read** on: `posts`, `pages`, `post_tags`, `posts_post_tags`, `page_blocks`, `block_richtext`, `block_video`, `block_audio`, `block_spotify`, `block_youtube`, `block_form`, `forms`, `form_fields`, `products`, `lessons`, `booking_requests`, `series`, `series_products`, `learning`, `learning_blocks`, `learning_products`, `availability`
- **Read** on `globals` limited to `id` + the eight `booking_*` fields (never `openai_api_key` or the site fields)
- **Create + Read + Update** on `bookings`, `lesson_credits` (policy "Production" `9f9decc2-…`, grant ids 118–125)
- **Read** on `directus_files` **scoped to the Public folder** — filter `{ "folder": { "_eq": "95d4e1d5-508d-40d4-a7d0-73cdf574c213" } }`. Keeps the Form Quarantine folder (and any future Protected folder) outside the token's read scope so submitted files aren't world-readable via guessable UUIDs.
- **Create + Read + Update** on: `orders`, `order_items` (fulfilment sets `status`/`needs_attention`/`notes` and links `order_items.booking`)
- **Create + Read** on: `form_submissions`, `form_submission_values`
- **Create + Read + Update** on `users` (fields: `id`, `email`, `name`, `status`, `email_verified`, `last_login_at`) — OTP sign-up creates the row; verify marks it verified.
- **Create** on `directus_files` for the Form Quarantine folder (`ff3972b6-aceb-4512-a644-8c3119190a02`) — file-block uploads land there. Optionally scope create with filter `{ "folder": { "_eq": "ff3972b6-aceb-4512-a644-8c3119190a02" } }` so the token can only write into Quarantine, never into Public or Protected.
- **No access** to: `directus_users` or any `directus_*` system collection (the OTP extension manages its own code/session tables)

**Public role** (anonymous browsers + social-share crawlers fetching `/assets/<uuid>`):

- **Read** on `directus_files` scoped to the Public folder — same filter as above. Required so `<img>` tags and OG image previews resolve.
- No other permissions needed. Bookings and form submissions are server-proxied through `DIRECTUS_TOKEN`; availability reaches the browser only via `/api/bookings/availability` (no notes or student data). The old public `create` on `booking_requests` / `PUBLIC_DIRECTUS_BOOKING_TOKEN` is legacy and can be removed.

The block sub-collections (`block_*`) are M2A targets — Directus silently returns `null` for any item whose collection the token can't read, so a missing entry there shows up as `[Unsupported block: ...]` placeholders in the renderer, not an error. Same trap applies to file refs: if a post's hero image lives outside the Public folder, `og:image` previews will 403 even though the page itself renders fine.

**Square setup:** configure a Webhook in your Square app pointing to `${PUBLIC_SITE_URL}/api/webhooks/square` and subscribe to `payment.updated` events. Copy the signature key into `SQUARE_WEBHOOK_<SANDBOX|PRODUCTION>_SIGNATURE_KEY`. The handler always signs over `siteUrl()` + path (`src/lib/siteUrl.ts`: runtime `process.env.PUBLIC_SITE_URL`, then the build-time value, then astro.config `site`) — never the request URL, which behind Coolify's proxy is the internal http origin. It must match exactly what Square calls (`https://shaunevans.com`), or every delivery gets 401. Checkout's Square `redirect_url` uses the same helper. Currency is hard-coded `AUD` server-side.

**Verifying checkout locally:** Square can't deliver webhooks to a dev machine (tailnet blocks funnel), and sandbox payment-link orders stay `DRAFT` (not payable). Build with `PUBLIC_SITE_URL=http://127.0.0.1:<port>`, run `node --env-file=.env dist/server/entry.mjs`, check out for real, then pay a stand-in OPEN sandbox order (`POST /v2/orders` + `POST /v2/payments` with `cnon:card-nonce-ok`) and POST a `payment.updated` body with `payment.order_id` = the Directus order's `payment_session_id`, signed `base64(HMAC-SHA256(key, url + body))`. Temporarily point `globals.booking_notify_email` at a test inbox and restore it afterwards.

**Known gaps:**

- GST is back-calculated (total/11) on AUD orders; there is no per-country tax logic.
- The cart is cleared on the confirmation page (found-order branch only, via `data-clear-cart`). A buyer who abandons Square and never reaches it keeps their cart; a paid lesson line re-submitted later gets 409 `already_paid` and is removed.
- Reschedule into a time that overlaps the student's own current booking (e.g. shift by 30 min) fails as `slot_taken`: the new booking is inserted before the old one is cancelled, so the overlap guard sees the student's own slot as busy. Workaround: cancel and rebook, or ask Shaun.
- Task 11 notification quirks (admin side): re-saving a `confirmed` booking in Studio with `status` in the payload re-sends the confirmation emails; an admin cancelling a still-`held` booking without a silent `cancel_reason` (`hold_expired`, `released`, …) emails the student a cancellation, because the action event can't see the previous status.
- The live Square → webhook path (real delivery to `https://shaunevans.com/api/webhooks/square`) has only been simulated with locally signed payloads; test it once after the first deploy.
- No retries on Square API failures — buyer sees an error and can re-submit.
- Per-product `square_checkout_link` field still exists as a single-item bypass route but isn't wired anywhere now.
- Astro sessions are filesystem-backed (default driver in `@astrojs/node` standalone). Coolify runs a single container, so sessions survive in `node_modules/.astro/sessions` between requests but **not** across deploys/restarts. Users get signed out on each redeploy. Move to a Redis or Postgres driver if that becomes painful — see Astro docs on `session.driver`.

## Conventions and gotchas

- Path alias `@/*` → `src/*` (set in `tsconfig.json`). Use it everywhere except in `astro.config.mjs`.
- New CMS-driven Astro pages should fetch via `src/lib/posts.ts` (cached) rather than calling `src/lib/directus.ts` directly.
- Image rendering: for remote Directus URLs, prefer `astro:assets`'s `<Image>` with `inferSize={false}` + explicit `width`/`height`. For dynamic per-size variants in client-side contexts, use Directus's `?width=&height=&fit=cover&format=avif&quality=65` transforms instead of Astro's build-time pipeline (see `src/pages/index.astro`).
- Astro `getStaticPaths` runs in module isolation — **do not reference module-level `const`s from inside it**. Inline the value or call the helper directly.
- M2M write through Directus REST: send `post_tags: [{ post_tags_id: "<uuid>" }, ...]` on create; the API inserts junction rows.
- Fonts: the site uses `font-overpass-mono` (display) and `font-inconsolata` (body), loaded via `@fontsource-variable/*`. The global preference for `Poppins` does not apply here — match the existing typography.
- Branch naming used by recent work: `claude/<topic>` (e.g. `claude/directus-frontend-wiring`, `claude/astro-lesson-bookings-2dKmg`).
- Pagefind search index is built into `dist/pagefind/` by the `postbuild` script — search lives at `/pagefind`. Pages must include the `data-pagefind-body` attribute somewhere in the markup to be indexed (see `CmsPostLayout.astro`).
- Dark mode is class-based (`.dark` on `<html>`); a `ThemeToggle` lives in the header.

## Likely-orphan code

After the MDX → Directus migration, several files appear unused but were left in place pending audit. Don't extend them — port to the CMS pattern instead, or remove if you're confident:

- `src/components/{InlineImage,Masonry,Signature,getRandomImage,HomepageMasonry,Hamburger.tsx,Greeting.jsx,sortbydate.jsx}` — most were used by MDX content or earlier homepage layouts
- `src/layouts/AuthorLayout.astro` — superseded by `CmsPostLayout`
- `src/utils/imageMap.ts` — built-time local-image lookup table for the old MDX flow
- `src/scripts/{filterportraitimages,getrandomimage,homePageMasonry,since94,burgundy}.js` — legacy homepage scripts (`homePage.js` + `Homepage.astro` ARE live — they drive the homepage hero)
- `scripts/` (repo root) `create-content.js`, `update-post*.js` — MDX scaffolding helpers, no longer applicable

If you delete any of the above, run `pnpm build` to confirm nothing imports them.
