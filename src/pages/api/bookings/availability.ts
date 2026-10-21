import type { APIRoute } from "astro";
import { getBookingSettings, getLessonBySlug, listAvailabilityRows, listBusy } from "@/lib/booking/repo";
import { buildAvailabilityView } from "@/lib/booking/slots";
import { addDaysIso, sydneyWallToUtc, zonedParts, BOOKING_TZ } from "@/lib/booking/time";

export const prerender = false;

const MAX_RANGE_DAYS = 14;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const validDate = (s: string | null): s is string =>
  !!s && DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Days from a to b (YYYY-MM-DD, inclusive count minus one). */
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Public grid data: blocks, busy ranges and bookable starts (epoch ms). No notes or student data. */
export const GET: APIRoute = async ({ url }) => {
  try {
    const slug = url.searchParams.get("lesson");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!slug) return json({ error: "lesson required" }, 400);
    if (!validDate(from) || !validDate(to)) return json({ error: "from/to must be YYYY-MM-DD" }, 400);

    const span = daysBetween(from, to);
    if (span < 0 || span >= MAX_RANGE_DAYS) return json({ error: "range must be 1-14 days" }, 400);

    const settings = await getBookingSettings();
    const now = Date.now();
    // One day of slack either side: visitor-local dates can sit a day off Sydney's.
    const today = zonedParts(now, BOOKING_TZ).date;
    const lastDay = addDaysIso(today, settings.horizonWeeks * 7 + 1);
    if (from < addDaysIso(today, -1) || to > lastDay) return json({ error: "range outside booking horizon" }, 400);

    const lesson = await getLessonBySlug(slug);
    if (!lesson || lesson.kind !== "single" || !lesson.durationMinutes) return json({ error: "unknown lesson" }, 404);

    const [rows, busy] = await Promise.all([
      listAvailabilityRows(),
      listBusy(sydneyWallToUtc(addDaysIso(from, -1), "00:00"), sydneyWallToUtc(addDaysIso(to, 2), "00:00")),
    ]);
    const view = buildAvailabilityView({
      rows,
      busy,
      fromDate: from,
      toDate: to,
      durationMins: lesson.durationMinutes,
      settings,
      now,
    });
    return json(view);
  } catch (err) {
    console.error("[bookings/availability]", err);
    return json({ error: "availability unavailable" }, 500);
  }
};
