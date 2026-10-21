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
      process.env.SQUARE_ENVIRONMENT ??
      (import.meta.env.SQUARE_ENVIRONMENT as string | undefined) ??
      "sandbox";
    const envUpper = environment === "production" ? "PRODUCTION" : "SANDBOX";
    // Dynamic keys: `import.meta.env[...]` only holds build-time values, so the
    // built server must read secrets from process.env at runtime. Falls back to
    // the unsplit names documented in CLAUDE.md.
    const meta = import.meta.env as Record<string, string | undefined>;
    const read = (...keys: string[]) => {
      for (const k of keys) {
        const v = process.env[k] ?? meta[k];
        if (v) return v;
      }
      return undefined;
    };
    const accessToken = read(`SQUARE_${envUpper}_ACCESS_TOKEN`, "SQUARE_ACCESS_TOKEN");
    const locationId = read(`SQUARE_${envUpper}_LOCATION_ID`, "SQUARE_LOCATION_ID");
    const webhookSignatureKey = read(
      `SQUARE_WEBHOOK_${envUpper}_SIGNATURE_KEY`,
      "SQUARE_WEBHOOK_SIGNATURE_KEY",
    );

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
