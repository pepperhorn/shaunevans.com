import type { APIRoute } from "astro";
import {
  cancelConfirmedBooking,
  createBooking,
  getBooking,
  getBookingSettings,
  getLessonById,
  isCreditOverspent,
  updateBookingStatus,
} from "@/lib/booking/repo";
import { canSelfManage } from "@/lib/booking/policy";

export const prerender = false;

type SessionUser = { id: number; email: string; name: string | null };
type RescheduleRequest = { start_at?: string; visitor_tz?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Move the caller's confirmed lesson to a new start. The new booking is created first
 * (same source / credit / order / order line); the original is cancelled only once it exists,
 * so a failed move leaves the student's lesson exactly where it was.
 */
export const POST: APIRoute = async ({ params, request, session }) => {
  try {
    const user = await session?.get<SessionUser>("user");
    if (!user) return json({ error: "auth required" }, 401);

    const body = (await request.json().catch(() => ({}))) as RescheduleRequest;
    const startAt = Date.parse(body.start_at ?? "");
    if (!Number.isFinite(startAt) || !isTimeZone(body.visitor_tz)) {
      return json({ error: "start_at (ISO) and visitor_tz required" }, 400);
    }

    const booking = params.id ? await getBooking(params.id) : null;
    if (!booking) return json({ error: "not found" }, 404);
    if (booking.userId !== user.id) return json({ error: "forbidden" }, 403);
    if (booking.status !== "confirmed") return json({ error: "not_confirmed" }, 409);

    const settings = await getBookingSettings();
    if (!canSelfManage(Date.parse(booking.startAt), Date.now(), settings)) {
      return json({ error: "too_late" }, 409);
    }

    const lesson = booking.lessonId != null ? await getLessonById(booking.lessonId) : null;
    if (!lesson?.durationMinutes) return json({ error: "not_bookable" }, 422);

    const result = await createBooking({
      userId: user.id,
      lessonId: lesson.id,
      startAt,
      durationMins: lesson.durationMinutes,
      status: "confirmed",
      source: booking.source,
      creditId: booking.creditId ?? undefined,
      orderId: booking.orderId ?? undefined,
      orderItemId: booking.orderItemId ?? undefined,
      visitorTz: body.visitor_tz,
      settings,
    });
    if (!result.ok) {
      return result.reason === "conflict"
        ? json({ error: "slot_taken" }, 409)
        : json({ error: "not_bookable" }, 422);
    }

    const undo = (reason: string) =>
      updateBookingStatus(result.id, "cancelled", { cancelled_at: new Date().toISOString(), cancel_reason: reason });

    // The original still counts against the credit until it's cancelled below — leave it out.
    if (booking.creditId && (await isCreditOverspent(booking.creditId, booking.id))) {
      await undo("credit_overspent");
      return json({ error: "no_credits" }, 409);
    }

    if (!(await cancelConfirmedBooking(booking.id, "rescheduled"))) {
      // The original was cancelled/moved meanwhile; don't leave a second live lesson behind.
      await undo("reschedule_conflict");
      return json({ error: "not_confirmed" }, 409);
    }
    return json({ booking_id: result.id, when_label: result.whenLabel }, 201);
  } catch (err) {
    console.error("[bookings/reschedule]", err);
    return json({ error: "reschedule failed" }, 500);
  }
};
