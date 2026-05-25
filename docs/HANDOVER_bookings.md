# Bookings + Lessons — handover

Status: schema work was mistakenly done in **crf-cms** instead of **se-cms**.
This remote session cannot see an MCP wrapping `https://content.shaunevans.com`,
so I'm handing off to a session that can. Everything in `claude/astro-lesson-bookings-2dKmg`
is otherwise green — code builds, frontend is wired, just needs the right Directus.

## TL;DR for the next agent

1. **Duplicate** the `lessons` and `booking_requests` collections (full schema below)
   from crf-cms (`https://cms.creativeranges.org`) into se-cms
   (`https://content.shaunevans.com`).
2. Set **public role permissions** in se-cms (see §4).
3. Set **`PUBLIC_DIRECTUS_URL=https://content.shaunevans.com`** in the deploy env
   (so the React BookingForm POSTs to the right Directus). Also set
   `DIRECTUS_URL` + `DIRECTUS_TOKEN` for the build-time fetch of lessons.
4. **Clean up** the orphaned objects in crf-cms (see §6).
5. **Rotate** the se-cms access token that was pasted into chat
   (`eqlstvgZ3W-i03hKJ3PnwHJEcIiPv3i0`) once you're done with it.
6. (Optional) Build the **booking notification Flow** in se-cms (see §5).
   Email may not be configured in Directus yet — confirm SMTP env vars first.

## 1. Branch state

- Branch: `claude/astro-lesson-bookings-2dKmg` (pushed)
- Last commit: `708f1e1 Wire booking form to Directus booking_requests collection`
- Build: `pnpm build` → 51 pages, clean.

Frontend files of interest:

- `src/pages/bookings/index.astro` — landing page (server-renders lesson cards)
- `src/components/bookings/LessonCard.tsx`
- `src/components/bookings/BookingForm.tsx` — POSTs to `${PUBLIC_DIRECTUS_URL}/items/booking_requests`
- `src/lib/directus.ts` — `fetchProducts` / `fetchLessons` (used at build time)
- `src/lib/catalog.ts` — falls back to local `src/data/lessons.ts` when Directus env vars are absent
- `.env.example` — DIRECTUS_URL / DIRECTUS_TOKEN / PUBLIC_DIRECTUS_URL / PUBLIC_DIRECTUS_BOOKING_TOKEN

The form posts these fields and only these fields:
`name`, `email`, `package_slug`, `instrument` (nullable), `experience_level`, `notes` (nullable).

Note: the form does **not** currently send `preferred_date` or `time_preference`,
even though those columns exist in `booking_requests`. If those are wanted on the
form, edit `src/components/bookings/BookingForm.tsx` (around the experience-level
block) and update the `submitToDirectus` body. Otherwise leave them as
optional/nullable in the schema.

## 2. `lessons` collection — full spec

Collection meta:

- `icon`: `school`
- `color`: `#6366F1`
- `group`: `website` (create the folder/group first if it doesn't exist)
- `archive_field`: `status`, `archive_value`: `archived`, `unarchive_value`: `published`
- `sort_field`: `sort`
- `accountability`: `all`
- `display_template`: `{{name}} — ${{price}}`
- `translations`: `[{language: en-US, translation: Lessons, singular: Lesson, plural: Lessons}]`
- `note`: `Lesson packages for bookings`

Fields (in order):

| # | field | type | special | interface | required | notes / options |
|---|---|---|---|---|---|---|
| 1 | id | integer PK, auto-increment | — | numeric | y | hidden, readonly |
| 2 | status | varchar(255) default `draft` | — | select-dropdown | n | choices: Published/published, Draft/draft, Archived/archived. display `labels` with showAsDot=true. width half |
| 3 | sort | integer | — | input | n | hidden |
| 4 | name | varchar(255) NOT NULL | — | input | y | note: "Package name" |
| 5 | slug | varchar(255) NOT NULL UNIQUE | — | input | y | note: "URL-friendly identifier", width half |
| 6 | price | numeric(10,2) | — | input | n | note: "Price in USD", width half |
| 7 | duration | varchar(100) | — | input | n | note: "e.g. 60 min, 4 × 60 min", width half |
| 8 | format | varchar(50) default `online` | — | select-dropdown | n | choices: Online/online, In person/in-person, Hybrid/hybrid. width half |
| 9 | tagline | varchar(255) | — | input | n | note: "Short one-liner for the package card" |
| 10 | description | text | — | input-multiline | n | note: "Full package description" |
| 11 | includes | json | — | list | n | list interface with one sub-field `item` (string, input). note: "What's included — shown as checklist on card" |
| 12 | popular | boolean default false | — | boolean | n | note: "Highlight as most popular", width half |

## 3. `booking_requests` collection — full spec

Collection meta:

- `icon`: `calendar_month`
- `color`: `#F59E0B`
- `group`: `website`
- `archive_field`: `status`, `archive_value`: `archived`, `unarchive_value`: `new`
- `accountability`: `all`
- `display_template`: `{{name}} — {{package_slug}}`
- `translations`: `[{language: en-US, translation: Booking Requests, singular: Booking Request, plural: Booking Requests}]`
- `note`: `Lesson booking requests submitted via shaunevans.com/bookings`

Fields (in order):

| # | field | type | special | interface | required | notes / options |
|---|---|---|---|---|---|---|
| 1 | id | integer PK, auto-increment | — | numeric | y | hidden, readonly |
| 2 | status | varchar(50) default `new` | — | select-dropdown | n | choices: New/new (#F59E0B), Read/read (#D3DAE4), Responded/responded (#2ECB71), Archived/archived (#95A5A6). display `labels` with showAsDot=true. width half |
| 3 | date_created | timestamptz | `date-created` | datetime | n | readonly, display relative, width half |
| 4 | name | varchar(255) NOT NULL | — | input | y | note: "Requester full name", width half |
| 5 | email | varchar(255) NOT NULL | — | input | y | note: "Requester email address", width half |
| 6 | package_slug | varchar(100) NOT NULL | — | input | y | note: "Slug of the lesson package requested", width half |
| 7 | instrument | varchar(255) | — | input | n | note: "Instrument or focus area", width half |
| 8 | experience_level | varchar(50) default `intermediate` | — | select-dropdown | n | choices: Just starting out/beginner, A few years in/intermediate, Advanced / pre-professional/advanced, Professional/professional. width half |
| 9 | notes | text | — | input-multiline | n | note: "What the student wants to work on" |
| 10 | preferred_date | date | — | datetime (options: includeSeconds=false, use24=false) | n | note: "Preferred start date for the first session". translation en-US "Preferred date" |
| 11 | time_preference | varchar(32) | — | select-dropdown | n | choices: Morning (before noon)/morning, Afternoon (noon–5 pm)/afternoon, Evening (after 5 pm)/evening, Flexible / no preference/flexible. display `labels`. translation en-US "Time preference" |

## 4. Permissions to set in se-cms

The form runs in the browser and posts unauthenticated by default. Pick **one**:

**Option A — public-role create access (simpler):**
- Settings → Access Control → Public → `booking_requests`:
  - Permissions: `Create` allowed
  - Field permissions: restrict to `name`, `email`, `package_slug`, `instrument`, `experience_level`, `notes`, `preferred_date`, `time_preference` (no `status`, no `id`)
  - Validation: enforce required fields again here as a defense
- `lessons`:
  - Permissions: `Read` where `{status: {_eq: "published"}}`
  - Field permissions: all fields except `sort` if you like (sort is fine to expose too)

**Option B — static write-only token (more locked down):**
- Create a static token in se-cms with only `booking_requests.create` permission.
- Set `PUBLIC_DIRECTUS_BOOKING_TOKEN=<that token>` in the deploy env.
- Note: this exposes the token in the browser bundle. It's still safer than full public access because the token only has one specific permission, but it's not a secret.

Recommendation: **Option A** plus rate-limiting in the Directus reverse proxy (e.g. Caddy).

## 5. (Optional) Booking notification Flow

Build in se-cms admin → Settings → Flows:

- Name: `Booking request notifications`
- Trigger: Event Hook, Action (non-blocking), scope: `booking_requests.items.create`
- Operation 1: **Send Email** to `shaun@shaunevans.com` with subject
  `New booking request from {{ $trigger.payload.name }}` and a body that
  surfaces `name`, `email`, `package_slug`, `instrument`, `experience_level`,
  `preferred_date`, `time_preference`, `notes`.
- Operation 2 (chained on success): **Send Email** to `{{ $trigger.payload.email }}`
  with a thank-you confirmation message.

**Pre-req:** confirm SMTP is configured in se-cms's Directus environment. Required env vars:
`EMAIL_FROM`, `EMAIL_TRANSPORT=smtp`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`,
`EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, `EMAIL_SMTP_SECURE`. The user noted
"email may not be properly configured in the directus config yet" — verify
before wiring the flow, or the operation will fail silently.

## 6. Cleanup in crf-cms (`mcp__032cee79-7102-4d34-a273-8f26c96fc85a`)

I created these in `https://cms.creativeranges.org` by mistake. Delete:

- Collection `lessons`
- Collection `booking_requests`
- Flow id `d0a64d1e-71d2-48aa-a718-8efc5fd4b03a` (name: "Booking request notifications") — already deactivated, no operations attached, but needs manual deletion via the admin UI (delete via the MCP returned `Delete actions are disabled`).

The crf-cms admin URL is `https://cms.creativeranges.org/admin`.

## 7. Frontend env vars to set in deploy

```
DIRECTUS_URL=https://content.shaunevans.com
DIRECTUS_TOKEN=<a read-only token with read access on lessons>
PUBLIC_DIRECTUS_URL=https://content.shaunevans.com
# only if you chose Option B above:
PUBLIC_DIRECTUS_BOOKING_TOKEN=<a write-only token with booking_requests.create>
```

The Astro pages do a build-time fetch from `DIRECTUS_URL/items/lessons?filter[status]=published&sort=sort`
in `src/lib/directus.ts`. If those env vars are absent, the build falls back to
the hardcoded `src/data/lessons.ts` — handy for local dev but means production
won't see CMS edits. **Make sure both env vars are set in production.**

## 8. Security — token rotation

The se-cms access token `eqlstvgZ3W-i03hKJ3PnwHJEcIiPv3i0` (admin) was shared
in chat to give me REST access from this remote session. **Rotate it** in
se-cms admin (Settings → Access Tokens or the user's profile) when handover
is complete. Replace any service that depends on it (none in this branch).

## 9. Quickest way to create the collections

The Directus admin UI is the easiest. Field-by-field is a few minutes per collection.

Alternative: a single `POST /collections` call per collection with embedded
`fields[]` works. Source of truth for the exact JSON payloads is the
`mcp__032cee79-...__fields` `read` output from this session for collections
`lessons` and `booking_requests` — when copying, drop the `meta.id` and
`schema.foreign_key_*` keys (Directus regenerates those), and drop the
`collection` key from each field's `schema` (Directus infers it).

Once both collections exist, sanity-check with:

```bash
curl -s "https://content.shaunevans.com/items/lessons" \
  -H "Authorization: Bearer <token>" | jq '.data | length'

curl -s -X POST "https://content.shaunevans.com/items/booking_requests" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","package_slug":"single-lesson","experience_level":"intermediate"}'
```

Then exercise the form locally with `PUBLIC_DIRECTUS_URL=https://content.shaunevans.com pnpm dev`.
