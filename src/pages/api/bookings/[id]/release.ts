import type { APIRoute } from "astro";
import { getBooking, updateBookingStatus } from "@/lib/booking/repo";

export const prerender = false;

type SessionUser = { id: number; email: string; name: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Give back the caller's own unpaid hold (e.g. they closed the checkout sheet). */
export const POST: APIRoute = async ({ params, session }) => {
  try {
    const user = await session?.get<SessionUser>("user");
    if (!user) return json({ error: "auth required" }, 401);

    const booking = params.id ? await getBooking(params.id) : null;
    // Someone else's booking looks the same as a missing one.
    if (!booking || booking.userId !== user.id) return json({ error: "not found" }, 404);
    if (booking.status !== "held") return json({ error: "not_held" }, 409);

    await updateBookingStatus(booking.id, "cancelled", {
      cancelled_at: new Date().toISOString(),
      cancel_reason: "released",
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[bookings/release]", err);
    return json({ error: "release failed" }, 500);
  }
};
