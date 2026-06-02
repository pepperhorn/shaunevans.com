import { SquareProvider } from "./square";
import type { PaymentProvider } from "./types";

export type { PaymentProvider, CreatePaymentLinkInput, LineItemInput } from "./types";

let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (_provider) return _provider;

  const provider = (import.meta.env.PAYMENT_PROVIDER as string | undefined) ?? "square";

  if (provider === "square") {
    // Sandbox and production are entirely separate Square accounts — different
    // access tokens, location IDs, and webhook signing keys. Pick the right
    // bundle based on SQUARE_ENVIRONMENT so flipping environments is a single
    // env var change instead of a manual swap of three values.
    const environment =
      (import.meta.env.SQUARE_ENVIRONMENT as string | undefined) ?? "sandbox";
    const envUpper = environment === "production" ? "PRODUCTION" : "SANDBOX";
    const env = import.meta.env as Record<string, string | undefined>;
    const accessToken = env[`SQUARE_${envUpper}_ACCESS_TOKEN`];
    const locationId = env[`SQUARE_${envUpper}_LOCATION_ID`];
    const webhookSignatureKey = env[`SQUARE_WEBHOOK_${envUpper}_SIGNATURE_KEY`];

    if (!accessToken || !locationId) {
      throw new Error(
        `Square is configured as payment provider but SQUARE_${envUpper}_ACCESS_TOKEN or SQUARE_${envUpper}_LOCATION_ID is missing`,
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
