import type { APIRoute } from "astro";
import {
  getOtpSession,
  getUserById,
  markUserVerified,
  verifyCode,
  type SessionOtp,
  type SessionUser,
} from "@/lib/auth";

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const UNAVAILABLE = { error: "Sign-in is temporarily unavailable. Please try again." };

export const POST: APIRoute = async ({ request, session }) => {
  let body: { email?: string; code?: string };
  try {
    body = (await request.json()) as { email?: string; code?: string };
  } catch {
    return json({ error: "invalid request body" }, 400);
  }
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  const code = (typeof body.code === "string" ? body.code : "").replace(/\D/g, "");
  if (!email || !code) {
    return json({ error: "email and code required" }, 400);
  }
  if (!session) {
    return json({ error: "sessions not enabled" }, 500);
  }

  let verified: { token: string; expiresAt: string } | null;
  try {
    verified = await verifyCode(email, code, request.headers.get("user-agent") ?? undefined);
  } catch (err) {
    // 403 = origin refused (missing/wrong OTP_AUTH_CALLER_KEY) — our config, not the user's code.
    console.error("[auth] verify-otp transport failure:", err);
    return json(UNAVAILABLE, 500);
  }
  // Uniform failure for wrong / expired / burned / unknown.
  if (!verified) return json({ error: "invalid or expired code" }, 401);

  // From here on the code is already consumed — failures need a fresh code.
  let user: SessionUser;
  try {
    const otpSession = await getOtpSession(verified.token);
    if (!otpSession?.principalId) throw new Error("no principal on fresh OTP session");
    const row = await getUserById(otpSession.principalId);
    if (!row) throw new Error(`users row ${otpSession.principalId} not readable`);
    user = { id: Number(row.id), email: row.email, name: row.name ?? null };
    try {
      await markUserVerified(row.id);
    } catch (err) {
      console.error("[auth] verify-otp: users PATCH failed (continuing):", err);
    }
  } catch (err) {
    console.error("[auth] verify-otp post-verify failure (code already consumed):", err);
    return json(UNAVAILABLE, 500);
  }

  await session.regenerate();
  session.set("user", user);
  const otp: SessionOtp = {
    token: verified.token,
    expiresAt: verified.expiresAt,
    lastCheckedAt: Date.now(),
  };
  session.set("otp", otp);

  return json({
    ok: true,
    user: { user_id: user.id, email: user.email, name: user.name },
  });
};
