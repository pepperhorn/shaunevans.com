import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillPaidOrder } from "@/lib/booking/fulfil";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const PAID_AT = "2026-11-01T00:00:00.000Z";
const ORDER = "order-1";
const USER = 4;

type Row = Record<string, unknown>;
type Call = { method: string; url: URL; body: unknown };

const lessons: Record<number, Row> = {
  1: { id: 1, kind: "single", credits: null, credit_lesson: null, credit_expiry_months: 12 },
  2: { id: 2, kind: "pack", credits: 4, credit_lesson: 1, credit_expiry_months: 12 },
};

/** Tiny in-memory Directus: orders / order_items / bookings / lesson_credits / globals. */
type Store = {
  order: Row;
  items: Row[];
  bookings: Map<string, Row>;
  credits: Row[];
  /** POST /items/bookings answers with a masked 500 (slot taken) when true. */
  slotTaken: boolean;
};

let store: Store;
let calls: Call[] = [];
let seq = 0;

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const masked500 = () =>
  new Response(JSON.stringify({ errors: [{ message: "An unexpected error occurred." }] }), { status: 500 });

function heldBooking(over: Row = {}): Row {
  return {
    id: "bk-1",
    status: "held",
    user: USER,
    lesson: 1,
    start_at: "2026-11-10T08:00:00.000Z",
    end_at: "2026-11-10T09:00:00.000Z",
    hold_expires_at: "2026-11-01T00:10:00.000Z",
    visitor_timezone: "Europe/London",
    order: ORDER,
    order_item: "oi-1",
    ...over,
  };
}

function setup(opts: { items: Row[]; bookings?: Row[]; slotTaken?: boolean; notes?: string | null }) {
  store = {
    order: { id: ORDER, user: USER, status: "paid", paid_at: PAID_AT, notes: opts.notes ?? null, needs_attention: false },
    items: opts.items,
    bookings: new Map((opts.bookings ?? []).map((b) => [b.id as string, { ...b }])),
    credits: [],
    slotTaken: opts.slotTaken ?? false,
  };
  calls = [];
  seq = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const c: Call = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      const p = url.pathname;
      const filter = JSON.parse(url.searchParams.get("filter") ?? "{}");

      if (p === `/items/orders/${ORDER}` && c.method === "GET") return ok(store.order);
      if (p === `/items/orders/${ORDER}` && c.method === "PATCH") {
        Object.assign(store.order, c.body as Row);
        return ok({ id: ORDER });
      }
      if (p === "/items/order_items" && c.method === "GET") {
        return ok(
          store.items.map((i) => ({
            ...i,
            lesson: i.lesson ? lessons[i.lesson as number] : null,
            booking: i.booking ? (store.bookings.get(i.booking as string) ?? null) : null,
          })),
        );
      }
      if (p === "/items/globals") return ok({});
      if (p === "/items/bookings" && c.method === "PATCH") return ok([]); // expireStaleHolds
      if (p === "/items/bookings" && c.method === "GET") {
        const live = (b: Row) => ["held", "confirmed"].includes(b.status as string);
        // replacement lookup: bookings for an order_item
        if (filter.order_item) {
          const oi = filter.order_item._eq;
          const st: string[] = filter.status?._in ?? [];
          return ok([...store.bookings.values()].filter((b) => b.order_item === oi && st.includes(b.status as string)));
        }
        // overlap probe from createBooking
        return ok([...store.bookings.values()].filter(live).length && store.slotTaken ? [{ id: "someone-else" }] : []);
      }
      if (p === "/items/bookings" && c.method === "POST") {
        if (store.slotTaken) return masked500();
        const id = `bk-new-${++seq}`;
        store.bookings.set(id, { id, ...(c.body as Row) });
        return ok({ id });
      }
      if (p.startsWith("/items/bookings/") && c.method === "PATCH") {
        const id = decodeURIComponent(p.split("/").pop()!);
        Object.assign(store.bookings.get(id)!, c.body as Row);
        return ok({ id });
      }
      if (p === "/items/lesson_credits" && c.method === "GET") {
        return ok(store.credits.filter((r) => r.order_item === filter.order_item?._eq).map((r) => ({ id: r.id })));
      }
      if (p === "/items/lesson_credits" && c.method === "POST") {
        const id = `cr-${++seq}`;
        store.credits.push({ id, ...(c.body as Row) });
        return ok({ id });
      }
      throw new Error(`unmocked ${c.method} ${p}`);
    }),
  );
}

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

const bookingItem = { id: "oi-1", order: ORDER, lesson: 1, booking: "bk-1" };
const packItem = { id: "oi-2", order: ORDER, lesson: 2, booking: null };

describe("fulfillPaidOrder", () => {
  it("confirms held booking", async () => {
    setup({ items: [bookingItem], bookings: [heldBooking()] });
    const res = await fulfillPaidOrder(ORDER);
    expect(res).toEqual({ confirmed: ["bk-1"], credits: [], attention: [] });
    expect(store.bookings.get("bk-1")).toMatchObject({ status: "confirmed", hold_expires_at: null });
    expect(store.order.needs_attention).toBe(false);
  });

  it("running twice confirms the booking once and creates credits once", async () => {
    setup({ items: [bookingItem, packItem], bookings: [heldBooking()] });
    const first = await fulfillPaidOrder(ORDER);
    expect(first.confirmed).toEqual(["bk-1"]);
    expect(first.credits).toHaveLength(1);
    expect(store.credits[0]).toMatchObject({
      status: "active",
      user: USER,
      pack: 2,
      lesson: 1,
      order_item: "oi-2",
      credits_total: 4,
      expires_at: "2027-11-01T00:00:00.000Z",
    });

    const second = await fulfillPaidOrder(ORDER);
    expect(second).toEqual({ confirmed: [], credits: [], attention: [] });
    expect(store.credits).toHaveLength(1);
    expect(calls.filter((c) => c.method === "PATCH" && c.url.pathname === "/items/bookings/bk-1")).toHaveLength(1);
  });

  it("expired hold with free slot is re-occupied and confirmed", async () => {
    setup({
      items: [bookingItem],
      bookings: [heldBooking({ status: "cancelled", cancel_reason: "hold_expired", hold_expires_at: null })],
    });
    const res = await fulfillPaidOrder(ORDER);
    expect(res.confirmed).toEqual(["bk-new-1"]);
    expect(res.attention).toEqual([]);
    expect(store.bookings.get("bk-1")!.status).toBe("cancelled");
    expect(store.bookings.get("bk-new-1")).toMatchObject({
      status: "confirmed",
      source: "purchase",
      user: USER,
      lesson: 1,
      start_at: "2026-11-10T08:00:00.000Z",
      end_at: "2026-11-10T09:00:00.000Z",
      hold_expires_at: null,
      order: ORDER,
      order_item: "oi-1",
      visitor_timezone: "Europe/London",
    });

    // replay: the replacement already exists → no second insert
    const again = await fulfillPaidOrder(ORDER);
    expect(again).toEqual({ confirmed: [], credits: [], attention: [] });
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname === "/items/bookings")).toHaveLength(1);
  });

  it("expired hold with taken slot sets needs_attention and does not create an overlapping booking", async () => {
    setup({
      items: [bookingItem],
      bookings: [
        heldBooking({ status: "cancelled", hold_expires_at: null }),
        heldBooking({ id: "other", status: "confirmed", user: 99, order: "order-x", order_item: "oi-x" }),
      ],
      slotTaken: true,
      notes: "existing note",
    });
    const res = await fulfillPaidOrder(ORDER);
    const msg = "Booking bk-1 could not be confirmed: slot taken after hold expired — refund or rebook.";
    expect(res).toEqual({ confirmed: [], credits: [], attention: [msg] });
    expect(store.order.needs_attention).toBe(true);
    expect(store.order.notes).toBe(`existing note\n${msg}`);
    expect([...store.bookings.values()].filter((b) => b.status === "confirmed").map((b) => b.id)).toEqual(["other"]);

    // replay: no second note line, no second insert attempt
    const again = await fulfillPaidOrder(ORDER);
    expect(again.attention).toEqual([msg]);
    expect(store.order.notes).toBe(`existing note\n${msg}`);
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname === "/items/bookings")).toHaveLength(1);
  });

  it("does not confirm a booking that now belongs to a newer order (R8)", async () => {
    setup({ items: [bookingItem], bookings: [heldBooking({ order: "order-2", order_item: "oi-9" })] });
    const res = await fulfillPaidOrder(ORDER);
    const msg = "Booking bk-1 belongs to a newer order — this payment may be a duplicate; refund if so.";
    expect(res).toEqual({ confirmed: [], credits: [], attention: [msg] });
    expect(store.bookings.get("bk-1")!.status).toBe("held");
    expect(store.order).toMatchObject({ needs_attention: true, notes: msg });
  });

  it("credits default to 12 months when credit_expiry_months is null", async () => {
    lessons[5] = { id: 5, kind: "pack", credits: 6, credit_lesson: 1, credit_expiry_months: null };
    setup({ items: [{ id: "oi-5", order: ORDER, lesson: 5, booking: null }] });
    await fulfillPaidOrder(ORDER);
    expect(store.credits[0]).toMatchObject({ credits_total: 6, expires_at: "2027-11-01T00:00:00.000Z" });
    delete lessons[5];
  });

  it("a pack with no credits configured is flagged, not guessed", async () => {
    lessons[6] = { id: 6, kind: "pack", credits: null, credit_lesson: 1, credit_expiry_months: 12 };
    setup({ items: [{ id: "oi-6", order: ORDER, lesson: 6, booking: null }] });
    const res = await fulfillPaidOrder(ORDER);
    expect(store.credits).toHaveLength(0);
    expect(res.attention).toHaveLength(1);
    expect(store.order.needs_attention).toBe(true);
    delete lessons[6];
  });
});

// ── Webhook ─────────────────────────────────────────────────────────────────

const markOrderPaid = vi.fn();
const fulfilMock = vi.fn();

vi.mock("@/lib/orders", () => ({ markOrderPaid: (...a: unknown[]) => markOrderPaid(...a) }));
vi.mock("@/lib/payments", () => ({
  getPaymentProvider: () => ({
    verifyWebhookSignature: () => true,
    parsePaymentEvent: () => ({ status: "paid", payment_session_id: "SQ-ORD", payment_intent_id: "PAY1" }),
  }),
}));

describe("square webhook", () => {
  async function post() {
    vi.doMock("@/lib/booking/fulfil", () => ({ fulfillPaidOrder: (...a: unknown[]) => fulfilMock(...a) }));
    vi.resetModules();
    const { POST } = await import("@/pages/api/webhooks/square");
    const request = new Request("https://site.test/api/webhooks/square", { method: "POST", body: "{}" });
    return (POST as (ctx: unknown) => Promise<Response>)({ request, url: new URL(request.url) });
  }

  beforeEach(() => {
    markOrderPaid.mockReset();
    fulfilMock.mockReset();
  });
  afterEach(() => vi.doUnmock("@/lib/booking/fulfil"));

  it("webhook calls fulfil when order already paid", async () => {
    markOrderPaid.mockResolvedValue({ id: ORDER, status: "paid" });
    fulfilMock.mockResolvedValue({ confirmed: [], credits: [], attention: [] });
    const res = await post();
    expect(res.status).toBe(200);
    expect(fulfilMock).toHaveBeenCalledWith(ORDER);
  });

  it("fulfil errors return 500 so Square retries", async () => {
    markOrderPaid.mockResolvedValue({ id: ORDER, status: "paid" });
    fulfilMock.mockRejectedValue(new Error("directus down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(500);
  });

  it("unknown order (markOrderPaid null) does not fulfil", async () => {
    markOrderPaid.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(200);
    expect(fulfilMock).not.toHaveBeenCalled();
  });
});
