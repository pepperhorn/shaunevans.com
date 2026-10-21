import type { APIRoute } from "astro";
import {
  createOrder,
  attachPaymentSession,
  linkBookingsToOrder,
  resolveCheckoutLines,
  CheckoutError,
  type CheckoutItem,
} from "@/lib/orders";
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
    const resolved = await resolveCheckoutLines(body.items, sessUser.id);

    const order = await createOrder({
      user_id: sessUser.id,
      email: sessUser.email,
      currency,
      lines: resolved,
    });
    await linkBookingsToOrder(order);

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
      redirect_url: new URL(`/shop/orders/${order.id}/confirmation`, siteUrl()).toString(),
    });

    await attachPaymentSession(order.id, provider.name, link.session_id);

    return json({ ok: true, order_id: order.id, redirect_url: link.url });
  } catch (err) {
    if (err instanceof CheckoutError) return json(err.body, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
