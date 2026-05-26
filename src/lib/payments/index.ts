import { SquareProvider } from "./square";
import type { PaymentProvider } from "./types";

export type { PaymentProvider, CreatePaymentLinkInput, LineItemInput } from "./types";

let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (_provider) return _provider;

  const provider = (import.meta.env.PAYMENT_PROVIDER as string | undefined) ?? "square";

  if (provider === "square") {
    const accessToken = import.meta.env.SQUARE_ACCESS_TOKEN as string | undefined;
    const locationId = import.meta.env.SQUARE_LOCATION_ID as string | undefined;
    const webhookSignatureKey = import.meta.env.SQUARE_WEBHOOK_SIGNATURE_KEY as
      | string
      | undefined;
    const environment =
      (import.meta.env.SQUARE_ENVIRONMENT as string | undefined) ?? "sandbox";

    if (!accessToken || !locationId) {
      throw new Error(
        "Square is configured as payment provider but SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID is missing",
      );
    }
    _provider = new SquareProvider({
      accessToken,
      locationId,
      webhookSignatureKey: webhookSignatureKey ?? "",
      environment,
    });
    return _provider;
  }

  throw new Error(`Unknown PAYMENT_PROVIDER: ${provider}`);
}
