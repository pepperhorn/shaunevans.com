import type { APIRoute } from "astro";
import { getPaymentProvider } from "@/lib/payments";
import { CLOSED_ORDER_STATUSES, markOrderPaid } from "@/lib/orders";
import { fulfillPaidOrder } from "@/lib/booking/fulfil";
import { siteUrl } from "@/lib/siteUrl";

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature") ?? "";

  const provider = getPaymentProvider();
  // Square signs the URL it was configured to call (the public one); behind the
  // proxy `url` is the internal http origin, so always rebuild it from siteUrl().
  const requestUrl = new URL(url.pathname, siteUrl()).toString();

  if (!provider.verifyWebhookSignature(rawBody, signature, requestUrl)) {
    return new Response("invalid signature", { status: 401 });
  }

  const event = provider.parsePaymentEvent(rawBody);
  if (!event) return new Response("ignored", { status: 200 });

  if (event.status === "paid" && event.payment_session_id && event.payment_intent_id) {
    try {
      // Returns the order whether this delivery flipped it or it was already paid,
      // so replays still fulfil (fulfillPaidOrder is idempotent).
      const order = await markOrderPaid(event.payment_session_id, event.payment_intent_id);
      if (order && !CLOSED_ORDER_STATUSES.includes(order.status)) {
        const res = await fulfillPaidOrder(order.id);
        if (res.attention.length > 0) console.warn(`[webhook/square] order ${order.id} needs attention:`, res.attention);
      }
    } catch (err) {
      // 500 so Square retries the delivery.
      console.error("[webhook/square] mark paid / fulfil failed:", err);
      return new Response("error", { status: 500 });
    }
  }

  return new Response("ok", { status: 200 });
};
