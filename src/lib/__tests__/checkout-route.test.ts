import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const createPaymentLink = vi.fn();

vi.mock("@/lib/orders", () => ({
  CheckoutError: class CheckoutError extends Error {},
  createOrder: (...a: unknown[]) => createOrder(...a),
  attachPaymentSession: async () => {},
  linkBookingsToOrder: async () => {},
  resolveCheckoutLines: async () => [{ product_id: "p1", name: "Chart", slug: "chart", unit_price: 10, quantity: 1 }],
}));
vi.mock("@/lib/payments", () => ({
  getPaymentProvider: () => ({ name: "square", createPaymentLink: (...a: unknown[]) => createPaymentLink(...a) }),
}));

import { POST } from "@/pages/api/checkout";

async function checkout(body: unknown, requestUrl = "http://10.0.0.5:4321/api/checkout") {
  const request = new Request(requestUrl, { method: "POST", body: JSON.stringify(body) });
  const session = { get: async () => ({ id: 7, email: "a@b.c", name: null }) };
  return (POST as (ctx: unknown) => Promise<Response>)({ request, session, url: new URL(request.url) });
}

describe("POST /api/checkout", () => {
  beforeEach(() => {
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
});
