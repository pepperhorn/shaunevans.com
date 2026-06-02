import type { APIRoute } from "astro";
import { getPaymentProvider } from "@/lib/payments";
import { markOrderPaid } from "@/lib/orders";

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature") ?? "";

  const provider = getPaymentProvider();
  const requestUrl = (import.meta.env.PUBLIC_SITE_URL as string | undefined)
    ? new URL(url.pathname, import.meta.env.PUBLIC_SITE_URL as string).toString()
    : url.toString();

  if (!provider.verifyWebhookSignature(rawBody, signature, requestUrl)) {
    return new Response("invalid signature", { status: 401 });
  }

  const event = provider.parsePaymentEvent(rawBody);
  if (!event) return new Response("ignored", { status: 200 });

  if (event.status === "paid" && event.payment_session_id && event.payment_intent_id) {
    try {
      await markOrderPaid(event.payment_session_id, event.payment_intent_id);
    } catch (err) {
      console.error("[webhook/square] markOrderPaid failed:", err);
      return new Response("error", { status: 500 });
    }
  }

  return new Response("ok", { status: 200 });
};
