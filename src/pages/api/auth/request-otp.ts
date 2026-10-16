import type { APIRoute } from "astro";
import { createUser, findUserByEmail, requestCode } from "@/lib/auth";

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

export const POST: APIRoute = async ({ request }) => {
  let body: { email?: string; name?: string };
  try {
    body = (await request.json()) as { email?: string; name?: string };
  } catch {
    return json({ error: "invalid request body" }, 400);
  }
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return json({ error: "valid email required" }, 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() || undefined : undefined;

  // Best-effort: nothing below may change the response. The extension only
  // sends codes to existing active rows in `users`, so sign-up = create the
  // row first, then request the code.
  try {
    const existing = await findUserByEmail(email);
    if (!existing) {
      await createUser(email, name);
    }
    // Suspended rows: no create, and the extension silently no-ops the send.
    await requestCode(email);
  } catch (err) {
    console.error("[auth] request-otp (non-fatal, response unchanged):", err);
  }

  return json(UNIFORM_OK);
};
