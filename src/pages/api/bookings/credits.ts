import type { APIRoute } from "astro";
import { getActiveCredits } from "@/lib/booking/repo";

export const prerender = false;

type SessionUser = { id: number; email: string; name: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** The signed-in user's usable lesson credits (oldest expiry first). */
export const GET: APIRoute = async ({ session }) => {
  try {
    const user = await session?.get<SessionUser>("user");
    if (!user) return json({ error: "auth required" }, 401);
    return json({ credits: await getActiveCredits(user.id) });
  } catch (err) {
    console.error("[bookings/credits]", err);
    return json({ error: "credits unavailable" }, 500);
  }
};
