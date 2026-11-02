import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const createPaymentLink = vi.fn();
const getPaymentProvider = vi.fn();
const resolveCheckoutLines = vi.fn();
const markFreeOrderPaid = vi.fn();
const fulfillPaidOrder = vi.fn();
const getReusableFreeBookingOrder = vi.fn();

vi.mock("@/lib/orders", () => ({
  CheckoutError: class CheckoutError extends Error { body: Record<string, unknown>; status: number; constructor(status: number, body: Record<string, unknown>) { super(String(body.error)); this.status = status; this.body = body; } },
  createOrder: (...a: unknown[]) => createOrder(...a),
  attachPaymentSession: async () => {},
  linkBookingsToOrder: async () => {},
  resolveCheckoutLines: (...a: unknown[]) => resolveCheckoutLines(...a),
  markFreeOrderPaid: (...a: unknown[]) => markFreeOrderPaid(...a),
  getReusableFreeBookingOrder: (...a: unknown[]) => getReusableFreeBookingOrder(...a),
}));
vi.mock("@/lib/payments", () => ({
  getPaymentProvider: (...a: unknown[]) => getPaymentProvider(...a),
}));

vi.mock("@/lib/booking/fulfil", () => ({ fulfillPaidOrder: (...a: unknown[]) => fulfillPaidOrder(...a) }));

import { CheckoutError } from "@/lib/orders";
import { POST } from "@/pages/api/checkout";

async function checkout(body: unknown, requestUrl = "http://10.0.0.5:4321/api/checkout") {
  const request = new Request(requestUrl, { method: "POST", body: JSON.stringify(body) });
  const session = { get: async () => ({ id: 7, email: "a@b.c", name: null }) };
  return (POST as (ctx: unknown) => Promise<Response>)({ request, session, url: new URL(request.url) });
}

describe("POST /api/checkout", () => {
  beforeEach(() => {
    resolveCheckoutLines.mockReset().mockResolvedValue([{ product_id: "p1", name: "Chart", slug: "chart", unit_price: 10, quantity: 1 }]);
    getPaymentProvider.mockReset().mockReturnValue({ name: "square", createPaymentLink });
    markFreeOrderPaid.mockReset().mockResolvedValue({ id: "order-1", status: "paid" });
    fulfillPaidOrder.mockReset().mockResolvedValue({ confirmed: ["b1"], credits: [], attention: [] });
    getReusableFreeBookingOrder.mockReset().mockResolvedValue(null);
    process.env.PUBLIC_SITE_URL = "https://runtime.example";
    createOrder.mockReset().mockResolvedValue({ id: "order-1", lines: [] });
    createPaymentLink.mockReset().mockResolvedValue({ url: "https://pay.test/x", session_id: "SQ-ORD" });
  });
  afterEach(() => {
    delete process.env.PUBLIC_SITE_URL;
  });

  it("charges in AUD regardless of a client-supplied currency", async () => {
    const res = await checkout({ currency: "USD", items: [{ product_id: "p1", quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ currency: "AUD" }));
    expect(createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ currency: "AUD" }));
  });

  it("builds the return URL from the runtime PUBLIC_SITE_URL, not the proxied request origin", async () => {
    await checkout({ items: [{ product_id: "p1", quantity: 1 }] });
    expect(createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ redirect_url: "https://runtime.example/shop/orders/order-1/confirmation" }),
    );
  });
  it("free checkout marks paid and fulfils without instantiating Square", async () => {
    resolveCheckoutLines.mockResolvedValue([{ booking_id: "b1", name: "Consultation", slug: "bws-consultation", unit_price: 0, quantity: 1 }]);
    const res = await checkout({ items: [{ kind: "lesson_booking", booking_id: "b1", price: 99 }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ redirect_url: "https://runtime.example/shop/orders/order-1/confirmation" });
    expect(markFreeOrderPaid).toHaveBeenCalledWith("order-1");
    expect(fulfillPaidOrder).toHaveBeenCalledWith("order-1");
    expect(getPaymentProvider).not.toHaveBeenCalled();
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("a mixed free/paid cart uses Square with both lines", async () => {
    resolveCheckoutLines.mockResolvedValue([
      { name: "Consultation", unit_price: 0, quantity: 1 }, { name: "Lesson", unit_price: 95, quantity: 1 },
    ]);
    const res = await checkout({ items: [{ kind: "lesson_booking", booking_id: "b1" }, { kind: "lesson_booking", booking_id: "b2" }] });
    expect(res.status).toBe(200);
    expect(createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ line_items: [
      { name: "Consultation", unit_price: 0, quantity: 1 }, { name: "Lesson", unit_price: 95, quantity: 1 },
    ] }));
    expect(markFreeOrderPaid).not.toHaveBeenCalled();
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
  });

  it("a client zero total cannot bypass a server-priced paid line", async () => {
    await checkout({ total: 0, items: [{ product_id: "p1", quantity: 1, price: 0 }] });
    expect(createPaymentLink).toHaveBeenCalled();
    expect(markFreeOrderPaid).not.toHaveBeenCalled();
  });

  it("resumes a free order after a fulfilment failure without another order", async () => {
    resolveCheckoutLines.mockRejectedValue(new CheckoutError(409, { error: "already_paid", booking_id: "b1" }));
    getReusableFreeBookingOrder.mockResolvedValue({ id: "order-1", status: "paid" });
    const res = await checkout({ items: [{ kind: "lesson_booking", booking_id: "b1" }] });
    expect(res.status).toBe(200);
    expect(createOrder).not.toHaveBeenCalled();
    expect(fulfillPaidOrder).toHaveBeenCalledWith("order-1");
    expect(getPaymentProvider).not.toHaveBeenCalled();
  });

  it("requires a session before resolving any free or paid cart", async () => {
    const res = await (POST as (ctx: unknown) => Promise<Response>)({
      request: new Request("https://site.test/api/checkout", { method: "POST", body: JSON.stringify({ items: [{ kind: "lesson_booking", booking_id: "b1" }] }) }),
      session: { get: async () => undefined },
    });
    expect(res.status).toBe(401);
    expect(resolveCheckoutLines).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(getPaymentProvider).not.toHaveBeenCalled();
  });

});
