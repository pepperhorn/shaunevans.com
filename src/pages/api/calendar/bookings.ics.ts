import type { APIRoute } from "astro";
import { getBookingSettings, listAvailabilityRows, listFeedBookings } from "@/lib/booking/repo";
import { expandAvailability } from "@/lib/booking/availability";
import { icsTokenMatches, renderIcs, type IcsEvent } from "@/lib/booking/ics";
import { addDaysIso, zonedParts, BOOKING_TZ } from "@/lib/booking/time";

export const prerender = false;

const DAY_MS = 86_400_000;
const ADMIN_BOOKING_URL = "https://content.shaunevans.com/admin/content/bookings/";

/** Runtime env first (built server), then Vite's build-time env (dev). */
function feedToken(): string | undefined {
  return process.env.BOOKINGS_ICS_TOKEN ?? (import.meta.env as Record<string, string | undefined>).BOOKINGS_ICS_TOKEN;
}

const notFound = () => new Response("Not found", { status: 404 });

/** Shaun's private calendar subscription: confirmed/completed bookings (+ upcoming open availability blocks). */
export const GET: APIRoute = async ({ url }) => {
  if (!icsTokenMatches(url.searchParams.get("token"), feedToken())) return notFound();
  try {
    const now = Date.now();
    const settings = await getBookingSettings();
    const horizonEnd = now + (settings.horizonWeeks * 7 + 1) * DAY_MS;
    const includeBlocks = url.searchParams.get("blocks") !== "0";

    const [bookings, rows] = await Promise.all([
      listFeedBookings(now - 30 * DAY_MS, horizonEnd),
      includeBlocks ? listAvailabilityRows() : Promise.resolve([]),
    ]);

    const events: IcsEvent[] = bookings.map((b) => ({
      uid: `booking-${b.id}@shaunevans.com`,
      start: Date.parse(b.startAt),
      end: Date.parse(b.endAt),
      summary: `${b.studentName || b.studentEmail || "Student"} — ${b.lessonName || "Lesson"}`,
      description: [
        b.studentEmail && `Email: ${b.studentEmail}`,
        b.studentNotes && `Notes: ${b.studentNotes}`,
        `Meet: ${b.meetLink || "not added yet"}`,
        `Admin: ${ADMIN_BOOKING_URL}${b.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
      url: `${ADMIN_BOOKING_URL}${b.id}`,
    }));

    if (includeBlocks) {
      const today = zonedParts(now, BOOKING_TZ).date;
      const blocks = expandAvailability(rows, today, addDaysIso(today, settings.horizonWeeks * 7));
      for (const blk of blocks) {
        events.push({
          uid: `open-${blk.start}@shaunevans.com`,
          start: blk.start,
          end: blk.end,
          summary: "Open",
          description: "Bookable teaching time",
          transparent: true,
        });
      }
    }

    return new Response(renderIcs(events, now), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[calendar/bookings.ics]", err);
    return new Response("Calendar unavailable", { status: 500 });
  }
};
