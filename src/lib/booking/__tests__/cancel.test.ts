import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { POST as cancel } from "@/pages/api/bookings/[id]/cancel";
import { POST as reschedule } from "@/pages/api/bookings/[id]/reschedule";
import { POST as creditBook } from "@/pages/api/bookings/credit";
import { POST as hold } from "@/pages/api/bookings/hold";
import { POST as checkout } from "@/pages/api/checkout";
import { fulfillPaidOrder } from "@/lib/booking/fulfil";
import { getPaymentProvider } from "@/lib/payments";
vi.mock("@/lib/payments", () => ({ getPaymentProvider: vi.fn(() => { throw new Error("Square must not be instantiated for free checkout"); }) }));
import { getActiveCredits } from "@/lib/booking/repo";
import { getBookingsForUser, getLessonTimesByOrderItem } from "@/lib/bookings";
import { sydneyWallToUtc } from "@/lib/booking/time";

const H = 3_600_000;
const DAY = "2026-11-10"; // a Tuesday
const at = (hhmm: string) => sydneyWallToUtc(DAY, hhmm);
const iso = (ms: number) => new Date(ms).toISOString();
const USER = 7;

type Row = Record<string, unknown>;
type Collection = "bookings" | "lesson_credits" | "lessons" | "availability" | "orders" | "order_items";

const LESSONS: Row[] = [
  { id: 1, slug: "single-session", name: "Single Coaching Session", kind: "single", duration_minutes: 60, price: "90", requires_phone: false, status: "published" },
  { id: 2, slug: "four-pack", name: "Four-Pack", kind: "pack", duration_minutes: null, price: "320", requires_phone: false, status: "published" },
];

const TUESDAY_BLOCK: Row = {
  id: "a1",
  status: "published",
  entry_type: "available",
  recurrence: "weekly",
  day_of_week: 2,
  start_date: "2026-11-01",
  end_date: null,
  start_time: "18:00:00",
  end_time: "21:00:00",
};

/** Relational fields expanded when a `x.y` field is requested. */
const RELATIONS: Record<string, Record<string, Collection>> = {
  bookings: { lesson: "lessons" },
  lesson_credits: { lesson: "lessons", pack: "lessons" },
  order_items: { lesson: "lessons", booking: "bookings" },
};

let db: Record<Collection, Row[]>;
let seq = 0;
/** Runs just before a bookings insert lands (lets a test slip in a competing row). */
let beforeBookingInsert: (() => void) | null = null;
/** Number of upcoming POST /items/lesson_credits calls that answer 503. */
let failCreditPosts = 0;

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const masked500 = () =>
  new Response(JSON.stringify({ errors: [{ message: "An unexpected error occurred." }] }), { status: 500 });

function cmp(a: unknown, b: unknown): number {
  const da = typeof a === "string" ? Date.parse(a) : NaN;
  const dbv = typeof b === "string" ? Date.parse(b) : NaN;
  if (Number.isFinite(da) && Number.isFinite(dbv)) return da - dbv;
  return Number(a) - Number(b);
}

function matches(row: Row, filter: Row | undefined): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "_and") return (cond as Row[]).every((f) => matches(row, f));
    if (key === "_or") return (cond as Row[]).some((f) => matches(row, f));
    const v = row[key];
    if (key === "lesson" && Object.keys(cond as Row).some((k) => !k.startsWith("_"))) {
      return matches(db.lessons.find((l) => l.id === v) ?? {}, cond as Row);
    }
    return Object.entries(cond as Row).every(([op, x]) => {
      switch (op) {
        case "_eq":
          return v === x;
        case "_in":
          return (x as unknown[]).includes(v);
        case "_lt":
          return v != null && cmp(v, x) < 0;
        case "_gt":
          return v != null && cmp(v, x) > 0;
        case "_null":
          return x ? v == null : v != null;
        default:
          throw new Error(`unsupported op ${op}`);
      }
    });
  });
}

function expand(coll: Collection, row: Row, fields: string | null): Row {
  const out = { ...row };
  for (const f of (fields ?? "").split(",")) {
    const [rel] = f.split(".");
    const target = RELATIONS[coll]?.[rel];
    if (f.includes(".") && target) out[rel] = db[target].find((r) => r.id === row[rel]) ?? null;
  }
  return out;
}

/** True when a held/confirmed booking's busy range overlaps [start, end) — the DB exclusion constraint. */
function overlaps(start: string, end: string): boolean {
  return db.bookings.some(
    (b) =>
      (b.status === "held" || b.status === "confirmed") &&
      cmp(b.busy_start, end) < 0 &&
      cmp(b.busy_end, start) > 0,
  );
}

function startDirectus() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Row) : undefined;
      const [, items, coll, id] = url.pathname.split("/") as [string, string, Collection | "globals", string?];
      if (items !== "items") throw new Error(`unmocked ${method} ${url.pathname}`);
      if (coll === "globals") return ok({});
      const rows = db[coll];
      if (!rows) throw new Error(`unmocked collection ${coll}`);

      if (method === "GET" && id) return ok(rows.find((r) => r.id === id) ?? null);
      if (method === "GET") {
        const filter = JSON.parse(url.searchParams.get("filter") ?? "null") as Row | undefined;
        const limit = Number(url.searchParams.get("limit") ?? "-1");
        let found = rows.filter((r) => matches(r, filter ?? undefined));
        if (url.searchParams.has("filter[order][_eq]")) found = found.filter((r) => r.order === url.searchParams.get("filter[order][_eq]"));
        if (limit > 0) found = found.slice(0, limit);
        return ok(found.map((r) => expand(coll, r, url.searchParams.get("fields"))));
      }
      if (method === "POST") {
        if (Array.isArray(body)) {
          const created = body.map((item) => ({ id: `${coll}-${++seq}`, ...item }));
          rows.push(...created);
          return ok(created);
        }
        if (coll === "lesson_credits" && failCreditPosts > 0) {
          failCreditPosts--;
          return new Response(JSON.stringify({ errors: [{ message: "Service Unavailable" }] }), { status: 503 });
        }
        if (coll === "bookings") {
          beforeBookingInsert?.();
          if (overlaps(body!.busy_start as string, body!.busy_end as string)) return masked500();
        }
        const row = { id: `${coll}-${++seq}`, ...(coll === "orders" ? { payment_provider: null, payment_session_id: null, payment_intent_id: null } : {}), ...body };
        rows.push(row);
        return ok({ id: row.id });
      }
      if (method === "PATCH" && id) {
        const row = rows.find((r) => r.id === id);
        if (!row) return new Response("{}", { status: 403 });
        Object.assign(row, body);
        return ok(coll === "orders" ? row : { id });
      }
      if (method === "PATCH") {
        const q = body!.query as { filter?: Row };
        const hit = rows.filter((r) => matches(r, q.filter));
        for (const r of hit) Object.assign(r, body!.data as Row);
        return ok(hit.map((r) => ({ id: r.id })));
      }
      throw new Error(`unmocked ${method} ${url.pathname}`);
    }),
  );
}

function booking(over: Row = {}): Row {
  const start = at("19:00");
  return {
    id: "bk-1",
    status: "confirmed",
    user: USER,
    lesson: 1,
    start_at: iso(start),
    end_at: iso(start + H),
    busy_start: iso(start),
    busy_end: iso(start + H),
    hold_expires_at: null,
    source: "purchase",
    credit: null,
    order: "order-1",
    order_item: "oi-1",
    visitor_timezone: "Australia/Sydney",
    when_label: "Tue 10 Nov 2026, 19:00–20:00 (Sydney)",
    ...over,
  };
}

function seed(bookings: Row[], credits: Row[] = []) {
  db = {
    bookings: bookings.map((b) => ({ ...b })),
    lesson_credits: credits.map((c) => ({ ...c })),
    lessons: LESSONS.map((l) => ({ ...l })),
    order_items: [{ id: "oi-1", unit_price: "90.00" }],
    availability: [TUESDAY_BLOCK],
    orders: [{ id: "order-1", user: USER, status: "paid", needs_attention: false, notes: "Paid via Square." }],
  };
}

function ctx(opts: { id?: string; body?: unknown; userId?: number | null }): APIContext {
  const user = opts.userId === null ? undefined : { id: opts.userId ?? USER, email: "s@example.com", name: null };
  return {
    params: { id: opts.id },
    request: new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.body ?? {}),
    }),
    session: { get: async () => user },
  } as unknown as APIContext;
}

const read = async (res: Response) => ({ status: res.status, body: (await res.json().catch(() => null)) as Row | null });
const bookingRow = (id: string) => db.bookings.find((b) => b.id === id)!;

beforeEach(() => {
  process.env.DIRECTUS_URL = "https://cms.test";
  process.env.DIRECTUS_TOKEN = "tok";
  seq = 0;
  beforeBookingInsert = null;
  failCreditPosts = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  startDirectus();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/bookings/:id/cancel", () => {
  it("cancel 25h before a paid single creates a 1-credit row", async () => {
    vi.setSystemTime(at("19:00") - 25 * H);
    seed([booking()]);

    const res = await read(await cancel(ctx({ id: "bk-1" })));

    expect(res.status).toBe(200);
    expect(bookingRow("bk-1")).toMatchObject({ status: "cancelled", cancelled_at: iso(Date.now()) });
    expect(db.lesson_credits).toHaveLength(1);
    const expiry = new Date(Date.now());
    expiry.setUTCMonth(expiry.getUTCMonth() + 12);
    expect(db.lesson_credits[0]).toMatchObject({
      user: USER,
      lesson: 1,
      pack: null,
      order_item: "oi-1",
      credits_total: 1,
      status: "active",
      expires_at: expiry.toISOString(),
    });
  });

  it("a refund credit that fails twice still cancels, flags the order and reports credit_pending", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([booking()]);
    failCreditPosts = 2;

    const res = await read(await cancel(ctx({ id: "bk-1" })));

    expect(res).toEqual({ status: 200, body: { ok: true, credit_id: null, credit_pending: true } });
    expect(bookingRow("bk-1").status).toBe("cancelled");
    expect(db.lesson_credits).toHaveLength(0);
    expect(db.orders[0]).toMatchObject({
      needs_attention: true,
      notes: "Paid via Square.\nRefund credit for booking bk-1 could not be created — add 1 credit by hand.",
    });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("bk-1 (order_item oi-1)"), expect.anything());
  });

  it("a refund credit that fails once is retried and created", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([booking()]);
    failCreditPosts = 1;

    const res = await read(await cancel(ctx({ id: "bk-1" })));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, credit_id: db.lesson_credits[0].id });
    expect(db.lesson_credits).toHaveLength(1);
    expect(db.orders[0].needs_attention).toBe(false);
  });

  it("cancel 23h before returns too_late", async () => {
    vi.setSystemTime(at("19:00") - 23 * H);
    seed([booking()]);

    const res = await read(await cancel(ctx({ id: "bk-1" })));

    expect(res).toEqual({ status: 409, body: { error: "too_late" } });
    expect(bookingRow("bk-1").status).toBe("confirmed");
    expect(db.lesson_credits).toHaveLength(0);
  });

  it("cancel of a credit booking frees the credit (remaining +1)", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    const credit = { id: "cr-1", status: "active", user: USER, lesson: 1, pack: 2, order_item: "oi-9", credits_total: 4, expires_at: "2027-11-01T00:00:00.000Z" };
    seed(
      [
        booking({ source: "credit", credit: "cr-1", order: null, order_item: null }),
        booking({ id: "bk-2", source: "credit", credit: "cr-1", order: null, order_item: null, start_at: iso(at("19:00") + 7 * 24 * H), end_at: iso(at("20:00") + 7 * 24 * H), busy_start: iso(at("19:00") + 7 * 24 * H), busy_end: iso(at("20:00") + 7 * 24 * H) }),
      ],
      [credit],
    );
    expect((await getActiveCredits(USER))[0].remaining).toBe(2);

    const res = await read(await cancel(ctx({ id: "bk-1" })));

    expect(res.status).toBe(200);
    expect((await getActiveCredits(USER))[0].remaining).toBe(3);
    expect(db.lesson_credits).toHaveLength(1); // no refund credit for a credit booking
  });

  it("cancelling an already-cancelled booking returns 409 and creates no second credit", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([booking()]);

    expect((await cancel(ctx({ id: "bk-1" }))).status).toBe(200);
    const again = await read(await cancel(ctx({ id: "bk-1" })));

    expect(again).toEqual({ status: 409, body: { error: "not_confirmed" } });
    expect(db.lesson_credits).toHaveLength(1);
  });

  it("forbids cancelling someone else's booking", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([booking({ user: 99 })]);

    expect((await cancel(ctx({ id: "bk-1" }))).status).toBe(403);
    expect(bookingRow("bk-1").status).toBe("confirmed");
  });
});

describe("POST /api/bookings/:id/reschedule", () => {
  const body = (hhmm: string) => ({ start_at: iso(at(hhmm)), visitor_tz: "Europe/London" });

  it("reschedule to a taken time leaves the original booking confirmed", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([booking(), booking({ id: "other", user: 42, start_at: iso(at("20:00")), end_at: iso(at("21:00")), busy_start: iso(at("20:00")), busy_end: iso(at("21:00")) })]);

    const res = await read(await reschedule(ctx({ id: "bk-1", body: body("20:00") })));

    expect(res.status).toBe(422);
    expect(bookingRow("bk-1").status).toBe("confirmed");
    expect(db.bookings).toHaveLength(2);
  });

  it("reschedule losing an insert race returns slot_taken and keeps the original", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([booking()]);
    beforeBookingInsert = () => {
      beforeBookingInsert = null;
      db.bookings.push(booking({ id: "racer", user: 42, start_at: iso(at("20:00")), end_at: iso(at("21:00")), busy_start: iso(at("20:00")), busy_end: iso(at("21:00")) }));
    };

    const res = await read(await reschedule(ctx({ id: "bk-1", body: body("20:00") })));

    expect(res).toEqual({ status: 409, body: { error: "slot_taken" } });
    expect(bookingRow("bk-1").status).toBe("confirmed");
  });

  it("moves the booking, keeping source/credit/order/order_item, and cancels the original", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([booking({ meet_link: "https://meet.google.com/abc", student_notes: "Bring the Coltrane chart" })]);

    const res = await read(await reschedule(ctx({ id: "bk-1", body: body("20:00") })));

    expect(res.status).toBe(201);
    const moved = bookingRow(res.body!.booking_id as string);
    expect(moved).toMatchObject({
      status: "confirmed",
      start_at: iso(at("20:00")),
      source: "purchase",
      credit: null,
      order: "order-1",
      order_item: "oi-1",
      user: USER,
      lesson: 1,
      meet_link: "https://meet.google.com/abc",
      student_notes: "Bring the Coltrane chart",
    });
    expect(res.body!.when_label).toBe(moved.when_label);
    expect(bookingRow("bk-1")).toMatchObject({ status: "cancelled", cancel_reason: "rescheduled" });
    expect(db.lesson_credits).toHaveLength(0);
  });

  it("reschedules a fully-used credit booking without tripping the overspend guard", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    const credit = { id: "cr-1", status: "active", user: USER, lesson: 1, pack: null, order_item: "oi-1", credits_total: 1, expires_at: "2027-11-01T00:00:00.000Z" };
    seed([booking({ source: "credit", credit: "cr-1", order: null, order_item: null })], [credit]);

    const res = await read(await reschedule(ctx({ id: "bk-1", body: body("20:00") })));

    expect(res.status).toBe(201);
    expect(bookingRow(res.body!.booking_id as string)).toMatchObject({ status: "confirmed", source: "credit", credit: "cr-1" });
    expect(bookingRow("bk-1").status).toBe("cancelled");
  });

  it("refuses inside the cutoff", async () => {
    vi.setSystemTime(at("19:00") - 23 * H);
    seed([booking()]);

    const res = await read(await reschedule(ctx({ id: "bk-1", body: body("20:00") })));

    expect(res).toEqual({ status: 409, body: { error: "too_late" } });
    expect(db.bookings).toHaveLength(1);
  });
});

describe("R7 guards", () => {
  it("credit double-spend: the over-limit booking is cancelled and 409 no_credits returned", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    const credit = { id: "cr-1", status: "active", user: USER, lesson: 1, pack: 2, order_item: "oi-9", credits_total: 1, expires_at: "2027-11-01T00:00:00.000Z" };
    seed([], [credit]);
    // A parallel request spends the last credit after our remaining-check but before our insert.
    beforeBookingInsert = () => {
      beforeBookingInsert = null;
      db.bookings.push(booking({ id: "parallel", source: "credit", credit: "cr-1", order: null, order_item: null, start_at: iso(at("18:00")), end_at: iso(at("19:00")), busy_start: iso(at("18:00")), busy_end: iso(at("19:00")) }));
    };

    const res = await read(await creditBook(ctx({ body: { credit_id: "cr-1", start_at: iso(at("20:00")), visitor_tz: "Australia/Sydney" } })));

    expect(res).toEqual({ status: 409, body: { error: "no_credits" } });
    const mine = db.bookings.find((b) => b.id !== "parallel")!;
    expect(mine).toMatchObject({ status: "cancelled", cancel_reason: "credit_overspent" });
  });

  it("caps live holds at 4 per user with 429 too_many_holds", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    const live = iso(Date.now() + 10 * 60_000);
    const holds = [0, 1, 2, 3].map((i) =>
      booking({ id: `h${i}`, status: "held", hold_expires_at: live, start_at: iso(at("19:00") + (i + 1) * 7 * 24 * H), end_at: iso(at("20:00") + (i + 1) * 7 * 24 * H), busy_start: iso(at("19:00") + (i + 1) * 7 * 24 * H), busy_end: iso(at("20:00") + (i + 1) * 7 * 24 * H) }),
    );
    seed(holds);

    const res = await read(await hold(ctx({ body: { lesson_slug: "single-session", start_at: iso(at("19:00")), visitor_tz: "Australia/Sydney" } })));

    expect(res).toEqual({ status: 429, body: { error: "too_many_holds" } });
    expect(db.bookings).toHaveLength(4);
  });

  it("an expired hold does not count toward the cap", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    const live = iso(Date.now() + 10 * 60_000);
    const holds = [0, 1, 2, 3].map((i) =>
      booking({ id: `h${i}`, status: "held", hold_expires_at: i === 0 ? iso(Date.now() - 60_000) : live, start_at: iso(at("19:00") + (i + 1) * 7 * 24 * H), end_at: iso(at("20:00") + (i + 1) * 7 * 24 * H), busy_start: iso(at("19:00") + (i + 1) * 7 * 24 * H), busy_end: iso(at("20:00") + (i + 1) * 7 * 24 * H) }),
    );
    seed(holds);

    const res = await hold(ctx({ body: { lesson_slug: "single-session", start_at: iso(at("19:00")), visitor_tz: "Australia/Sydney" } }));

    expect(res.status).toBe(201);
  });
});

describe("account views", () => {
  const shifted = (id: string, hours: number, over: Row = {}) => {
    const s = at("19:00") + hours * H;
    return booking({ id, start_at: iso(s), end_at: iso(s + H), busy_start: iso(s), busy_end: iso(s + H), ...over });
  };

  it("splits upcoming/past, flags self-manage by the cutoff, and drops cancelled rows", async () => {
    vi.setSystemTime(at("19:00") - 23 * H);
    seed([
      shifted("soon", 0, { meet_link: "https://meet.google.com/abc" }),
      shifted("later", 7 * 24),
      shifted("done", -7 * 24, { status: "completed" }),
      shifted("gone", 24, { status: "cancelled" }),
      shifted("not-mine", 48, { user: 99 }),
    ]);

    const { upcoming, past } = await getBookingsForUser(USER);

    expect(upcoming.map((b) => [b.id, b.canSelfManage])).toEqual([["soon", false], ["later", true]]);
    expect(upcoming[0]).toMatchObject({ lessonName: "Single Coaching Session", lessonSlug: "single-session", meetLink: "https://meet.google.com/abc" });
    expect(past.map((b) => b.id)).toEqual(["done"]);
  });

  it("labels a lesson order line with its live booking, not the cancelled original", async () => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([
      shifted("old", 0, { status: "cancelled", when_label: "OLD" }),
      shifted("new", 24, { when_label: "NEW" }),
      shifted("lapsed", 0, { status: "cancelled", order_item: "oi-2", when_label: "LAPSED" }),
    ]);

    expect(await getLessonTimesByOrderItem(USER)).toEqual({ "oi-1": "NEW", "oi-2": "LAPSED (cancelled)" });
  });
});

const freeLesson = { id: 9, slug: "bws-consultation", name: "Build with Shaun consultation", kind: "single", duration_minutes: 30, price: "0", requires_phone: false, status: "published" };
const holdFree = () => hold(ctx({ body: { lesson_slug: "bws-consultation", start_at: iso(at("18:00")), visitor_tz: "Australia/Sydney" } }));

describe("free session policy", () => {
  beforeEach(() => {
    vi.setSystemTime(at("19:00") - 48 * H);
    seed([]);
    db.lessons.push({ ...freeLesson });
    vi.stubEnv("PUBLIC_SITE_URL", "https://site.test");
    vi.mocked(getPaymentProvider).mockClear();
  });

  it("checks out a real held free session through orders and shared fulfilment, idempotently", async () => {
    const held = await read(await holdFree());
    const bookingId = String(held.body!.booking_id);
    const cart = { items: [{ kind: "lesson_booking", booking_id: bookingId }] };
    const first = await read(await checkout(ctx({ body: cart })));
    expect(first).toMatchObject({ status: 200, body: { ok: true } });
    const orderId = first.body!.order_id as string;
    expect(first.body!.redirect_url).toBe(`https://site.test/shop/orders/${orderId}/confirmation`);
    expect(bookingRow(bookingId)).toMatchObject({ status: "confirmed", hold_expires_at: null, order: orderId });
    const created = db.orders.find((o) => o.id === orderId)!;
    expect(created).toMatchObject({ status: "paid", total: "0.00", tax: "0.00", payment_provider: null, payment_session_id: null, payment_intent_id: null });
    const orderCount = db.orders.length;
    const lineCount = db.order_items.length;
    expect(await read(await checkout(ctx({ body: cart })))).toMatchObject({ status: 200, body: { order_id: orderId } });
    expect(await fulfillPaidOrder(orderId)).toEqual({ confirmed: [], credits: [], attention: [] });
    expect(db.orders).toHaveLength(orderCount);
    expect(db.order_items).toHaveLength(lineCount);
    expect(db.lesson_credits).toHaveLength(0);
    expect(getPaymentProvider).not.toHaveBeenCalled();
    expect(await read(await cancel(ctx({ id: bookingId })))).toMatchObject({ status: 200, body: { credit_id: null } });
    expect(db.lesson_credits).toHaveLength(0);
  });

  it("holds an unlisted published free lesson normally", async () => {
    expect((await holdFree()).status).toBe(201);
    expect(db.bookings).toHaveLength(1);
    expect(db.bookings[0]).toMatchObject({ lesson: 9, status: "held" });
  });

  it.each(["held", "confirmed"])("rejects another booking of the same free type when an existing %s one is live", async (status) => {
    db.lessons.push({ ...freeLesson, id: 10, slug: "other-free" });
    db.bookings.push(booking({ lesson: 9, status, hold_expires_at: iso(Date.now() + H) }));
    expect(await read(await holdFree())).toMatchObject({ status: 409, body: { error: "free_booking_limit" } });
    expect(db.bookings).toHaveLength(1);
  });

  it.each([
    { status: "held", hold_expires_at: "2020-01-01T00:00:00Z" },
    { status: "confirmed", start_at: "2020-01-01T00:00:00Z" },
    { status: "cancelled" }, { status: "completed" }, { status: "no_show" },
  ])("ignores inactive free bookings: %j", async (over) => {
    db.bookings.push(booking({ lesson: 9, ...over }));
    expect((await holdFree()).status).toBe(201);
  });

  it("allows an intro and consultation at the same time, with separate per-type limits", async () => {
    db.lessons.push({ ...freeLesson, id: 10, slug: "intro-15", name: "Free 15-minute intro", duration_minutes: 15 });
    db.bookings.push(booking({ lesson: 10, status: "held", hold_expires_at: iso(Date.now() + H) }));
    expect((await holdFree()).status).toBe(201);
    expect(db.bookings.filter((b) => b.status === "held")).toHaveLength(2);
  });

  it("holds a 15-minute intro on the existing half-hour start grid with only 15 minutes occupied", async () => {
    db.lessons.push({ ...freeLesson, id: 10, slug: "intro-15", name: "Free 15-minute intro", duration_minutes: 15 });
    const result = await hold(ctx({ body: { lesson_slug: "intro-15", start_at: iso(at("18:30")), visitor_tz: "Australia/Sydney" } }));
    expect(result.status).toBe(201);
    expect(db.bookings[0]).toMatchObject({ start_at: iso(at("18:30")), end_at: iso(at("18:45")), busy_start: iso(at("18:30")), busy_end: iso(at("18:45")) });
  });

  it("rejects a 15-minute intro starting off the existing half-hour grid", async () => {
    db.lessons.push({ ...freeLesson, id: 10, slug: "intro-15", duration_minutes: 15 });
    const result = await hold(ctx({ body: { lesson_slug: "intro-15", start_at: iso(at("18:15")), visitor_tz: "Australia/Sydney" } }));
    expect(result.status).toBe(422);
    expect(db.bookings).toHaveLength(0);
  });

  it("paid bookings do not consume the free allowance", async () => {
    db.bookings.push(booking());
    expect((await holdFree()).status).toBe(201);
  });

  it("backs out when a competing free hold lands after the initial check", async () => {
    beforeBookingInsert = () => {
      beforeBookingInsert = null;
      db.bookings.push(booking({ id: "race", lesson: 9, status: "held", hold_expires_at: iso(Date.now() + H) }));
    };
    expect(await read(await holdFree())).toMatchObject({ status: 409, body: { error: "free_booking_limit" } });
    expect(db.bookings.filter((b) => b.status === "held")).toHaveLength(1);
    expect(db.bookings.find((b) => b.id !== "race")).toMatchObject({ status: "cancelled", cancel_reason: "free_booking_limit" });
  });

  it("reschedules a free session without consuming a second allowance", async () => {
    db.bookings.push(booking({ lesson: 9 }));
    const res = await reschedule(ctx({ id: "bk-1", body: { start_at: iso(at("18:00")), visitor_tz: "Australia/Sydney" } }));
    expect(res.status).toBe(201);
    expect(bookingRow("bk-1").status).toBe("cancelled");
    expect(db.bookings.filter((b) => b.status === "confirmed")).toHaveLength(1);
  });

  it("never grants a refund credit for a free line in a paid mixed order, even after repricing", async () => {
    db.bookings.push(booking({ lesson: 9 }));
    db.order_items[0].unit_price = "0.00";
    db.lessons.find((l) => l.id === 9)!.price = "100";
    expect(await read(await cancel(ctx({ id: "bk-1" })))).toMatchObject({ status: 200, body: { ok: true, credit_id: null } });
    expect(db.lesson_credits).toHaveLength(0);
  });

  it("preserves the refund credit for a paid purchase after the lesson becomes free", async () => {
    db.bookings.push(booking({ lesson: 9 }));
    expect((await cancel(ctx({ id: "bk-1" }))).status).toBe(200);
    expect(db.lesson_credits).toHaveLength(1);
  });

  it("rejects an unpublished consultation", async () => {
    db.lessons.find((l) => l.id === 9)!.status = "draft";
    expect((await holdFree()).status).toBe(422);
    expect(db.bookings).toHaveLength(0);
  });
});
