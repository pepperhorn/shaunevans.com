import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Parse a user-entered phone number to E.164 (AU assumed without a `+` prefix); null when invalid. */
export function normalizePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), "AU");
  return parsed && parsed.isValid() ? parsed.number : null;
}
