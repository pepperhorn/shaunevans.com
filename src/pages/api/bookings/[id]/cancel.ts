import type { APIRoute } from "astro";
import {
  cancelConfirmedBooking,
  bookingHasRefundValue,
  createRefundCredit,
  flagOrderAttention,
  getBooking,
  type BookingRecord,
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

/** Refund credit, retried once (createRefundCredit is idempotent per order line); null after flagging the order. */
async function refundWithRetry(booking: BookingRecord, userId: number, lessonId: number): Promise<string | null> {
  const input = { userId, lessonId, orderItemId: booking.orderItemId };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await createRefundCredit(input);
    } catch (err) {
      console.error(
        `[bookings/cancel] refund credit attempt ${attempt} failed for booking ${booking.id} (order_item ${booking.orderItemId ?? "none"})`,
        err,
      );
    }
  }
  if (booking.orderId) {
    await flagOrderAttention(
      booking.orderId,
      `Refund credit for booking ${booking.id} could not be created — add 1 credit by hand.`,
    ).catch((err) => console.error(`[bookings/cancel] could not flag order ${booking.orderId}`, err));
  }
  return null;
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

    const refundEligible = await bookingHasRefundValue(booking);

    // Compare-and-set: a parallel cancel/reschedule that got there first wins, we create nothing.
    if (!(await cancelConfirmedBooking(booking.id, "student_cancelled"))) {
      return json({ error: "not_confirmed" }, 409);
    }

    if (!refundEligible || booking.lessonId == null) return json({ ok: true, credit_id: null });

    // The cancel has committed, so a failed credit must not fail the request (a retry would get
    // not_confirmed and the student would lose the lesson). Retry once, then hand it to Shaun.
    const creditId = await refundWithRetry(booking, user.id, booking.lessonId);
    if (creditId) return json({ ok: true, credit_id: creditId });
    return json({ ok: true, credit_id: null, credit_pending: true });
  } catch (err) {
    console.error("[bookings/cancel]", err);
    return json({ error: "cancel failed" }, 500);
  }
};
