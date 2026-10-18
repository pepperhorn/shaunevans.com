import type { APIRoute } from "astro";
import { countLiveHolds, createBooking, getBookingSettings, getLessonBySlug } from "@/lib/booking/repo";

export const prerender = false;

/** Unexpired holds one user may have at once (stops a signed-in user blocking the grid). */
const MAX_LIVE_HOLDS = 4;

type SessionUser = { id: number; email: string; name: string | null };
type HoldRequest = { lesson_slug?: string; start_at?: string; visitor_tz?: string };

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

/** Hold a single-lesson start for `booking_hold_minutes` while the buyer pays. */
export const POST: APIRoute = async ({ request, session }) => {
  try {
    const user = await session?.get<SessionUser>("user");
    if (!user) return json({ error: "auth required" }, 401);

    const body = (await request.json().catch(() => ({}))) as HoldRequest;
    const startAt = Date.parse(body.start_at ?? "");
    if (!body.lesson_slug || !Number.isFinite(startAt) || !isTimeZone(body.visitor_tz)) {
      return json({ error: "lesson_slug, start_at (ISO) and visitor_tz required" }, 400);
    }

    if ((await countLiveHolds(user.id)) >= MAX_LIVE_HOLDS) {
      return json({ error: "too_many_holds" }, 429);
    }

    const lesson = await getLessonBySlug(body.lesson_slug);
    if (!lesson || lesson.kind !== "single" || !lesson.durationMinutes) {
      return json({ error: "not_bookable" }, 422);
    }

    const result = await createBooking({
      userId: user.id,
      lessonId: lesson.id,
      startAt,
      durationMins: lesson.durationMinutes,
      status: "held",
      source: "purchase",
      visitorTz: body.visitor_tz,
      settings: await getBookingSettings(),
    });
    if (!result.ok) {
      return result.reason === "conflict"
        ? json({ error: "slot_taken" }, 409)
        : json({ error: "not_bookable" }, 422);
    }
    return json(
      {
        booking_id: result.id,
        hold_expires_at: result.holdExpiresAt,
        when_label: result.whenLabel,
        price: lesson.price,
      },
      201,
    );
  } catch (err) {
    console.error("[bookings/hold]", err);
    return json({ error: "hold failed" }, 500);
  }
};
