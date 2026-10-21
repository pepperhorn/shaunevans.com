# Lesson booking — se-cms schema record

Record of the Directus schema changes made on **se-cms** (`https://content.shaunevans.com`, Directus 12.5 / Postgres 16.4) for the lesson booking calendar (Task 5, 2026-10-19). All changes are additive: no fields dropped or renamed, no rows deleted.

A pre-change snapshot (`directus_collections` / `directus_fields` / `directus_relations` / `directus_permissions` rows + `information_schema.columns`, plus a `pg_dump --schema-only`) is kept outside git at `.superpowers/sdd/2026-10-18-lesson-booking-calendar/schema-before.{json,sql}`. It was taken from psql because no admin REST token was available for `GET /schema/snapshot`.

Collections, fields and relations were created with the se-cms MCP tools (`collections`, `fields`, `relations`). The exclusion constraint was added with raw DDL over SSH.

## New collections

All three use a `uuid` primary key `id` and hidden `date_created` / `date_updated` (`timestamp`) system fields.

### `availability`

Shaun's teaching blocks. Display template: `{{entry_type}} {{recurrence}} {{start_time}}–{{end_time}}`.

| field | Directus type | Postgres | notes |
|---|---|---|---|
| `status` | string | varchar NOT NULL default `published` | `published` \| `draft` |
| `entry_type` | string | varchar NOT NULL default `available` | `available` \| `unavailable` |
| `recurrence` | string | varchar NOT NULL default `weekly` | `none` \| `weekly` \| `fortnightly` |
| `day_of_week` | integer | integer NULL | ISO 1=Mon..7=Sun; validation 1–7 or null |
| `start_date` | date | date NOT NULL | Sydney date |
| `end_date` | date | date NULL | empty = open-ended / single day |
| `start_time` | time | time NOT NULL | Sydney wall-clock |
| `end_time` | time | time NOT NULL | Sydney wall-clock; end ≤ start = next day |
| `note` | text | text NULL | private |

Directus returns `time` values as `HH:MM:SS`, and `AvailabilityRow` expects `HH:MM`. The Task 6 reader must normalise the format or tolerate seconds.

### `bookings`

Display template: `{{when_label}} — {{user.email}} ({{status}})`.

| field | Directus type | Postgres | notes |
|---|---|---|---|
| `status` | string | varchar NOT NULL default `held` | `held` \| `confirmed` \| `cancelled` \| `completed` \| `no_show` |
| `user` | integer, M2O → `users` | integer NULL (meta required) | FK `bookings_user_foreign` ON DELETE SET NULL |
| `lesson` | integer, M2O → `lessons` | integer NULL (meta required) | FK ON DELETE SET NULL |
| `start_at` | timestamp | timestamptz NOT NULL | UTC instant |
| `end_at` | timestamp | timestamptz NOT NULL | UTC instant |
| `busy_start` | timestamp | timestamptz NOT NULL | start_at − padding before |
| `busy_end` | timestamp | timestamptz NOT NULL | end_at + padding after |
| `hold_expires_at` | timestamp | timestamptz NULL | |
| `source` | string | varchar NOT NULL default `purchase` | `purchase` \| `credit` |
| `order` | uuid, M2O → `orders` | uuid NULL | FK ON DELETE SET NULL |
| `order_item` | uuid, M2O → `order_items` | uuid NULL | FK ON DELETE SET NULL |
| `credit` | uuid, M2O → `lesson_credits` | uuid NULL | FK ON DELETE SET NULL |
| `meet_link` | string | varchar NULL | |
| `student_notes` | text | text NULL | |
| `visitor_timezone` | string | varchar NULL | IANA zone |
| `when_label` | string | varchar NULL | UI read-only (API writable) |
| `cancelled_at` | timestamp | timestamptz NULL | |
| `cancel_reason` | string | varchar NULL | |
| `reminder_email_sent_at` | timestamp | timestamptz NULL | UI read-only |
| `reminder_sms_sent_at` | timestamp | timestamptz NULL | UI read-only |

### `lesson_credits`

Display template: `{{credits_total}} × {{lesson.name}} — {{user.email}} ({{status}})`.

| field | Directus type | Postgres | notes |
|---|---|---|---|
| `status` | string | varchar NOT NULL default `active` | `active` \| `expired` \| `void` |
| `user` | integer, M2O → `users` | integer NULL (meta required) | FK ON DELETE SET NULL |
| `pack` | integer, M2O → `lessons` | integer NULL | the pack bought; null for refund credits |
| `lesson` | integer, M2O → `lessons` | integer NULL (meta required) | lesson type the credit books |
| `order_item` | uuid, M2O → `order_items` | uuid NULL | FK ON DELETE SET NULL |
| `credits_total` | integer | integer NOT NULL default 1 | |
| `expires_at` | timestamp | timestamptz NULL | |

## Fields added to existing collections

| collection | field | type | default | notes |
|---|---|---|---|---|
| `lessons` | `kind` | string | null | `single` \| `pack` \| `contact` |
| `lessons` | `duration_minutes` | integer | null | |
| `lessons` | `credits` | integer | null | |
| `lessons` | `credit_lesson` | integer, M2O → `lessons` | null | FK `lessons_credit_lesson_foreign` ON DELETE SET NULL |
| `lessons` | `credit_expiry_months` | integer | 12 | |
| `lessons` | `requires_phone` | boolean (NOT NULL) | false | |
| `globals` | `booking_min_notice_hours` | integer | 24 | |
| `globals` | `booking_horizon_weeks` | integer | 8 | |
| `globals` | `booking_padding_before_mins` | integer | 0 | |
| `globals` | `booking_padding_after_mins` | integer | 0 | |
| `globals` | `booking_hold_minutes` | integer | 15 | |
| `globals` | `booking_slot_step_mins` | integer | 30 | |
| `globals` | `booking_cancel_cutoff_hours` | integer | 24 | |
| `globals` | `booking_notify_email` | string | `shaun@shaunevans.com` | |
| `order_items` | `lesson` | integer, M2O → `lessons` | null | FK ON DELETE SET NULL |
| `order_items` | `booking` | uuid, M2O → `bookings` | null | FK ON DELETE SET NULL |
| `orders` | `needs_attention` | boolean (NOT NULL) | false | |
| `users` | `sms_opt_in` | boolean (NOT NULL) | false | |

`order_items.product` was already nullable (`is_nullable YES`, `required false`), so it needed no change. `orders.currency` already offers `AUD` (Task 2). `users.phone` already exists.

`globals` is a singleton (row `id = 1`), and the eight values above are set on that row.

## Relations (all M2O, `on_delete SET NULL`, no O2M alias)

`bookings.user→users`, `bookings.lesson→lessons`, `bookings.order→orders`, `bookings.order_item→order_items`, `bookings.credit→lesson_credits`, `lesson_credits.user→users`, `lesson_credits.pack→lessons`, `lesson_credits.lesson→lessons`, `lesson_credits.order_item→order_items`, `lessons.credit_lesson→lessons`, `order_items.lesson→lessons`, `order_items.booking→bookings` (directus_relations ids 109–120).

## Double-booking guard (DDL)

Run via `ssh -i ~/.ssh/coolify_hz_localhost_key root@coolify-hz` → `docker exec -i postgresql-wxinv1oyzrgdrwgupv4tlw2d psql -U $POSTGRES_USER -d directus`:

```sql
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (tstzrange(busy_start, busy_end, '[)') WITH &&)
  WHERE (status IN ('held','confirmed'));
```

No extension was needed: `btree_gist` was **not** installed. Range types have native GiST support. The resulting definition is:

```
EXCLUDE USING gist (tstzrange(busy_start, busy_end, '[)'::text) WITH &&) WHERE (((status)::text = ANY ((ARRAY['held'::character varying, 'confirmed'::character varying])::text[])))
```

Rollback, if ever needed: `ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap;`

The constraint does not know about `hold_expires_at`. An expired hold still blocks its time until something flips it to `cancelled`. App code must cancel expired holds (scheduled flow and/or before insert) so they stop blocking.

### Verification (single transaction, rolled back; 0 rows remain)

```
BEGIN;
INSERT confirmed 08:00–09:00                          → INSERT 0 1
INSERT confirmed 08:30–09:30 (overlap)                → ERROR: 23P01: conflicting key value violates exclusion constraint "bookings_no_overlap"
INSERT held      08:30–09:30 (overlap)                → ERROR: 23P01 (same constraint)
INSERT confirmed 09:00–10:00 (back-to-back, '[)')     → INSERT 0 1
INSERT cancelled 08:15–09:15 (overlap, not guarded)   → INSERT 0 1
ROLLBACK;
SELECT count(*) FROM bookings;                        → 0
```

(Savepoints were used between the failing inserts. All rows were on 2030-01-01 UTC.)

## One credit row per pack line (DDL, Task 8, 2026-10-19)

Fulfilment (`src/lib/booking/fulfil.ts`) checks for an existing credit row and then inserts one. Two parallel webhook deliveries could both get past the check, so the database enforces one pack credit per `order_item`:

```sql
CREATE UNIQUE INDEX lesson_credits_one_per_pack_item ON lesson_credits (order_item) WHERE pack IS NOT NULL;
```

The index is partial because refund credits (Task 10, `pack` null) may share an `order_item` with the pack credit. A NULL `order_item` never collides.

- **Pre-check:** `SELECT order_item, count(*) FROM lesson_credits WHERE pack IS NOT NULL GROUP BY order_item HAVING count(*) > 1` returned 0 rows. The table held 1 row (pack set, order_item set).
- **Verification:** each insert ran in its own transaction and was rolled back; the count is still 1 afterwards.
  - Inserting a second pack row for the same `order_item` → `ERROR 23505 duplicate key value violates unique constraint "lesson_credits_one_per_pack_item"`.
  - Inserting a `pack NULL` row for the same `order_item` → `INSERT 0 1`.
- **Over REST:** a duplicate `POST /items/lesson_credits` with `DIRECTUS_TOKEN` returns **400 `RECORD_NOT_UNIQUE`** (field `order_item`), not a masked 500. Fulfil treats any failed credit insert as success when a pack credit for that `order_item` already exists.

Rollback: `DROP INDEX lesson_credits_one_per_pack_item;`

## Seed

Existing `lessons` rows were mapped by slug, not assumed ids. Only the new fields were written; names, prices and descriptions are unchanged.

| id | slug | name | kind | duration_minutes | credits | credit_lesson | credit_expiry_months | requires_phone |
|---|---|---|---|---|---|---|---|---|
| 1 | `single-session` | Single Coaching Session | single | 60 | – | – | 12 (default) | false |
| 2 | `four-pack` | Four-Pack | pack | – | 4 | 1 | 12 | false |
| 3 | `composition-mentorship` | Composition Mentorship | pack | – | 6 | 1 | 12 | true |
| 4 | `in-person-intensive` | In-Person Intensive (Singapore) | contact | – | – | – | 12 (default) | false |

The Composition Mentorship display copy still says `duration` "6 × 75 min" and "Six 75-minute mentorship sessions", but its credits book the 60-minute Single type, as the spec says. Shaun should reconcile the copy or the lesson type.

`globals` (row 1): `booking_min_notice_hours` 24, `booking_horizon_weeks` 8, `booking_padding_before_mins` 0, `booking_padding_after_mins` 0, `booking_hold_minutes` 15, `booking_slot_step_mins` 30, `booking_cancel_cutoff_hours` 24, `booking_notify_email` `shaun@shaunevans.com`.

## Permissions — `DIRECTUS_TOKEN` policy "Production" (`9f9decc2-0b4b-4020-bbc0-fe2396362ca5`)

Existing grants already use `fields: *` with no item filter, so they cover the new fields with no change:

| collection | action | id | covers |
|---|---|---|---|
| `lessons` | read | 94 | new lesson fields |
| `order_items` | create / read / update | 55 / 56 / 100 | `lesson`, `booking` |
| `orders` | create / read / update | 57 / 58 / 59 | `needs_attention`, `notes` |
| `users` | create / read / update | 110 / 111 / 112 | `phone`, `sms_opt_in` |

**Added 2026-10-19** with `POST /permissions` using an admin credential that Shaun authorised. Before posting, a check confirmed the policy had no existing grants for these collections. No item filter, validation or presets:

| id | collection | action | fields |
|---|---|---|---|
| 118 | `availability` | read | `*` |
| 119 | `bookings` | create | `*` |
| 120 | `bookings` | read | `*` |
| 121 | `bookings` | update | `*` |
| 122 | `lesson_credits` | create | `*` |
| 123 | `lesson_credits` | read | `*` |
| 124 | `lesson_credits` | update | `*` |
| 125 | `globals` | read | `id,booking_min_notice_hours,booking_horizon_weeks,booking_padding_before_mins,booking_padding_after_mins,booking_hold_minutes,booking_slot_step_mins,booking_cancel_cutoff_hours,booking_notify_email` |

`globals` had no read grant before this. Its field list deliberately leaves out `openai_api_key` and the other site fields. A check of `directus_permissions` afterwards confirmed that only ids 118–125 were added.

### Verification (`curl -H "Authorization: Bearer $DIRECTUS_TOKEN"`, 2026-10-19, after grants)

| request | status |
|---|---|
| `GET /items/lessons?fields=id,kind,duration_minutes,credits,credit_lesson,credit_expiry_months,requires_phone` | 200 (seeded values returned) |
| `GET /items/orders?fields=id,needs_attention,notes&limit=1` | 200 |
| `GET /items/order_items?fields=id,lesson,booking,product&limit=1` | 200 |
| `GET /items/users?fields=id,phone,sms_opt_in&limit=1` | 200 |
| `GET /items/globals?fields=id,booking_*` (all 8 fields) | 200 (values 24/8/0/0/15/30/24/shaun@shaunevans.com) |
| `GET /items/availability?limit=1` | 200 |
| `GET /items/bookings?limit=1` | 200 |
| `GET /items/lesson_credits?limit=1` | 200 |
| `GET /items/globals?fields=openai_api_key` | **403** — "You don't have permission to access field \"openai_api_key\"" |
| `GET /items/globals` (no field list) | 200, returns only `id` + the 8 `booking_*` fields |

## Notification flows (Task 11, 2026-10-21)

All six flows send mail through one shared sub-flow. Each one reads the current rows (not just the event payload), builds `{ to, subject, html }` messages in an `exec` op, and hands the array to a `trigger` op (`iterationMode: serial`). Bodies use the stored `bookings.when_label`. Shaun's copies go to `globals.booking_notify_email`, falling back to `shaun@shaunevans.com`. Item reads use `permissions: $full`. Note that `item-read` on the `globals` singleton returns a **one-row array**, so the exec code takes `[0]`.

Condition ops evaluate with `requireAll`. A gate such as `$trigger.payload.status _eq confirmed` therefore rejects any update whose payload doesn't contain that field, so editing other fields does not re-send emails.

| flow | id | trigger | does |
|---|---|---|---|
| Utils → Send booking email | `8f695cc1-081c-4348-80ef-837743369a74` | operation | `mail` op (wysiwyg) with `$trigger.to/subject/html` |
| Booking confirmed | `fabe39f6-5d8b-46ea-87f3-976ccb733e9b` | action `bookings` create + update, payload `status = confirmed` | waits 5 s, re-reads, still-confirmed rows only → student (lesson, when_label, "Meet link will be emailed", cutoff policy, `/account`, `/contact` + no-show line) + Shaun (student, notes, admin link). The wait lets the credit/reschedule routes' immediate undo (`credit_overspent`, `reschedule_conflict`) land first. |
| Meet link added | `e030cb7b-4075-4446-bfd7-33f91eef564b` | action `bookings` update, payload has non-empty `meet_link` | student gets the link (confirmed bookings only) |
| Booking cancelled | `1eb66656-8ba3-4b6e-8422-7ac19227af61` | action `bookings` update, payload `status = cancelled` | student + Shaun. Silent for `cancel_reason` in `hold_expired`, `released`, `credit_overspent`, `reschedule_conflict`. `rescheduled` sends a "moved" note, and the new booking's confirmation follows separately. |
| Pack purchased | `2c1e65b8-d913-4a5a-b8d9-ff787ad6186d` | action `lesson_credits` create | Shaun only. Skipped for refund credits (`pack = null`). If `pack.requires_phone`: student phone + "add to the Composition Mentorship WhatsApp group". |
| Order needs attention | `30bf99c8-a877-4797-991e-3ecec3271ec2` | action `orders` update, payload `needs_attention = true` | Shaun: order id, status, buyer email, notes, `https://content.shaunevans.com/admin/content/orders/<id>` |
| Booking upkeep | `e197fdb0-f2e4-4017-9971-4a1fb8cff260` | schedule `0 */15 * * * *`, accountability `activity` | 1) `held` + `hold_expires_at < $NOW` → `cancelled`, `cancel_reason hold_expired`, `cancelled_at`. 2) `confirmed` + `end_at < $NOW` → `completed`. 3) `lesson_credits` `active` + `expires_at < $NOW` → `expired`. 4) 24 h reminder: `confirmed`, `start_at <= $NOW(+24 hours)`, `start_at > $NOW`, `reminder_email_sent_at` null → stamp `reminder_email_sent_at` **then** send. Stamping first means a mail failure can't cause a resend every 15 min. Steps 1–3 chain on both resolve and reject, so one failure doesn't block the rest. All bulk updates use `emitEvents: false`, so no notification flow fires. |

Studio: `https://content.shaunevans.com/admin/settings/flows/<id>`.

Known edge: an admin cancelling a still-`held` booking without a silent reason gets the cancellation email, because the action event can't see the previous status. SMS reminders (2 h, `sms_opt_in`) are not part of these flows.

### ICS feed

`GET /api/calendar/bookings.ics?token=<BOOKINGS_ICS_TOKEN>` (`src/pages/api/calendar/bookings.ics.ts`) serves confirmed bookings from −30 days to the booking horizon, plus open availability blocks (`TRANSP:TRANSPARENT`) unless `&blocks=0`. A wrong or missing token returns 404. The token is compared with `timingSafeEqual` over SHA-256 digests and read from `process.env` at runtime. It is set in local `.env` and in Coolify app `shaunevans-com-new` (runtime only). Shaun adds the URL in Google Calendar → Other calendars → From URL.
