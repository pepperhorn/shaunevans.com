import type { APIRoute } from "astro";
import {
  cancelConfirmedBooking,
  createRefundCredit,
  getBooking,
  getBookingSettings,
} from "@/lib/booking/repo";
import { canSelfManage } from "@/lib/booking/policy";

export const prerender = false;

type SessionUser = { id: number; email: string; name: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Student cancels their own confirmed lesson (outside the cutoff). A paid single becomes a
 * 1-lesson credit; a credit booking simply stops consuming its credit.
 */
export const POST: APIRoute = async ({ params, session }) => {
  try {
    const user = await session?.get<SessionUser>("user");
    if (!user) return json({ error: "auth required" }, 401);

    const booking = params.id ? await getBooking(params.id) : null;
    if (!booking) return json({ error: "not found" }, 404);
    if (booking.userId !== user.id) return json({ error: "forbidden" }, 403);
    if (booking.status !== "confirmed") return json({ error: "not_confirmed" }, 409);

    const settings = await getBookingSettings();
    if (!canSelfManage(Date.parse(booking.startAt), Date.now(), settings)) {
      return json({ error: "too_late" }, 409);
    }

    // Compare-and-set: a parallel cancel/reschedule that got there first wins, we create nothing.
    if (!(await cancelConfirmedBooking(booking.id, "student_cancelled"))) {
      return json({ error: "not_confirmed" }, 409);
    }

    let creditId: string | null = null;
    if (booking.source === "purchase" && booking.lessonId != null) {
      creditId = await createRefundCredit({
        userId: user.id,
        lessonId: booking.lessonId,
        orderItemId: booking.orderItemId,
      });
    }
    return json({ ok: true, credit_id: creditId });
  } catch (err) {
    console.error("[bookings/cancel]", err);
    return json({ error: "cancel failed" }, 500);
  }
};
