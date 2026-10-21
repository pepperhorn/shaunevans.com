import type { APIRoute } from "astro";
import {
  createBooking,
  getActiveCredits,
  getBookingSettings,
  getCreditOwner,
  getLessonById,
  isCreditOverspent,
  updateBookingStatus,
} from "@/lib/booking/repo";

export const prerender = false;

type SessionUser = { id: number; email: string; name: string | null };
type CreditRequest = { credit_id?: string; start_at?: string; visitor_tz?: string };

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

/** Book a confirmed lesson by spending one of the caller's credits (no payment step). */
export const POST: APIRoute = async ({ request, session }) => {
  try {
    const user = await session?.get<SessionUser>("user");
    if (!user) return json({ error: "auth required" }, 401);

    const body = (await request.json().catch(() => ({}))) as CreditRequest;
    const startAt = Date.parse(body.start_at ?? "");
    if (!body.credit_id || !Number.isFinite(startAt) || !isTimeZone(body.visitor_tz)) {
      return json({ error: "credit_id, start_at (ISO) and visitor_tz required" }, 400);
    }

    const owner = await getCreditOwner(body.credit_id);
    if (owner === undefined) return json({ error: "credit_unavailable" }, 422);
    if (owner !== user.id) return json({ error: "forbidden" }, 403);

    const credit = (await getActiveCredits(user.id)).find((c) => c.id === body.credit_id);
    if (!credit) return json({ error: "credit_unavailable" }, 422);

    const lesson = await getLessonById(credit.lessonId);
    if (!lesson?.durationMinutes) return json({ error: "not_bookable" }, 422);

    const result = await createBooking({
      userId: user.id,
      lessonId: lesson.id,
      startAt,
      durationMins: lesson.durationMinutes,
      status: "confirmed",
      source: "credit",
      creditId: credit.id,
      visitorTz: body.visitor_tz,
      settings: await getBookingSettings(),
    });
    if (!result.ok) {
      return result.reason === "conflict"
        ? json({ error: "slot_taken" }, 409)
        : json({ error: "not_bookable" }, 422);
    }
    // Two parallel requests can both pass the remaining > 0 check; the later loser backs out.
    if (await isCreditOverspent(credit.id)) {
      await updateBookingStatus(result.id, "cancelled", {
        cancelled_at: new Date().toISOString(),
        cancel_reason: "credit_overspent",
      });
      return json({ error: "no_credits" }, 409);
    }
    return json({ booking_id: result.id, when_label: result.whenLabel }, 201);
  } catch (err) {
    console.error("[bookings/credit]", err);
    return json({ error: "booking failed" }, 500);
  }
};
