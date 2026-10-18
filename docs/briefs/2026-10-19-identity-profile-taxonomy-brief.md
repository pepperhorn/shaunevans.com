# Brief: unique identities, music-taste profiles, phone OTP, and a public taxonomy API

**For:** an implementing agent working across `ph-connect`, `directus-otp-auth` and `shaunevans.com` (se-cms).
**Owner:** Shaun Evans · **Date:** 2026-10-19
**Start with:** `superpowers:brainstorming`, then write a spec and plan per workstream before touching code. Work each repo on its own `claude/<topic>` branch. Do not change production data without a dry-run and a written go-ahead.

---

## 1. Context (read first)

- **ph-connect is the source of truth** for people and the music catalogue: instruments (92 pickable, grouped by family — see `schema/instrument-taxonomy-v1.json`), grooves (21), styles (15), genres (92), eras, and artists (230 published). Its preference store today is only `follows` (artists, genres). See `schema/account-prefs-v1.json`.
- **ph-connect emails are not unique.** Duplicate rows exist.
- **ph-connect onboarding** asks only for name, country and organisation. The instrument and taste steps are designed but not built.
- **`directus-otp-auth`** (`/home/shaun/directus-otp-auth`, read `SPEC.md` in full) is **email-only** (§1). It already supports cross-instance account linking with a global person id (§6a). That linking is built but switched on nowhere. It never compares emails (INV-22), and the global id never leaves server-to-server responses (INV-21).
- **se-cms** (`content.shaunevans.com`) has an app-level `users` collection. shaunevans.com signs people in through the extension at `/otp-auth` (slug `shaunevans`).
- **SMS:** the booking plan (`docs/superpowers/plans/2026-10-18-lesson-booking-calendar.md`, Task 12) already introduces AWS SNS for reminders. Reuse that provider.

## 2. Outcomes

1. Every person has **one account per system**. Emails are unique, and so are phone numbers once added.
2. A person can sign in with **email or mobile**, each verified by a one-time code.
3. A shaunevans.com account and a ph-connect account can be **linked** once, safely, so the person is never asked for their profile twice.
4. A **taste profile** with Spotify/YouTube-style onboarding: instruments (with level), genres, styles, grooves, scenes and artists. It is stored once in ph-connect and editable from either site.
5. A **public, versioned, structured endpoint** that shares our taxonomy (the category items, not anyone's personal data) with third parties.

## 3. Workstreams

### A. Unique emails (ph-connect, then se-cms)

1. **Audit first.** Report duplicate groups by `lower(trim(email))` with row counts, linked orders, licences and follows. Do not change anything at this step.
2. **Normalise:** trim and lowercase. Do **not** strip Gmail dots or `+tags`; they can be different mailboxes.
3. **Resolve duplicates through a merge queue.** Never merge automatically. Pick a survivor per group by rule (verified, most recent login, has purchases), and re-point foreign keys in one transaction per group. Keep a reversible audit row. Shaun approves the queue before it runs.
4. **Enforce it** with a unique index on the normalised email: a generated `email_normalized` column, or a unique index on `lower(email)`. Add validation in Directus, and handle the unique-violation error in every create path (sign-up, checkout, admin).
5. **se-cms `users`:** apply the same normalisation and unique index. Verify there are no duplicates before adding the index.
6. **Acceptance:** creating a second account with `Foo@X.com ` when `foo@x.com` exists fails cleanly, on both systems.

### B. Phone number as a second sign-in identifier (OTP extension and both hosts)

1. **Extension: add an SMS channel** behind configuration (`OTP_AUTH_CHANNELS=email,sms`; email stays the default). Make it a design change to `SPEC.md` first, then code. Write decision-log entries for:
   - the request shape (`{ email } | { phone }`, exactly one);
   - an SMS `Transport` interface with an SNS implementation;
   - per-phone **and** per-IP rate limits, plus a daily per-country spend cap (SMS fraud, also called "SMS pumping", is the real risk);
   - a country allowlist (default `AU,NZ,GB,US,CA,IE`);
   - an SMS body that includes the code and the domain, for WebOTP: `@shaunevans.com #123456`;
   - the same uniform `{ ok: true }` response, so it never reveals whether an account exists.
2. **Normalisation, done on both sides; the server decides.**
   - **Client:** a shadcn phone input built on `libphonenumber-js` (e.g. `omeralpi/shadcn-phone-input`, which wraps `react-phone-number-input`). Default the country from the account's country, then the browser locale; fall back to AU.
   - **Server:** re-parse with `libphonenumber-js` (`parsePhoneNumberWithError(raw, defaultCountry)`). Require `isValid()` and type `MOBILE` or `FIXED_LINE_OR_MOBILE`. Store **E.164** (`+61412345678`) plus `phone_country` (ISO-3166 alpha-2). Never store the raw input as the key.
3. **Host schema** (ph-connect account and se-cms `users`): `phone_e164` (unique where not null), `phone_country`, `phone_verified_at`. A phone becomes usable for sign-in only after it is verified with a code **while already signed in**. Adding a phone requires an active session.
4. **Principal lookup:** the extension's `PrincipalStore` gains `findByPhone`, which reads only verified phones and keeps the multi-principal ambiguity check.
5. **Acceptance:**
   - `0412 345 678` (AU), `+61 412 345 678` and `61412345678` all resolve to one row.
   - An unverified phone cannot sign in.
   - Rate limits and the spend cap hold under a scripted burst.

### C. Linking a shaunevans.com account to ph-connect (OTP extension §6a)

1. **Switch on §6a** on both instances, following its upgrade order: apply `schema/003`, add the host columns (global id, linked-at, handle), add the freeze trigger, deploy, and only then set `OTP_AUTH_LINK_SECRET` / `_ISSUER` / `_PEERS`.
2. **UX:** a "Connect your PepperHorn account" button on `/account`. The flow is intent on se → consent page on ph-connect ("Allow shaunevans.com to link to your account?") → ticket → redeem → confirm on se, showing the ph-connect handle.
3. **Email or phone is how the person proves who they are on each side (by OTP), never how accounts are matched.** Do not auto-link because an email or phone matches; that breaks INV-22 and is how accounts get joined to the wrong person. Matching identifiers may only drive a *suggestion* ("Looks like you have a PepperHorn account — connect it?"), and only after sign-in on se, without revealing the other account's details.
4. **Conflicts** (both sides already linked to different ids) go to `identity_merge_queue` for Shaun to resolve by hand.
5. **Acceptance:** the §6a attack scenarios in the SPEC decision log are covered by tests on both hosts. The global id appears in no browser response, URL or log.

### D. Taste profile (ph-connect schema + shared onboarding UI)

1. **New taxonomy: `scene`.** This means local or subcultural scenes (e.g. "Melbourne jazz", "UK grime", "New Orleans brass"). It optionally links to a country/city and to genres. Create it in ph-connect alongside the existing lists.
2. **A single preference store** in ph-connect that replaces or extends `follows`:
   ```
   profile_preference(
     id, person_gid uuid, kind enum(instrument|genre|style|groove|scene|era|artist),
     item_id, weight smallint null,         -- affinity 1–3 (like / love / core)
     level enum(beginner|intermediate|advanced|professional) null,  -- instruments only
     is_primary bool default false,          -- one primary instrument
     source_app text, created_at, updated_at,
     unique(person_gid, kind, item_id)
   )
   ```
   - Key the table by the **global person id**, so either site can write for a linked person.
   - Migrate existing `follows` rows into it, and keep a compatibility view if anything reads `follows`.
3. **Onboarding flow** (Spotify/YouTube style), in this order:
   1. **Instruments:** grouped by family, multi-select, then a level and "primary" for each choice.
   2. **Genres:** a chip grid, minimum 3, skippable.
   3. **Styles and grooves:** chips, filtered by the genres chosen.
   4. **Scenes:** optional, with suggestions from the person's country and genres.
   5. **Artists:** a bubble/avatar grid seeded from the genres and styles chosen, with search. Picking an artist loads related artists ("more like this"). Suggest at least 3, but don't require them.
   6. **Done:** a summary, and "edit any time in your profile".
   - Every step can be skipped and resumed. Save progress after each step.
   - Build it as **one React package or component set** used by both ph-connect and shaunevans.com (match each site's own typography), so the flow is literally the same.
4. **Profile editing** at `/account/profile` on shaunevans.com, and in ph-connect's account area.
5. **Acceptance:** a person who completes onboarding on either site is not prompted again on the other once linked. An edit on one site shows on the other within one request.

### E. Keeping se-cms and ph-connect in sync

- **Taxonomy:**
  - se-cms keeps a **read-only mirror** (`taxonomy_item`: `ph_id`, `kind`, `slug`, `label`, `parent_ph_id`, `status`, `updated_at`).
  - It is filled by a scheduled flow (nightly, plus on demand) from the endpoint in workstream F, using `?since=`.
  - se-cms never edits labels. Items deprecated upstream get `status=deprecated` and are never deleted.
- **Preferences:**
  - **Linked people:** shaunevans.com reads and writes `profile_preference` in ph-connect **server-side**, with a scoped service token and the global id. se-cms keeps no copy beyond a short cache.
  - **Unlinked people:** stored in se-cms `user_preference` with the same shape, keyed by `ph_id`. When the person links, push them to ph-connect: union with existing rows, and on conflict keep the higher weight. Then clear the local rows.
- **Failure mode:** if ph-connect is down, the profile page shows the cached data read-only, and onboarding saves locally and retries.

### F. Public taxonomy endpoint for third parties (ph-connect)

1. **Routes** (a Directus endpoint extension, e.g. `/taxonomy`):
   - `GET /taxonomy/v1` returns an index: kinds, counts, `updated_at`, licence, and schema URL.
   - `GET /taxonomy/v1/{kind}` returns `instruments | genres | styles | grooves | scenes | eras | artists`. It supports `?since=<iso>`, `?status=active|all`, `?lang=` and cursor pagination.
   - `GET /taxonomy/v1/{kind}/{slug}` returns a single item.
2. **Item shape** (stable, documented with a JSON Schema published at `/taxonomy/v1/schema.json`):
   ```json
   {
     "id": "ph:genre:7f3c…",          // stable, never reused
     "slug": "hard-bop",
     "kind": "genre",
     "label": "Hard bop",
     "labels": { "en": "Hard bop" },
     "aliases": ["hardbop"],
     "parent": "ph:genre:…",           // or null; instruments use family
     "related": ["ph:style:…"],
     "external_ids": { "musicbrainz": "…", "wikidata": "Q…", "discogs": "…" },
     "status": "active",               // active | deprecated
     "replaced_by": null,
     "updated_at": "2026-10-19T00:00:00Z"
   }
   ```
3. **Formats:** the default is `application/json`. Also offer `?format=jsonld`, as **SKOS** JSON-LD (`skos:Concept`, `prefLabel`, `altLabel`, `broader`, `related`, `exactMatch` for external ids). This is the standard way to share a controlled vocabulary.
4. **Operations:**
   - `ETag` / `Last-Modified` and `Cache-Control: public, max-age=3600`;
   - CORS open for GET;
   - an API key is optional (higher rate limit with a key), with rate limits applied per key and per IP;
   - publish a `CHANGELOG` and a licence decision (see open questions);
   - breaking changes go only in `/v2`.
5. **Hard boundary:** this endpoint serves **category items only**. Sharing any *person's* profile with a third party is out of scope. If it's wanted later, it needs explicit per-person consent and a scoped OAuth-style grant.
6. **Acceptance:**
   - the response validates against the published schema;
   - a `?since=` delta returns only changed and deprecated items;
   - se-cms's mirror sync (workstream E) runs entirely off this endpoint.

## 4. Order of work

1. A. Email audit and the merge queue proposal. Nothing is applied until Shaun approves.
2. F. Taxonomy endpoint, plus the `scene` taxonomy. These unblock E and D.
3. C. Linking switched on (an §6a deployment, little new code).
4. D. Preference store, then onboarding UI, then profile editing.
5. E. Sync (taxonomy mirror and preference write-through).
6. B. Phone/SMS channel (largest security surface; it lands after SNS is proven by the booking plan's Task 12).

## 5. Invariants: do not break

- Never match or merge accounts by email or phone string (INV-22). People prove ownership by OTP; accounts are linked by ticket.
- The global person id appears in no browser response, URL or log (INV-21).
- Every OTP request returns a uniform response, so nothing reveals whether an account exists.
- Phones are stored as E.164, are unique, and are verified before use.
- Taxonomy ids are permanent. Deprecate items; never delete or reuse them.
- `PUBLIC_*` env vars never carry write tokens.

## 6. Open questions for Shaun (ask before the spec is final)

1. **Licence for the public taxonomy:** CC BY 4.0 (open, attributed) or a custom terms-of-use with API keys required?
2. **Who curates the `scene` list:** seeded by us, or can artists and users suggest entries for moderation?
3. **Should phone sign-in be available to everyone, or only to people who opt in** (SMS costs money per code)?
4. **Is a preference public on a profile page, or always private?**
