import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/catalog", () => ({
  getProducts: async () => [
    { id: "prod-uuid-1", slug: "big-band-chart", name: "Big Band Chart", price: 49.5 },
  ],
}));

import { CheckoutError, createOrder, linkBookingsToOrder, resolveCheckoutLines } from "@/lib/orders";
import { normalizePhone } from "@/lib/phone";
import { toCheckoutItems, type CartItem } from "@/lib/cart";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const USER = 7;
const BOOKING = "11111111-2222-3333-4444-555555555555";

type Call = { method: string; url: URL; body: unknown };
let calls: Call[] = [];
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

const lessons: Record<number, Record<string, unknown>> = {
  1: { id: 1, slug: "single-session", name: "Single Coaching Session", kind: "single", duration_minutes: 60, price: "95.00", requires_phone: false },
  2: { id: 2, slug: "four-pack", name: "Four-Pack", kind: "pack", duration_minutes: null, price: "340.00", requires_phone: false },
  3: { id: 3, slug: "composition-mentorship", name: "Composition Mentorship", kind: "pack", duration_minutes: null, price: "600.00", requires_phone: true },
};

function booking(over: Record<string, unknown> = {}) {
  return {
    id: BOOKING,
    status: "held",
    user: USER,
    lesson: 1,
    start_at: "2026-11-10T08:00:00Z",
    end_at: "2026-11-10T09:00:00Z",
    hold_expires_at: new Date(NOW + 10 * 60_000).toISOString(),
    source: "purchase",
    credit: null,
    when_label: "Tue 10 Nov 2026, 19:00–20:00",
    ...over,
  };
}

function mockDirectus(opts: { booking?: Record<string, unknown> | null; phone?: string | null } = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const c: Call = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      const p = url.pathname;
      if (p === "/items/bookings" && c.method === "GET") {
        const b = opts.booking === undefined ? booking() : opts.booking;
        return ok(b ? [b] : []);
      }
      if (p === "/items/lessons") {
        const id = JSON.parse(url.searchParams.get("filter") ?? "{}").id?._eq;
        return ok(lessons[id] ? [lessons[id]] : []);
      }
      if (p === `/items/users/${USER}`) return ok({ id: USER, phone: opts.phone ?? null, sms_opt_in: false });
      if (p === "/items/orders" && c.method === "POST") return ok({ id: "order-1", status: "pending" });
      if (p === "/items/order_items" && c.method === "POST")
        return ok((c.body as Array<Record<string, unknown>>).map((l, i) => ({ id: `oi-${i}`, ...l })));
      if (p.startsWith("/items/bookings/") && c.method === "PATCH") return ok({ id: p.split("/").pop() });
      throw new Error(`unmocked ${c.method} ${p}`);
    }),
  );
}

beforeEach(() => {
  process.env.DIRECTUS_URL = "https://cms.test";
  process.env.DIRECTUS_TOKEN = "tok";
  vi.stubEnv("DIRECTUS_URL", "https://cms.test");
  vi.stubEnv("DIRECTUS_TOKEN", "tok");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function rejection(p: Promise<unknown>): Promise<CheckoutError> {
  const err = await p.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CheckoutError);
  return err as CheckoutError;
}

describe("resolveCheckoutLines", () => {
  it("rejects expired hold with hold_expired", async () => {
    mockDirectus({ booking: booking({ hold_expires_at: new Date(NOW - 1000).toISOString() }) });
    const err = await rejection(resolveCheckoutLines([{ kind: "lesson_booking", booking_id: BOOKING }], USER));
    expect(err.status).toBe(409);
    expect(err.body).toEqual({ error: "hold_expired", booking_id: BOOKING });
  });

  it("rejects a hold that is no longer held (cancelled by the expiry sweep)", async () => {
    mockDirectus({ booking: booking({ status: "cancelled" }) });
    const err = await rejection(resolveCheckoutLines([{ kind: "lesson_booking", booking_id: BOOKING }], USER));
    expect(err.status).toBe(409);
    expect(err.body).toEqual({ error: "hold_expired", booking_id: BOOKING });
  });

  it("rejects someone else's booking", async () => {
    mockDirectus({ booking: booking({ user: 99 }) });
    const err = await rejection(resolveCheckoutLines([{ kind: "lesson_booking", booking_id: BOOKING }], USER));
    expect(err.status).toBe(409);
    expect(err.body).toEqual({ error: "hold_expired", booking_id: BOOKING });
  });

  it("prices lesson_booking from lessons.price", async () => {
    mockDirectus();
    const lines = await resolveCheckoutLines([{ kind: "lesson_booking", booking_id: BOOKING }], USER);
    expect(lines).toEqual([
      {
        lesson_id: 1,
        booking_id: BOOKING,
        name: "Single Coaching Session — Tue 10 Nov 2026, 19:00–20:00",
        slug: "single-session",
        unit_price: 95,
        quantity: 1,
      },
    ]);
  });

  it("phone_required for mentorship without phone", async () => {
    mockDirectus({ phone: null });
    const err = await rejection(resolveCheckoutLines([{ kind: "lesson_pack", lesson_id: 3 }], USER));
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ error: "phone_required" });
  });

  it("mentorship resolves once the user has a phone; packs are qty 1 at lessons.price", async () => {
    mockDirectus({ phone: "+61412345678" });
    const lines = await resolveCheckoutLines([{ kind: "lesson_pack", lesson_id: 3 }], USER);
    expect(lines).toEqual([
      { lesson_id: 3, name: "Composition Mentorship", slug: "composition-mentorship", unit_price: 600, quantity: 1 },
    ]);
  });

  it("rejects lesson_pack pointing at a non-pack lesson", async () => {
    mockDirectus();
    const err = await rejection(resolveCheckoutLines([{ kind: "lesson_pack", lesson_id: 1 }], USER));
    expect(err.status).toBe(400);
  });

  it("legacy {product_id, quantity} still resolves as product", async () => {
    mockDirectus();
    const lines = await resolveCheckoutLines([{ product_id: "prod-uuid-1", quantity: 2 }], USER);
    expect(lines).toEqual([
      { product_id: "prod-uuid-1", name: "Big Band Chart", slug: "big-band-chart", unit_price: 49.5, quantity: 2 },
    ]);
  });

  it("unknown product is a 400", async () => {
    mockDirectus();
    const err = await rejection(resolveCheckoutLines([{ product_id: "nope", quantity: 1 }], USER));
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ error: "unknown_product", product_id: "nope" });
  });
});

describe("createOrder + linkBookingsToOrder", () => {
  it("keeps the 1/11 GST back-calculation, writes lesson/booking columns, and links bookings", async () => {
    mockDirectus();
    const order = await createOrder({
      user_id: USER,
      email: "a@b.c",
      currency: "AUD",
      lines: [
        { lesson_id: 1, booking_id: BOOKING, name: "Single", slug: "single-session", unit_price: 95, quantity: 1 },
        { product_id: "prod-uuid-1", name: "Chart", slug: "big-band-chart", unit_price: 49.5, quantity: 2 },
      ],
    });
    const orderPost = calls.find((c) => c.url.pathname === "/items/orders")!;
    expect(orderPost.body).toMatchObject({ total: "194.00", tax: "17.64", subtotal: "176.36", currency: "AUD" });
    const itemsPost = calls.find((c) => c.url.pathname === "/items/order_items")!;
    expect(itemsPost.body).toEqual([
      expect.objectContaining({ order: "order-1", product: null, lesson: 1, booking: BOOKING, line_total: "95.00" }),
      expect.objectContaining({ order: "order-1", product: "prod-uuid-1", lesson: null, booking: null, line_total: "99.00" }),
    ]);

    await linkBookingsToOrder(order);
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].url.pathname).toBe(`/items/bookings/${BOOKING}`);
    expect(patches[0].body).toEqual({ order: "order-1", order_item: "oi-0" });
  });
});

describe("normalizePhone", () => {
  it("normalises AU local numbers to E.164", () => {
    expect(normalizePhone("0412 345 678")).toBe("+61412345678");
  });
  it("keeps international numbers", () => {
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
  });
  it("rejects garbage", () => {
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
  });
});

describe("toCheckoutItems", () => {
  it("maps products, lesson bookings and packs to the checkout body", () => {
    const items: CartItem[] = [
      { id: "prod-uuid-1", slug: "chart", name: "Chart", price: 10, image: "", quantity: 2 },
      { id: `booking:${BOOKING}`, slug: "", name: "Single", price: 95, image: "", quantity: 1, kind: "lesson_booking", bookingId: BOOKING, lessonId: 1 },
      { id: "lesson:3", slug: "composition-mentorship", name: "Mentorship", price: 600, image: "", quantity: 1, kind: "lesson_pack", lessonId: 3 },
    ];
    expect(toCheckoutItems(items)).toEqual([
      { product_id: "prod-uuid-1", quantity: 2 },
      { kind: "lesson_booking", booking_id: BOOKING },
      { kind: "lesson_pack", lesson_id: 3 },
    ]);
  });
});
