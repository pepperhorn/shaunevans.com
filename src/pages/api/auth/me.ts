import type { APIRoute } from "astro";
import { getOtpSession, type SessionOtp, type SessionUser } from "@/lib/auth";

export const prerender = false;

// Re-validate the OTP token against Directus at most this often per session.
const REVALIDATE_MS = 5 * 60_000;

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ session }) => {
  if (!session) return json({ user: null });

  const user = await session.get<SessionUser>("user");
  if (!user) return json({ user: null });

  const otp = await session.get<SessionOtp>("otp");
  if (!otp?.token) {
    // Pre-extension session (or a half-written one) — no server credential to trust.
    await session.destroy();
    return json({ user: null });
  }

  const expired = otp.expiresAt && Date.parse(otp.expiresAt) <= Date.now();
  if (expired) {
    await session.destroy();
    return json({ user: null });
  }

  if (Date.now() - (otp.lastCheckedAt ?? 0) > REVALIDATE_MS) {
    try {
      const live = await getOtpSession(otp.token);
      if (!live || String(live.principalId) !== String(user.id)) {
        await session.destroy();
        return json({ user: null });
      }
      session.set("otp", {
        ...otp,
        expiresAt: live.expiresAt || otp.expiresAt,
        lastCheckedAt: Date.now(),
      } satisfies SessionOtp);
    } catch (err) {
      // Directus unreachable — keep the local session rather than signing everyone out.
      console.error("[auth] me: OTP revalidation failed (keeping session):", err);
    }
  }

  return json({ user: { user_id: user.id, email: user.email, name: user.name } });
};
