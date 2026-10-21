import type { APIRoute } from "astro";
import { createHash, timingSafeEqual } from "node:crypto";
import { getBookingSettings, listAvailabilityRows, listConfirmedBookingsForFeed } from "@/lib/booking/repo";
import { expandAvailability } from "@/lib/booking/availability";
import { renderIcs, type IcsEvent } from "@/lib/booking/ics";
import { addDaysIso, zonedParts, BOOKING_TZ } from "@/lib/booking/time";

export const prerender = false;

const DAY_MS = 86_400_000;
const ADMIN_BOOKING_URL = "https://content.shaunevans.com/admin/content/bookings/";

/** Runtime env first (built server), then Vite's build-time env (dev). */
function feedToken(): string | undefined {
  return process.env.BOOKINGS_ICS_TOKEN ?? (import.meta.env as Record<string, string | undefined>).BOOKINGS_ICS_TOKEN;
}

/** Constant-time compare; hashing first gives equal-length buffers whatever the input length. */
function tokenMatches(given: string | null): boolean {
  const expected = feedToken();
  if (!expected || !given) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

const notFound = () => new Response("Not found", { status: 404 });

/** Shaun's private calendar subscription: confirmed bookings (+ open availability blocks). */
export const GET: APIRoute = async ({ url }) => {
  if (!tokenMatches(url.searchParams.get("token"))) return notFound();
  try {
    const now = Date.now();
    const settings = await getBookingSettings();
    const horizonEnd = now + (settings.horizonWeeks * 7 + 1) * DAY_MS;
    const includeBlocks = url.searchParams.get("blocks") !== "0";

    const [bookings, rows] = await Promise.all([
      listConfirmedBookingsForFeed(now - 30 * DAY_MS, horizonEnd),
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
      const blocks = expandAvailability(rows, addDaysIso(today, -30), addDaysIso(today, settings.horizonWeeks * 7));
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
