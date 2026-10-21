import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBooking, getActiveCredits, listBusy, listFeedBookings } from "@/lib/booking/repo";
import { DEFAULT_SETTINGS } from "@/lib/booking/slots";
import { sydneyWallToUtc } from "@/lib/booking/time";

const H = 3_600_000;
const day = "2026-11-10"; // a Tuesday
const at = (hhmm: string) => sydneyWallToUtc(day, hhmm);
const NOW = at("18:00") - 72 * H;

type Call = { method: string; url: URL; body: unknown };
type Handler = (c: Call) => Response | undefined;

let calls: Call[] = [];

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

function mockDirectus(handler: Handler) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const c: Call = {
        method: init?.method ?? "GET",
        url: new URL(String(input)),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(c);
      const res = handler(c);
      if (!res) throw new Error(`unmocked ${c.method} ${c.url.pathname}`);
      return res;
    }),
  );
}

const tuesdayBlock = {
  id: "a1",
  entry_type: "available",
  recurrence: "weekly",
  day_of_week: 2,
  start_date: "2026-11-01",
  end_date: null,
  start_time: "18:00:00",
  end_time: "21:00:00",
};

/** Directus with one weekly Tue 18–21 block, no bookings; POST bookings answered by `onInsert`. */
const withBlock = (onInsert: () => Response): Handler => (c) => {
  const p = c.url.pathname;
  if (p === "/items/bookings" && c.method === "PATCH") return ok([]);
  if (p === "/items/availability") return ok([tuesdayBlock]);
  if (p === "/items/bookings" && c.method === "GET") return ok([]);
  if (p === "/items/bookings" && c.method === "POST") return onInsert();
  return undefined;
};

const baseInput = {
  userId: 7,
  lessonId: 1,
  durationMins: 60,
  status: "held" as const,
  source: "purchase" as const,
  visitorTz: "Australia/Sydney",
  settings: DEFAULT_SETTINGS,
};

beforeEach(() => {
  process.env.DIRECTUS_URL = "https://cms.test";
  process.env.DIRECTUS_TOKEN = "tok";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createBooking", () => {
  it("returns conflict when Directus rejects with 23P01", async () => {
    mockDirectus(
      withBlock(
        () =>
          new Response(
            JSON.stringify({
              errors: [
                {
                  message:
                    'conflicting key value violates exclusion constraint "bookings_no_overlap"',
                  extensions: { code: "INTERNAL_SERVER_ERROR" },
                },
              ],
            }),
            { status: 500 },
          ),
      ),
    );
    const res = await createBooking({ ...baseInput, startAt: at("19:00") });
    expect(res).toEqual({ ok: false, reason: "conflict" });
  });

  it("returns conflict when Directus masks the 23P01 as a generic 500 (live se-cms shape)", async () => {
    const masked = JSON.stringify({
      errors: [{ message: "An unexpected error occurred.", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
    });
    const base = withBlock(() => new Response(masked, { status: 500 }));
    mockDirectus((c) => {
      const isOverlapProbe = c.method === "GET" && c.url.pathname === "/items/bookings" && c.url.searchParams.get("fields") === "id";
      return isOverlapProbe ? ok([{ id: "winner" }]) : base(c);
    });
    const res = await createBooking({ ...baseInput, startAt: at("19:00") });
    expect(res).toEqual({ ok: false, reason: "conflict" });
  });

  it("rethrows a masked 500 when no overlapping booking exists", async () => {
    const masked = JSON.stringify({ errors: [{ message: "An unexpected error occurred." }] });
    mockDirectus(withBlock(() => new Response(masked, { status: 500 })));
    await expect(createBooking({ ...baseInput, startAt: at("19:00") })).rejects.toThrow(/500/);
  });

  it("returns not_bookable for a start outside availability", async () => {
    mockDirectus(withBlock(() => ok({ id: "should-not-insert" })));
    const res = await createBooking({ ...baseInput, startAt: at("21:00") });
    expect(res).toEqual({ ok: false, reason: "not_bookable" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("expires stale holds first, then inserts padded busy range, label and hold expiry", async () => {
    mockDirectus(withBlock(() => ok({ id: "b1" })));
    const res = await createBooking({ ...baseInput, startAt: at("19:00") });
    expect(res).toMatchObject({ ok: true, id: "b1", holdExpiresAt: new Date(NOW + 15 * 60_000).toISOString() });
    expect(calls[0].method).toBe("PATCH");
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      status: "held",
      user: 7,
      lesson: 1,
      source: "purchase",
      start_at: new Date(at("19:00")).toISOString(),
      end_at: new Date(at("20:00")).toISOString(),
      busy_start: new Date(at("19:00")).toISOString(),
      busy_end: new Date(at("20:00")).toISOString(),
      visitor_timezone: "Australia/Sydney",
      when_label: "Tue 10 Nov 2026, 19:00–20:00 (Sydney)",
    });
  });

  it("skipAvailabilityCheck lets the DB constraint decide alone", async () => {
    mockDirectus(withBlock(() => ok({ id: "b2" })));
    const res = await createBooking({
      ...baseInput,
      status: "confirmed",
      startAt: at("22:00"),
      skipAvailabilityCheck: true,
    });
    expect(res).toMatchObject({ ok: true, id: "b2" });
    const post = calls.find((c) => c.method === "POST")!;
    expect((post.body as Record<string, unknown>).hold_expires_at).toBeNull();
  });

  it("writes order / order_item when given, null otherwise", async () => {
    mockDirectus(withBlock(() => ok({ id: "b3" })));
    await createBooking({ ...baseInput, startAt: at("19:00"), orderId: "o-1", orderItemId: "oi-1" });
    await createBooking({ ...baseInput, startAt: at("20:00") });
    const posts = calls.filter((c) => c.method === "POST").map((c) => c.body as Record<string, unknown>);
    expect(posts[0]).toMatchObject({ order: "o-1", order_item: "oi-1" });
    expect(posts[1]).toMatchObject({ order: null, order_item: null });
  });
});

describe("getActiveCredits", () => {
  it("subtracts held/confirmed/completed/no_show bookings and hides expired", async () => {
    const future = new Date(NOW + 30 * 24 * H).toISOString();
    const past = new Date(NOW - H).toISOString();
    mockDirectus((c) => {
      if (c.url.pathname === "/items/lesson_credits")
        return ok([
          { id: "c1", credits_total: 4, expires_at: future, lesson: { id: 1, name: "Single" }, pack: { id: 2, name: "Four-Pack" } },
          { id: "c2", credits_total: 1, expires_at: future, lesson: { id: 1, name: "Single Coaching Session" }, pack: null },
          { id: "c3", credits_total: 4, expires_at: past, lesson: { id: 1, name: "Single" }, pack: { id: 2, name: "Four-Pack" } },
        ]);
      if (c.url.pathname === "/items/bookings")
        return ok([
          { credit: "c1", status: "held" },
          { credit: "c1", status: "confirmed" },
          { credit: "c1", status: "completed" },
          { credit: "c1", status: "no_show" },
          { credit: "c1", status: "cancelled" },
          { credit: "c2", status: "cancelled" },
        ]);
      return undefined;
    });
    const credits = await getActiveCredits(7);
    expect(credits).toEqual([
      { id: "c2", packName: "Single Coaching Session", lessonId: 1, remaining: 1, expiresAt: future },
    ]);
    // c1 is fully used (4 − 4 = 0), so it is hidden as well
  });

  it("reports remaining credits for a partly used pack", async () => {
    const future = new Date(NOW + 30 * 24 * H).toISOString();
    mockDirectus((c) => {
      if (c.url.pathname === "/items/lesson_credits")
        return ok([{ id: "c1", credits_total: 4, expires_at: future, lesson: { id: 1, name: "Single" }, pack: { id: 2, name: "Four-Pack" } }]);
      if (c.url.pathname === "/items/bookings")
        return ok([
          { credit: "c1", status: "confirmed" },
          { credit: "c1", status: "cancelled" },
        ]);
      return undefined;
    });
    expect(await getActiveCredits(7)).toEqual([
      { id: "c1", packName: "Four-Pack", lessonId: 1, remaining: 3, expiresAt: future },
    ]);
  });
});

describe("listBusy", () => {
  it("excludes expired holds", async () => {
    mockDirectus((c) => {
      if (c.url.pathname === "/items/bookings")
        return ok([
          { status: "confirmed", busy_start: new Date(at("18:00")).toISOString(), busy_end: new Date(at("19:00")).toISOString(), hold_expires_at: null },
          { status: "held", busy_start: new Date(at("19:00")).toISOString(), busy_end: new Date(at("20:00")).toISOString(), hold_expires_at: new Date(NOW + 60_000).toISOString() },
          { status: "held", busy_start: new Date(at("20:00")).toISOString(), busy_end: new Date(at("21:00")).toISOString(), hold_expires_at: new Date(NOW - 60_000).toISOString() },
        ]);
      return undefined;
    });
    const busy = await listBusy(at("00:00"), at("23:59"));
    expect(busy).toEqual([
      { start: at("18:00"), end: at("19:00") },
      { start: at("19:00"), end: at("20:00") },
    ]);
    const filter = calls[0].url.searchParams.get("filter")!;
    expect(filter).toContain("hold_expires_at");
  });
});

describe("listFeedBookings", () => {
  it("includes completed lessons so past bookings stay on the calendar", async () => {
    mockDirectus((c) =>
      c.url.pathname === "/items/bookings"
        ? ok([
            {
              id: "b1",
              start_at: "2026-10-20T08:00:00.000Z",
              end_at: "2026-10-20T09:00:00.000Z",
              meet_link: null,
              student_notes: null,
              user: { name: "Jo", email: "jo@example.com" },
              lesson: { name: "Single" },
            },
          ])
        : undefined,
    );
    const from = Date.UTC(2026, 9, 1);
    const to = Date.UTC(2026, 11, 31);
    const rows = await listFeedBookings(from, to);
    const filter = JSON.parse(calls[0].url.searchParams.get("filter")!);
    expect(filter._and).toContainEqual({ status: { _in: ["confirmed", "completed"] } });
    expect(filter._and).toContainEqual({ start_at: { _gte: new Date(from).toISOString() } });
    expect(filter._and).toContainEqual({ start_at: { _lt: new Date(to).toISOString() } });
    expect(rows).toEqual([
      {
        id: "b1",
        startAt: "2026-10-20T08:00:00.000Z",
        endAt: "2026-10-20T09:00:00.000Z",
        studentName: "Jo",
        studentEmail: "jo@example.com",
        lessonName: "Single",
        meetLink: null,
        studentNotes: null,
      },
    ]);
  });
});
