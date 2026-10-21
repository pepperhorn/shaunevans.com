/**
 * Server-only Directus data layer for the lesson booking calendar
 * (availability, bookings, lesson_credits, globals booking settings).
 * Uses DIRECTUS_TOKEN; never import from client code.
 */
import type { AvailabilityRow, Interval } from "./availability";
import { buildAvailabilityView, DEFAULT_SETTINGS, padInterval, type BookingSettings } from "./slots";
import { whenLabel } from "./policy";
import { addDaysIso, zonedParts, BOOKING_TZ } from "./time";
import { serverEnv } from "@/lib/env";

export type BookingStatus = "held" | "confirmed" | "cancelled" | "completed" | "no_show";

const MIN_MS = 60_000;

// ── Directus REST ───────────────────────────────────────────────────────────

function base(): string {
  const url = serverEnv("DIRECTUS_URL");
  if (!url) throw new Error("DIRECTUS_URL not set");
  return url.replace(/\/$/, "");
}

function token(): string {
  const t = serverEnv("DIRECTUS_TOKEN");
  if (!t) throw new Error("DIRECTUS_TOKEN not set");
  return t;
}

export class DirectusError extends Error {
  status: number;
  body: string;
  constructor(method: string, path: string, status: number, body: string) {
    super(`Directus ${method} ${path} failed: ${status} ${body}`);
    this.name = "DirectusError";
    this.status = status;
    this.body = body;
  }
}

/** Authenticated Directus REST call (shared with sibling server-only booking modules). */
export async function request<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  opts: { params?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${base()}${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new DirectusError(method, path, res.status, await res.text());
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as { data: T };
  return json.data;
}

const iso = (ms: number) => new Date(ms).toISOString();

// ── Settings ────────────────────────────────────────────────────────────────

type RawGlobals = Partial<{
  booking_min_notice_hours: number | null;
  booking_horizon_weeks: number | null;
  booking_padding_before_mins: number | null;
  booking_padding_after_mins: number | null;
  booking_hold_minutes: number | null;
  booking_slot_step_mins: number | null;
  booking_cancel_cutoff_hours: number | null;
  booking_notify_email: string | null;
}>;

/** `globals` booking_* fields → BookingSettings; any missing value (or a failed read) uses DEFAULT_SETTINGS. */
export async function getBookingSettings(): Promise<BookingSettings> {
  let g: RawGlobals;
  try {
    g = (await request<RawGlobals>("GET", "/items/globals")) ?? {};
  } catch (err) {
    console.warn("[booking] globals read failed, using defaults:", (err as Error).message);
    return { ...DEFAULT_SETTINGS };
  }
  const d = DEFAULT_SETTINGS;
  return {
    minNoticeHours: g.booking_min_notice_hours ?? d.minNoticeHours,
    horizonWeeks: g.booking_horizon_weeks ?? d.horizonWeeks,
    paddingBeforeMins: g.booking_padding_before_mins ?? d.paddingBeforeMins,
    paddingAfterMins: g.booking_padding_after_mins ?? d.paddingAfterMins,
    holdMinutes: g.booking_hold_minutes ?? d.holdMinutes,
    slotStepMins: g.booking_slot_step_mins ?? d.slotStepMins,
    cancelCutoffHours: g.booking_cancel_cutoff_hours ?? d.cancelCutoffHours,
    notifyEmail: g.booking_notify_email || d.notifyEmail,
  };
}

// ── Lessons ─────────────────────────────────────────────────────────────────

export type BookableLesson = {
  id: number;
  slug: string;
  name: string;
  kind: "single" | "pack" | "contact" | null;
  durationMinutes: number | null;
  price: number;
  requiresPhone: boolean;
};

type RawLesson = {
  id: number;
  slug: string;
  name: string;
  kind: BookableLesson["kind"];
  duration_minutes: number | null;
  price: number | string | null;
  requires_phone: boolean | null;
};

const LESSON_FIELDS = "id,slug,name,kind,duration_minutes,price,requires_phone";

function toLesson(l: RawLesson): BookableLesson {
  return {
    id: l.id,
    slug: l.slug,
    name: l.name,
    kind: l.kind,
    durationMinutes: l.duration_minutes,
    price: Number(l.price ?? 0),
    requiresPhone: l.requires_phone === true,
  };
}

/** Published lesson by slug, or null. */
export async function getLessonBySlug(slug: string): Promise<BookableLesson | null> {
  const rows = await request<RawLesson[]>("GET", "/items/lessons", {
    params: {
      filter: JSON.stringify({ slug: { _eq: slug }, status: { _eq: "published" } }),
      fields: LESSON_FIELDS,
      limit: "1",
    },
  });
  return rows[0] ? toLesson(rows[0]) : null;
}

export async function getLessonById(id: number): Promise<BookableLesson | null> {
  const rows = await request<RawLesson[]>("GET", "/items/lessons", {
    params: { filter: JSON.stringify({ id: { _eq: id } }), fields: LESSON_FIELDS, limit: "1" },
  });
  return rows[0] ? toLesson(rows[0]) : null;
}

// ── Availability + busy ─────────────────────────────────────────────────────

const hhmm = (t: string) => t.slice(0, 5); // Directus `time` → "HH:MM:SS"

/** Published availability rows, times normalised to "HH:MM". Notes are never fetched. */
export async function listAvailabilityRows(): Promise<AvailabilityRow[]> {
  const rows = await request<AvailabilityRow[]>("GET", "/items/availability", {
    params: {
      filter: JSON.stringify({ status: { _eq: "published" } }),
      fields: "id,entry_type,recurrence,day_of_week,start_date,end_date,start_time,end_time",
      limit: "-1",
    },
  });
  return rows.map((r) => ({ ...r, start_time: hhmm(r.start_time), end_time: hhmm(r.end_time) }));
}

type RawBusy = { status: BookingStatus; busy_start: string; busy_end: string; hold_expires_at: string | null };

/** Padded busy ranges overlapping [from, to): confirmed bookings + unexpired holds. */
export async function listBusy(from: number, to: number): Promise<Interval[]> {
  const now = Date.now();
  const rows = await request<RawBusy[]>("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({
        _and: [
          { busy_start: { _lt: iso(to) } },
          { busy_end: { _gt: iso(from) } },
          {
            _or: [
              { status: { _eq: "confirmed" } },
              { _and: [{ status: { _eq: "held" } }, { hold_expires_at: { _gt: iso(now) } }] },
            ],
          },
        ],
      }),
      fields: "status,busy_start,busy_end,hold_expires_at",
      sort: "busy_start",
      limit: "-1",
    },
  });
  // Re-check locally too: the instant may have moved on since Directus evaluated it.
  return rows
    .filter((r) => r.status === "confirmed" || (r.status === "held" && !!r.hold_expires_at && Date.parse(r.hold_expires_at) > now))
    .map((r) => ({ start: Date.parse(r.busy_start), end: Date.parse(r.busy_end) }));
}

/**
 * Cancel holds whose expiry has passed. The overlap constraint ignores
 * hold_expires_at, so this must run before every insert.
 */
export async function expireStaleHolds(): Promise<void> {
  const now = iso(Date.now());
  await request("PATCH", "/items/bookings", {
    body: {
      query: {
        filter: { _and: [{ status: { _eq: "held" } }, { hold_expires_at: { _lt: now } }] },
        limit: -1,
      },
      data: { status: "cancelled", cancelled_at: now, cancel_reason: "hold_expired" },
    },
  });
}

// ── Bookings ────────────────────────────────────────────────────────────────

export type HoldResult =
  | { ok: true; id: string; holdExpiresAt: string; whenLabel: string }
  | { ok: false; reason: "conflict" | "not_bookable" };

/**
 * Matches the exclusion violation if Directus passes the DB text through (constraint name or SQLSTATE).
 * se-cms (Directus 12.5) does NOT: it answers 500 INTERNAL_SERVER_ERROR "An unexpected error occurred.",
 * so createBooking falls back to overlapsLiveBooking().
 */
export function isOverlapError(err: unknown): boolean {
  if (!(err instanceof DirectusError)) return false;
  return /bookings_no_overlap|23P01/.test(err.body);
}

/** Whether any held/confirmed booking's busy range overlaps `busy` (used when Directus hides the DB error). */
async function overlapsLiveBooking(busy: Interval): Promise<boolean> {
  const rows = await request<Array<{ id: string }>>("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({
        _and: [
          { status: { _in: ["held", "confirmed"] } },
          { busy_start: { _lt: iso(busy.end) } },
          { busy_end: { _gt: iso(busy.start) } },
        ],
      }),
      fields: "id",
      limit: "1",
    },
  });
  return rows.length > 0;
}

export async function createBooking(input: {
  userId: number;
  lessonId: number;
  startAt: number;
  durationMins: number;
  status: "held" | "confirmed";
  source: "purchase" | "credit";
  creditId?: string;
  /** Order + line this booking belongs to (Task 8 re-occupy links the replacement row). */
  orderId?: string;
  orderItemId?: string;
  /** Carried over from the original on reschedule. */
  meetLink?: string | null;
  studentNotes?: string | null;
  visitorTz: string;
  settings: BookingSettings;
  /** Internal (Task 8 re-occupy of a paid-but-expired hold): skip the grid check; only the DB constraint decides. */
  skipAvailabilityCheck?: boolean;
}): Promise<HoldResult> {
  const { startAt, durationMins, settings } = input;
  const now = Date.now();
  await expireStaleHolds();

  const endAt = startAt + durationMins * MIN_MS;
  const busy = padInterval({ start: startAt, end: endAt }, settings);

  if (!input.skipAvailabilityCheck) {
    // Sydney day ±1 so overnight blocks (and busy spilling across midnight) are seen.
    const day = zonedParts(startAt, BOOKING_TZ).date;
    const fromDate = addDaysIso(day, -1);
    const toDate = addDaysIso(day, 1);
    const [rows, busyList] = await Promise.all([
      listAvailabilityRows(),
      listBusy(busy.start - 2 * 86_400_000, busy.end + 2 * 86_400_000),
    ]);
    const view = buildAvailabilityView({ rows, busy: busyList, fromDate, toDate, durationMins, settings, now });
    if (!view.starts.includes(startAt)) return { ok: false, reason: "not_bookable" };
  }

  const holdExpiresAt = input.status === "held" ? iso(now + settings.holdMinutes * MIN_MS) : null;
  const label = whenLabel(startAt, endAt, input.visitorTz);
  try {
    const created = await request<{ id: string }>("POST", "/items/bookings", {
      params: { fields: "id" },
      body: {
        status: input.status,
        user: input.userId,
        lesson: input.lessonId,
        start_at: iso(startAt),
        end_at: iso(endAt),
        busy_start: iso(busy.start),
        busy_end: iso(busy.end),
        hold_expires_at: holdExpiresAt,
        source: input.source,
        credit: input.creditId ?? null,
        order: input.orderId ?? null,
        order_item: input.orderItemId ?? null,
        ...(input.meetLink ? { meet_link: input.meetLink } : {}),
        ...(input.studentNotes ? { student_notes: input.studentNotes } : {}),
        visitor_timezone: input.visitorTz,
        when_label: label,
      },
    });
    return { ok: true, id: created.id, holdExpiresAt: holdExpiresAt ?? "", whenLabel: label };
  } catch (err) {
    if (isOverlapError(err)) return { ok: false, reason: "conflict" };
    // Directus may mask the 23P01 as a generic 500; confirm by looking for the overlapping row.
    if (err instanceof DirectusError && err.status >= 500 && (await overlapsLiveBooking(busy).catch(() => false)))
      return { ok: false, reason: "conflict" };
    throw err;
  }
}

export type BookingRecord = {
  id: string;
  status: BookingStatus;
  userId: number | null;
  lessonId: number | null;
  startAt: string;
  endAt: string;
  holdExpiresAt: string | null;
  source: "purchase" | "credit";
  creditId: string | null;
  orderId: string | null;
  orderItemId: string | null;
  meetLink: string | null;
  studentNotes: string | null;
  whenLabel: string | null;
};

export async function getBooking(id: string): Promise<BookingRecord | null> {
  const rows = await request<Array<Record<string, unknown>>>("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({ id: { _eq: id } }),
      fields: "id,status,user,lesson,start_at,end_at,hold_expires_at,source,credit,order,order_item,meet_link,student_notes,when_label",
      limit: "1",
    },
  });
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    status: r.status as BookingStatus,
    userId: (r.user as number | null) ?? null,
    lessonId: (r.lesson as number | null) ?? null,
    startAt: r.start_at as string,
    endAt: r.end_at as string,
    holdExpiresAt: (r.hold_expires_at as string | null) ?? null,
    source: r.source as BookingRecord["source"],
    creditId: (r.credit as string | null) ?? null,
    orderId: (r.order as string | null) ?? null,
    orderItemId: (r.order_item as string | null) ?? null,
    meetLink: (r.meet_link as string | null) || null,
    studentNotes: (r.student_notes as string | null) || null,
    whenLabel: (r.when_label as string | null) ?? null,
  };
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await request("PATCH", `/items/bookings/${encodeURIComponent(id)}`, {
    params: { fields: "id" },
    body: { ...extra, status },
  });
}

/**
 * Compare-and-set a confirmed booking to cancelled. Returns false when the row was no longer
 * `confirmed` (a parallel cancel/reschedule won), so callers never act twice on one booking.
 */
export async function cancelConfirmedBooking(id: string, reason: string): Promise<boolean> {
  const rows = await request<Array<{ id: string }>>("PATCH", "/items/bookings", {
    params: { fields: "id" },
    body: {
      query: { filter: { _and: [{ id: { _eq: id } }, { status: { _eq: "confirmed" } }] }, limit: 1 },
      data: { status: "cancelled", cancelled_at: iso(Date.now()), cancel_reason: reason },
    },
  });
  return Array.isArray(rows) && rows.some((r) => r.id === id);
}

/** Flag an order for Shaun: `needs_attention = true` and `note` appended to `orders.notes`. */
export async function flagOrderAttention(orderId: string, note: string): Promise<void> {
  const order = await request<{ notes: string | null }>("GET", `/items/orders/${encodeURIComponent(orderId)}`, {
    params: { fields: "notes" },
  });
  await request("PATCH", `/items/orders/${encodeURIComponent(orderId)}`, {
    params: { fields: "id" },
    body: { needs_attention: true, notes: [order?.notes ?? "", note].filter(Boolean).join("\n") },
  });
}

export type FeedBooking = {
  id: string;
  startAt: string;
  endAt: string;
  studentName: string | null;
  studentEmail: string | null;
  lessonName: string | null;
  meetLink: string | null;
  studentNotes: string | null;
};

/**
 * Bookings for Shaun's ICS feed starting in [from, to): `confirmed` plus `completed`, so lessons
 * stay on the calendar after the upkeep flow marks them completed. With student + lesson names.
 */
export async function listFeedBookings(from: number, to: number): Promise<FeedBooking[]> {
  const rows = await request<
    Array<{
      id: string;
      start_at: string;
      end_at: string;
      meet_link: string | null;
      student_notes: string | null;
      user: { name: string | null; email: string | null } | null;
      lesson: { name: string | null } | null;
    }>
  >("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({
        _and: [
          { status: { _in: ["confirmed", "completed"] } },
          { start_at: { _gte: iso(from) } },
          { start_at: { _lt: iso(to) } },
        ],
      }),
      fields: "id,start_at,end_at,meet_link,student_notes,user.name,user.email,lesson.name",
      sort: "start_at",
      limit: "-1",
    },
  });
  return rows.map((r) => ({
    id: r.id,
    startAt: r.start_at,
    endAt: r.end_at,
    studentName: r.user?.name || null,
    studentEmail: r.user?.email || null,
    lessonName: r.lesson?.name || null,
    meetLink: r.meet_link || null,
    studentNotes: r.student_notes || null,
  }));
}

/** The user's unexpired holds (the hold route caps these). */
export async function countLiveHolds(userId: number): Promise<number> {
  const now = Date.now();
  const rows = await request<Array<{ hold_expires_at: string | null }>>("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({
        _and: [{ user: { _eq: userId } }, { status: { _eq: "held" } }, { hold_expires_at: { _gt: iso(now) } }],
      }),
      fields: "hold_expires_at",
      limit: "-1",
    },
  });
  return rows.filter((r) => !!r.hold_expires_at && Date.parse(r.hold_expires_at) > now).length;
}

// ── Credits ─────────────────────────────────────────────────────────────────

/** Booking statuses that consume a credit. */
const CONSUMING: BookingStatus[] = ["held", "confirmed", "completed", "no_show"];

type RawCredit = {
  id: string;
  credits_total: number;
  expires_at: string | null;
  lesson: { id: number; name: string } | null;
  pack: { id: number; name: string } | null;
};

export type ActiveCredit = { id: string; packName: string; lessonId: number; remaining: number; expiresAt: string };

/** Owner of a credit row (null when it doesn't exist) — lets routes tell "not yours" from "used up". */
export async function getCreditOwner(creditId: string): Promise<number | null | undefined> {
  const rows = await request<Array<{ user: number | null }>>("GET", "/items/lesson_credits", {
    params: { filter: JSON.stringify({ id: { _eq: creditId } }), fields: "user", limit: "1" },
  });
  return rows[0] ? rows[0].user : undefined;
}

/** The user's usable credits: status active, not expired, with remaining > 0. */
export async function getActiveCredits(userId: number): Promise<ActiveCredit[]> {
  const now = Date.now();
  const credits = await request<RawCredit[]>("GET", "/items/lesson_credits", {
    params: {
      filter: JSON.stringify({ user: { _eq: userId }, status: { _eq: "active" } }),
      fields: "id,credits_total,expires_at,lesson.id,lesson.name,pack.id,pack.name",
      sort: "expires_at",
      limit: "-1",
    },
  });
  const live = credits.filter((c) => c.lesson && (!c.expires_at || Date.parse(c.expires_at) > now));
  if (live.length === 0) return [];

  const used = await request<Array<{ credit: string; status: BookingStatus }>>("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({ credit: { _in: live.map((c) => c.id) }, status: { _in: CONSUMING } }),
      fields: "credit,status",
      limit: "-1",
    },
  });
  const count = new Map<string, number>();
  for (const b of used) {
    if (CONSUMING.includes(b.status)) count.set(b.credit, (count.get(b.credit) ?? 0) + 1);
  }

  return live
    .map((c) => ({
      id: c.id,
      packName: c.pack?.name ?? c.lesson!.name,
      lessonId: c.lesson!.id,
      remaining: c.credits_total - (count.get(c.id) ?? 0),
      expiresAt: c.expires_at ?? "",
    }))
    .filter((c) => c.remaining > 0);
}

/**
 * Whether a credit is now booked beyond its total (two parallel credit bookings both passed the
 * remaining > 0 check). `excludeBookingId` leaves out a booking that is about to be cancelled
 * (the original of a reschedule).
 */
export async function isCreditOverspent(creditId: string, excludeBookingId?: string): Promise<boolean> {
  const credits = await request<Array<{ credits_total: number }>>("GET", "/items/lesson_credits", {
    params: { filter: JSON.stringify({ id: { _eq: creditId } }), fields: "credits_total", limit: "1" },
  });
  if (!credits[0]) return true;
  const used = await request<Array<{ id: string; status: BookingStatus }>>("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({ credit: { _eq: creditId }, status: { _in: CONSUMING } }),
      fields: "id,status",
      limit: "-1",
    },
  });
  const n = used.filter((b) => b.id !== excludeBookingId && CONSUMING.includes(b.status)).length;
  return n > credits[0].credits_total;
}

/**
 * One make-good credit for a cancelled paid single (pack null). Idempotent per order line:
 * returns the existing refund credit for `orderItemId` instead of adding a second one.
 */
export async function createRefundCredit(input: {
  userId: number;
  lessonId: number;
  orderItemId: string | null;
}): Promise<string> {
  if (input.orderItemId) {
    const existing = await request<Array<{ id: string }>>("GET", "/items/lesson_credits", {
      params: {
        filter: JSON.stringify({ order_item: { _eq: input.orderItemId }, pack: { _null: true } }),
        fields: "id",
        limit: "1",
      },
    });
    if (existing[0]) return existing[0].id;
  }
  const expires = new Date(Date.now());
  expires.setUTCMonth(expires.getUTCMonth() + 12);
  const created = await request<{ id: string }>("POST", "/items/lesson_credits", {
    params: { fields: "id" },
    body: {
      status: "active",
      user: input.userId,
      lesson: input.lessonId,
      pack: null,
      order_item: input.orderItemId,
      credits_total: 1,
      expires_at: expires.toISOString(),
    },
  });
  return created.id;
}
