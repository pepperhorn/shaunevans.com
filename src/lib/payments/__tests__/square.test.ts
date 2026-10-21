import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SquareProvider } from "../square";

const make = (key = "k") =>
  new SquareProvider({
    accessToken: "tok",
    locationId: "LOC",
    webhookSignatureKey: key,
    environment: "sandbox",
  });

afterEach(() => vi.unstubAllGlobals());

describe("SquareProvider", () => {
  it("createPaymentLink returns payment_link.order_id as session_id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ payment_link: { id: "PL1", url: "https://sq/x", order_id: "ORD1" } }),
          { status: 200 },
        ),
      ),
    );
    const res = await make().createPaymentLink({
      order_id: "o1",
      email: "a@b.c",
      currency: "AUD",
      line_items: [{ name: "x", quantity: 1, unit_price: 10 }],
      redirect_url: "https://site/r",
    });
    expect(res.session_id).toBe("ORD1");
    expect(res.url).toBe("https://sq/x");
  });

  it("createPaymentLink throws when order_id is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ payment_link: { id: "PL1", url: "https://sq/x" } }), {
          status: 200,
        }),
      ),
    );
    await expect(
      make().createPaymentLink({
        order_id: "o1",
        email: "a@b.c",
        currency: "AUD",
        line_items: [],
        redirect_url: "https://site/r",
      }),
    ).rejects.toThrow(/order_id/);
  });

  it("parsePaymentEvent maps COMPLETED to paid with order_id", () => {
    const body = JSON.stringify({
      data: { object: { payment: { id: "P1", order_id: "ORD1", status: "COMPLETED" } } },
    });
    expect(make().parsePaymentEvent(body)).toEqual({
      payment_session_id: "ORD1",
      payment_intent_id: "P1",
      status: "paid",
    });
  });

  it.each(["APPROVED", "PENDING"])("parsePaymentEvent does not treat %s as paid", (status) => {
    const body = JSON.stringify({
      data: { object: { payment: { id: "P1", order_id: "ORD1", status } } },
    });
    expect(make().parsePaymentEvent(body)?.status).toBe("other");
  });

  it("verifyWebhookSignature accepts HMAC of url+body", () => {
    const url = "https://site/api/webhooks/square";
    const body = '{"a":1}';
    const sig = createHmac("sha256", "k").update(url + body).digest("base64");
    expect(make("k").verifyWebhookSignature(body, sig, url)).toBe(true);
    expect(make("k").verifyWebhookSignature(body, sig, url + "x")).toBe(false);
  });
});
