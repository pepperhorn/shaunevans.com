import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CreatePaymentLinkInput,
  CreatePaymentLinkResult,
  PaymentProvider,
} from "./types";

const SQUARE_API_VERSION = "2025-01-23";

function squareBaseUrl(env: string): string {
  return env === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export class SquareProvider implements PaymentProvider {
  readonly name = "square" as const;
  private readonly accessToken: string;
  private readonly locationId: string;
  private readonly webhookSignatureKey: string;
  private readonly baseUrl: string;

  constructor(opts: {
    accessToken: string;
    locationId: string;
    webhookSignatureKey: string;
    environment: string;
  }) {
    this.accessToken = opts.accessToken;
    this.locationId = opts.locationId;
    this.webhookSignatureKey = opts.webhookSignatureKey;
    this.baseUrl = squareBaseUrl(opts.environment);
  }

  async createPaymentLink(
    input: CreatePaymentLinkInput,
  ): Promise<CreatePaymentLinkResult> {
    const body = {
      idempotency_key: randomUUID(),
      order: {
        location_id: this.locationId,
        line_items: input.line_items.map((li) => ({
          name: li.name,
          quantity: String(li.quantity),
          base_price_money: {
            amount: Math.round(li.unit_price * 100),
            currency: input.currency,
          },
        })),
      },
      checkout_options: {
        redirect_url: input.redirect_url,
        ask_for_shipping_address: false,
      },
      pre_populated_data: { buyer_email: input.email },
      payment_note: `Order ${input.order_id}`,
    };

    const res = await fetch(`${this.baseUrl}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Square payment link creation failed: ${res.status} ${text}`);
    }

    const json = (await res.json()) as {
      payment_link?: { id?: string; url?: string };
    };
    const url = json.payment_link?.url;
    const id = json.payment_link?.id;
    if (!url || !id) {
      throw new Error("Square response missing payment_link.url/id");
    }
    return { url, session_id: id };
  }

  verifyWebhookSignature(rawBody: string, signature: string, requestUrl: string): boolean {
    if (!signature || !this.webhookSignatureKey) return false;
    const expected = createHmac("sha256", this.webhookSignatureKey)
      .update(requestUrl + rawBody)
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parsePaymentEvent(rawBody: string): ReturnType<PaymentProvider["parsePaymentEvent"]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const evt = parsed as {
      type?: string;
      data?: { object?: { payment?: Record<string, unknown> } };
    };
    const payment = evt.data?.object?.payment as
      | { id?: string; order_id?: string; status?: string }
      | undefined;
    if (!payment) return null;

    const statusMap: Record<string, "paid" | "failed" | "refunded" | "other"> = {
      COMPLETED: "paid",
      APPROVED: "paid",
      FAILED: "failed",
      CANCELED: "failed",
    };
    const status = statusMap[payment.status ?? ""] ?? "other";

    return {
      payment_session_id: payment.order_id,
      payment_intent_id: payment.id,
      status,
    };
  }
}
