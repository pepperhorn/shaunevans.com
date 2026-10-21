import type { APIRoute } from "astro";
import { createUser, findUserByEmail, requestCode } from "@/lib/auth";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// One response for every well-formed request — known, unknown, suspended, or
// a downstream failure. Anything that varies here is an account-existence oracle.
const UNIFORM_OK = { ok: true } as const;

const WINDOW_MS = 10 * 60 * 1000;
const ipLimiter = createRateLimiter({ limit: 5, windowMs: WINDOW_MS });
const emailLimiter = createRateLimiter({ limit: 3, windowMs: WINDOW_MS });

export const POST: APIRoute = async (context) => {
  const { request } = context;
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return json({ error: "invalid request body" }, 400);
  }
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return json({ error: "valid email required" }, 400);
  }

  // Over the limit: same response, no work (no row created, no email sent).
  const ip = clientIp(request, () => context.clientAddress);
  if (!ipLimiter.hit(ip) || !emailLimiter.hit(email)) {
    console.warn("[auth] request-otp rate limited", { ip });
    return json(UNIFORM_OK);
  }

  // Best-effort: nothing below may change the response. The extension only
  // sends codes to existing active rows in `users`, so sign-up = create the
  // row first, then request the code.
  try {
    const existing = await findUserByEmail(email);
    if (!existing) {
      // No client-supplied name: an unverified caller shouldn't get to write
      // arbitrary text onto a row tied to someone else's email address.
      await createUser(email);
    }
    // Suspended rows: no create, and the extension silently no-ops the send.
    await requestCode(email);
  } catch (err) {
    console.error("[auth] request-otp (non-fatal, response unchanged):", err);
  }

  return json(UNIFORM_OK);
};
