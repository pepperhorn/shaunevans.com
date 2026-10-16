import type { APIRoute } from "astro";
import { logoutOtpSession, type SessionOtp } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ session }) => {
  try {
    const otp = await session?.get<SessionOtp>("otp");
    if (otp?.token) {
      try {
        await logoutOtpSession(otp.token);
      } catch (err) {
        // Best-effort: never leave the user signed in locally because Directus failed.
        console.error("[auth] signout: server-side revoke failed (continuing):", err);
      }
    }
  } finally {
    await session?.destroy();
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
