import type { APIRoute } from "astro";
import {
  createOrder,
  attachPaymentSession,
  linkBookingsToOrder,
  resolveCheckoutLines,
  CheckoutError,
  type CheckoutItem,
  markFreeOrderPaid,
  getReusableFreeBookingOrder,
} from "@/lib/orders";
import { fulfillPaidOrder } from "@/lib/booking/fulfil";
import { getPaymentProvider } from "@/lib/payments";
import { siteUrl } from "@/lib/siteUrl";

export const prerender = false;

type CheckoutRequest = {
  items: CheckoutItem[];
};

// Prices are AUD in Directus; the client never picks the currency.
const CURRENCY = "AUD";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request, session }) => {
  try {
    const sessUser = await session?.get<{ id: number; email: string; name: string | null }>("user");
    if (!sessUser) return json({ error: "auth required" }, 401);

    const body = (await request.json()) as CheckoutRequest;
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return json({ error: "empty cart" }, 400);
    }

    const currency = CURRENCY;
    let resolved;
    try {
      resolved = await resolveCheckoutLines(body.items, sessUser.id);
    } catch (err) {
      // No webhook retries a free order. A failed fulfilment (or lost response) can be
      // resumed by the same user/cart, without making another order or payment.
      if (!(err instanceof CheckoutError) || err.body.error !== "already_paid") throw err;
      const existing = await getReusableFreeBookingOrder(body.items, sessUser.id);
      if (!existing) throw err;
      await markFreeOrderPaid(existing.id);
      await fulfillPaidOrder(existing.id);
      return json({ ok: true, order_id: existing.id, redirect_url: new URL(`/shop/orders/${existing.id}/confirmation`, siteUrl()).toString() });
    }

    const isFree = resolved.length > 0 && resolved.every((line) => line.unit_price === 0);
    const reusable = isFree ? await getReusableFreeBookingOrder(body.items, sessUser.id) : null;
    const order = reusable ?? await createOrder({
      user_id: sessUser.id,
      email: sessUser.email,
      currency,
      lines: resolved,
    });
    if (!reusable) await linkBookingsToOrder(order);

    const redirectUrl = new URL(`/shop/orders/${order.id}/confirmation`, siteUrl()).toString();
    // Use server-resolved prices, never the client cart total or a rounded near-zero total.
    if (isFree) {
      const paid = await markFreeOrderPaid(order.id);
      if (!["paid", "fulfilled"].includes(paid.status)) throw new CheckoutError(409, { error: "order_closed" });
      await fulfillPaidOrder(order.id);
      return json({ ok: true, order_id: order.id, redirect_url: redirectUrl });
    }

    const provider = getPaymentProvider();
    const link = await provider.createPaymentLink({
      order_id: order.id,
      email: sessUser.email,
      currency,
      line_items: resolved.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
      redirect_url: redirectUrl,
    });

    await attachPaymentSession(order.id, provider.name, link.session_id);

    return json({ ok: true, order_id: order.id, redirect_url: link.url });
  } catch (err) {
    if (err instanceof CheckoutError) return json(err.body, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
