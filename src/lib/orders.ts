function directusBase(): string {
  const url = import.meta.env.DIRECTUS_URL as string | undefined;
  if (!url) throw new Error("DIRECTUS_URL not set");
  return url;
}

function directusToken(): string {
  const t = import.meta.env.DIRECTUS_TOKEN as string | undefined;
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

export type NewOrderLine = {
  product_id: string;
  name: string;
  slug: string;
  unit_price: number;
  quantity: number;
};

export type NewOrderInput = {
  user_id: number;
  email: string;
  currency: string;
  lines: NewOrderLine[];
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

export async function createOrder(input: NewOrderInput): Promise<Order> {
  const subtotal = input.lines.reduce(
    (sum, l) => sum + l.unit_price * l.quantity,
    0,
  );
  const tax = 0;
  const total = subtotal + tax;

  const order = await directusPost<Order>("/items/orders", {
    status: "pending",
    user: input.user_id,
    email: input.email,
    currency: input.currency,
    subtotal: subtotal.toFixed(2),
    tax: tax.toFixed(2),
    total: total.toFixed(2),
  });

  await directusPost("/items/order_items", input.lines.map((l) => ({
    order: order.id,
    product: l.product_id,
    name: l.name,
    slug: l.slug,
    unit_price: l.unit_price.toFixed(2),
    quantity: l.quantity,
    line_total: (l.unit_price * l.quantity).toFixed(2),
  })));

  return order;
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
  if (existing.status === "paid" || existing.status === "fulfilled") return existing;

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
