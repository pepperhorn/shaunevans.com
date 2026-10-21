import { serverEnv } from "@/lib/env";
import { getProducts } from "@/lib/catalog";
import { getBooking, getLessonById } from "@/lib/booking/repo";
import { getUserContact, type UserContact } from "@/lib/auth";
import type { CheckoutItem } from "@/lib/cart";

function directusBase(): string {
  const url = serverEnv("DIRECTUS_URL");
  if (!url) throw new Error("DIRECTUS_URL not set");
  return url;
}

function directusToken(): string {
  const t = serverEnv("DIRECTUS_TOKEN");
  if (!t) throw new Error("DIRECTUS_TOKEN not set");
  return t;
}

async function directusPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${directusBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${directusToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus POST ${path} failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function directusPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${directusBase()}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${directusToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus PATCH ${path} failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function directusGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${directusBase()}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${directusToken()}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus GET ${path} failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

/** One resolved order line: a product, a held lesson booking, or a lesson pack. */
export type OrderLineInput = {
  product_id?: string;
  lesson_id?: number;
  booking_id?: string;
  name: string;
  slug: string;
  unit_price: number;
  quantity: number;
};

export type NewOrderInput = {
  user_id: number;
  email: string;
  currency: string;
  lines: OrderLineInput[];
};

export type Order = {
  id: string;
  status: string;
  user: number;
  email: string;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  payment_provider: string | null;
  payment_session_id: string | null;
  payment_intent_id: string | null;
  paid_at: string | null;
  delivered_at: string | null;
};

/** The created order plus the ids of its order_items (with the booking each one carries). */
export type CreatedOrder = Order & { lines: Array<{ id: string; booking: string | null }> };

export async function createOrder(input: NewOrderInput): Promise<CreatedOrder> {
  // Australian GST 10%, included in displayed prices. The customer pays the
  // displayed (GST-incl) price exactly; we back-calculate the GST component.
  // Work in cents to avoid float drift on toFixed.
  const totalCents = input.lines.reduce(
    (sum, l) => sum + Math.round(l.unit_price * 100) * l.quantity,
    0,
  );
  const taxCents = Math.round(totalCents / 11);
  const subtotalCents = totalCents - taxCents;

  const subtotal = (subtotalCents / 100).toFixed(2);
  const tax = (taxCents / 100).toFixed(2);
  const total = (totalCents / 100).toFixed(2);

  const order = await directusPost<Order>("/items/orders", {
    status: "pending",
    user: input.user_id,
    email: input.email,
    currency: input.currency,
    subtotal,
    tax,
    total,
  });

  const created = await directusPost<Array<{ id: string; booking: string | null }>>(
    "/items/order_items?fields=id,booking",
    input.lines.map((l) => ({
      order: order.id,
      product: l.product_id ?? null,
      lesson: l.lesson_id ?? null,
      booking: l.booking_id ?? null,
      name: l.name,
      slug: l.slug,
      unit_price: l.unit_price.toFixed(2),
      quantity: l.quantity,
      line_total: (l.unit_price * l.quantity).toFixed(2),
    })),
  );

  return { ...order, lines: created.map((c) => ({ id: c.id, booking: c.booking ?? null })) };
}

/** Point each held booking in the order at its order + order_item (Task 8 confirms them on payment). */
export async function linkBookingsToOrder(order: CreatedOrder): Promise<void> {
  await Promise.all(
    order.lines
      .filter((l) => l.booking)
      .map((l) =>
        directusPatch(`/items/bookings/${encodeURIComponent(l.booking!)}?fields=id`, {
          order: order.id,
          order_item: l.id,
        }),
      ),
  );
}

// ── Checkout line resolution ────────────────────────────────────────────────

export type { CheckoutItem };

/** A checkout request the buyer must fix; `body` is returned as JSON with `status`. */
export class CheckoutError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error));
    this.name = "CheckoutError";
    this.status = status;
    this.body = body;
  }
}

const PAID_ORDER_STATUSES = ["paid", "fulfilled"];

async function getOrderStatus(orderId: string): Promise<string | null> {
  try {
    const order = await directusGet<{ status: string }>(`/items/orders/${encodeURIComponent(orderId)}`, {
      "fields[]": "id,status",
    });
    return order?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * Turn the cart's checkout items into priced order lines, using server-side
 * prices only. Throws CheckoutError for holds that are gone / not the
 * caller's (409 hold_expired), lessons whose order is already paid
 * (409 already_paid), packs that need a phone (400 phone_required),
 * and unknown items (400).
 */
export async function resolveCheckoutLines(
  items: CheckoutItem[],
  userId: number,
): Promise<OrderLineInput[]> {
  let contact: Promise<UserContact | null> | null = null;
  const seenBookings = new Set<string>();
  const lines: OrderLineInput[] = [];

  for (const item of items) {
    if (item.kind === "lesson_booking") {
      if (seenBookings.has(item.booking_id)) continue;
      seenBookings.add(item.booking_id);
      const expired = new CheckoutError(409, { error: "hold_expired", booking_id: item.booking_id });
      const booking = typeof item.booking_id === "string" ? await getBooking(item.booking_id) : null;
      if (!booking || booking.userId !== userId) throw expired;
      // A stale cart re-submitting a lesson that was already paid for (and confirmed).
      if (booking.orderId && PAID_ORDER_STATUSES.includes((await getOrderStatus(booking.orderId)) ?? "")) {
        throw new CheckoutError(409, { error: "already_paid", booking_id: booking.id });
      }
      if (
        booking.status !== "held" ||
        !booking.holdExpiresAt ||
        Date.parse(booking.holdExpiresAt) <= Date.now() ||
        booking.lessonId == null
      ) {
        throw expired;
      }
      const lesson = await getLessonById(booking.lessonId);
      if (!lesson || lesson.kind !== "single") throw expired;
      lines.push({
        lesson_id: lesson.id,
        booking_id: booking.id,
        name: booking.whenLabel ? `${lesson.name} — ${booking.whenLabel}` : lesson.name,
        slug: lesson.slug,
        unit_price: lesson.price,
        quantity: 1,
      });
    } else if (item.kind === "lesson_pack") {
      const lesson = Number.isInteger(item.lesson_id) ? await getLessonById(item.lesson_id) : null;
      if (!lesson || lesson.kind !== "pack") {
        throw new CheckoutError(400, { error: "not_purchasable", lesson_id: item.lesson_id });
      }
      if (lesson.requiresPhone) {
        contact ??= getUserContact(userId);
        if (!(await contact)?.phone) throw new CheckoutError(400, { error: "phone_required" });
      }
      lines.push({
        lesson_id: lesson.id,
        name: lesson.name,
        slug: lesson.slug,
        unit_price: lesson.price,
        quantity: 1,
      });
    } else {
      // Missing kind = product (pre-booking carts).
      const products = await getProducts();
      // Cart lines carry the product id; older carts may carry the slug.
      const product =
        products.find((p) => p.id === item.product_id) ??
        products.find((p) => p.slug === item.product_id);
      if (!product) throw new CheckoutError(400, { error: "unknown_product", product_id: item.product_id });
      lines.push({
        product_id: product.id,
        name: product.name,
        slug: product.slug,
        unit_price: product.price,
        quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      });
    }
  }
  return lines;
}

export async function attachPaymentSession(
  orderId: string,
  provider: string,
  sessionId: string,
): Promise<void> {
  await directusPatch(`/items/orders/${orderId}`, {
    status: "awaiting_payment",
    payment_provider: provider,
    payment_session_id: sessionId,
  });
}

/** Order statuses that payment events must not reopen or fulfil. */
export const CLOSED_ORDER_STATUSES = ["cancelled", "refunded"];

export async function markOrderPaid(
  sessionId: string,
  paymentIntentId: string,
): Promise<Order | null> {
  const found = await directusGet<Order[]>("/items/orders", {
    "filter[payment_session_id][_eq]": sessionId,
    "fields[]": "id,status",
    limit: "1",
  });
  const existing = found[0];
  if (!existing) return null;
  // Already paid → return as-is (webhook replays still fulfil). Cancelled / refunded
  // orders must never flip back to paid (e.g. a refund's payment.updated still says COMPLETED).
  if (["paid", "fulfilled", ...CLOSED_ORDER_STATUSES].includes(existing.status)) return existing;

  return await directusPatch<Order>(`/items/orders/${existing.id}`, {
    status: "paid",
    payment_intent_id: paymentIntentId,
    paid_at: new Date().toISOString(),
  });
}

export type OrderWithItems = Order & {
  date_created?: string | null;
  items: Array<{
    id: string;
    name: string;
    slug: string | null;
    quantity: number;
    unit_price: string;
    line_total: string;
  }>;
};

export async function getOrdersForUser(userId: number): Promise<OrderWithItems[]> {
  return await directusGet<OrderWithItems[]>("/items/orders", {
    "filter[user][_eq]": String(userId),
    "fields[]":
      "id,status,user,email,currency,subtotal,tax,total,payment_provider,payment_session_id,payment_intent_id,paid_at,delivered_at,date_created,items.id,items.name,items.slug,items.quantity,items.unit_price,items.line_total",
    "sort[]": "-date_created",
    limit: "100",
  });
}

export async function getOrderForUser(
  orderId: string,
  userId: number,
): Promise<OrderWithItems | null> {
  try {
    const order = await directusGet<OrderWithItems>(
      `/items/orders/${orderId}`,
      {
        "fields[]":
          "id,status,user,email,currency,subtotal,tax,total,payment_provider,payment_session_id,payment_intent_id,paid_at,delivered_at,items.id,items.name,items.slug,items.quantity,items.unit_price,items.line_total",
      },
    );
    if (order.user !== userId) return null;
    return order;
  } catch {
    return null;
  }
}

export type Purchase = {
  id: string;
  name: string;
  quantity: number;
  orderId: string;
  orderStatus: string;
  date: string | null;
};

/** Sheet-music lines (order_items with a product) from the user's paid / fulfilled orders, newest first. */
export async function getPurchasesForUser(userId: number): Promise<Purchase[]> {
  const rows = await directusGet<
    Array<{
      id: string;
      name: string;
      quantity: number;
      order: { id: string; status: string; paid_at: string | null; date_created: string | null } | null;
    }>
  >("/items/order_items", {
    filter: JSON.stringify({
      _and: [
        { order: { user: { _eq: userId } } },
        { order: { status: { _in: ["paid", "fulfilled"] } } },
        { product: { _nnull: true } },
      ],
    }),
    fields: "id,name,quantity,order.id,order.status,order.paid_at,order.date_created",
    sort: "-order.date_created",
    limit: "200",
  });
  return rows
    .filter((r) => r.order)
    .map((r) => ({
      id: r.id,
      name: r.name,
      quantity: r.quantity,
      orderId: r.order!.id,
      orderStatus: r.order!.status,
      date: r.order!.paid_at ?? r.order!.date_created,
    }));
}
