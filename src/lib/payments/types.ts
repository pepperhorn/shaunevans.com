export type LineItemInput = {
  name: string;
  quantity: number;
  unit_price: number;
};

export type CreatePaymentLinkInput = {
  order_id: string;
  email: string;
  currency: string;
  line_items: LineItemInput[];
  redirect_url: string;
};

export type CreatePaymentLinkResult = {
  url: string;
  session_id: string;
};

export interface PaymentProvider {
  readonly name: "square" | "stripe";
  createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult>;
  verifyWebhookSignature(rawBody: string, signature: string, requestUrl: string): boolean;
  parsePaymentEvent(rawBody: string): {
    payment_session_id?: string;
    payment_intent_id?: string;
    status: "paid" | "failed" | "refunded" | "other";
  } | null;
}
