import type { APIRoute } from "astro";
import { verifySessionToken } from "@/lib/session";
import { getProduct } from "@/lib/catalog";
import { createOrder, attachPaymentSession } from "@/lib/orders";
import { getPaymentProvider } from "@/lib/payments";

export const prerender = false;

type CheckoutRequest = {
  token: string;
  items: Array<{ product_id: string; quantity: number }>;
  currency?: string;
};

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body = (await request.json()) as CheckoutRequest;
    const session = verifySessionToken(body.token);
    if (!session) {
      return new Response(JSON.stringify({ error: "auth required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return new Response(JSON.stringify({ error: "empty cart" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const currency = body.currency ?? "GBP";
    const resolved = await Promise.all(
      body.items.map(async (i) => {
        const product = await getProduct(i.product_id);
        if (!product) throw new Error(`unknown product: ${i.product_id}`);
        const quantity = Math.max(1, Math.floor(i.quantity));
        return {
          product_id: product.id,
          name: product.name,
          slug: product.slug,
          unit_price: product.price,
          quantity,
        };
      }),
    );

    const order = await createOrder({
      user_id: session.user_id,
      email: session.email,
      currency,
      lines: resolved,
    });

    const provider = getPaymentProvider();
    const link = await provider.createPaymentLink({
      order_id: order.id,
      email: session.email,
      currency,
      line_items: resolved.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
      redirect_url: new URL(`/shop/orders/${order.id}/confirmation`, url.origin).toString(),
    });

    await attachPaymentSession(order.id, provider.name, link.session_id);

    return new Response(
      JSON.stringify({ ok: true, order_id: order.id, redirect_url: link.url }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
