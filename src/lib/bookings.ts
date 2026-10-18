import { getBookingSettings, request, type BookingStatus } from "@/lib/booking/repo";
import { canSelfManage } from "@/lib/booking/policy";

function directusBase(): string {
  const url = import.meta.env.DIRECTUS_URL as string | undefined;
  if (!url) throw new Error("DIRECTUS_URL not set");
  return url;
}

function directusToken(): string {
  const t = import.meta.env.DIRECTUS_TOKEN as string | undefined;
  if (!t) throw new Error("DIRECTUS_TOKEN not set");
  return t;
}

export type BookingRequest = {
  id: number;
  status: string | null;
  date_created: string | null;
  name: string;
  email: string;
  package_slug: string;
  instrument: string | null;
  experience_level: string | null;
  notes: string | null;
  preferred_date: string | null;
  time_preference: string | null;
};

export async function getBookingsForEmail(email: string): Promise<BookingRequest[]> {
  const url = new URL(`${directusBase()}/items/booking_requests`);
  url.searchParams.set("filter[email][_eq]", email);
  url.searchParams.set(
    "fields[]",
    "id,status,date_created,name,email,package_slug,instrument,experience_level,notes,preferred_date,time_preference",
  );
  url.searchParams.set("sort[]", "-date_created");
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${directusToken()}` },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: BookingRequest[] };
  return json.data ?? [];
}

// ── Calendar bookings (`bookings` collection) ───────────────────────────────

export type BookingView = {
  id: string;
  lessonName: string;
  /** Lesson type slug — the reschedule link opens the grid on it. */
  lessonSlug: string | null;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  meetLink: string | null;
  canSelfManage: boolean;
};

type RawUserBooking = {
  id: string;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  meet_link: string | null;
  order_item: string | null;
  when_label: string | null;
  lesson: { name: string | null; slug: string | null } | null;
};

/** Booking rows owned by the user (resolved by `bookings.user`, never via `order_items.booking`). */
async function fetchUserBookings(userId: number, statuses: BookingStatus[]): Promise<RawUserBooking[]> {
  return await request<RawUserBooking[]>("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({ user: { _eq: userId }, status: { _in: statuses } }),
      fields: "id,status,start_at,end_at,meet_link,order_item,when_label,lesson.name,lesson.slug",
      sort: "start_at",
      limit: "-1",
    },
  });
}

/** Upcoming confirmed lessons (soonest first) and past lessons (latest first). Cancelled rows are left out. */
export async function getBookingsForUser(
  userId: number,
): Promise<{ upcoming: BookingView[]; past: BookingView[] }> {
  const [rows, settings] = await Promise.all([
    fetchUserBookings(userId, ["confirmed", "completed", "no_show"]),
    getBookingSettings(),
  ]);
  const now = Date.now();
  const upcoming: BookingView[] = [];
  const past: BookingView[] = [];
  for (const r of rows) {
    const start = Date.parse(r.start_at);
    const isUpcoming = r.status === "confirmed" && Date.parse(r.end_at) > now;
    const view: BookingView = {
      id: r.id,
      lessonName: r.lesson?.name ?? "Lesson",
      lessonSlug: r.lesson?.slug ?? null,
      startAt: r.start_at,
      endAt: r.end_at,
      status: r.status,
      meetLink: r.meet_link || null,
      canSelfManage: isUpcoming && canSelfManage(start, now, settings),
    };
    (isUpcoming ? upcoming : past).push(view);
  }
  past.reverse();
  return { upcoming, past };
}

/**
 * When-label per order line for the Orders list. A re-occupied or rescheduled line has several
 * rows; the live one wins, otherwise the latest cancelled one is shown as cancelled.
 */
export async function getLessonTimesByOrderItem(userId: number): Promise<Record<string, string>> {
  const rows = await fetchUserBookings(userId, ["held", "confirmed", "completed", "no_show", "cancelled"]);
  const out: Record<string, string> = {};
  const live = new Set<string>();
  for (const r of rows) {
    if (!r.order_item || !r.when_label) continue;
    const isLive = r.status !== "cancelled";
    if (live.has(r.order_item) && !isLive) continue;
    out[r.order_item] = isLive ? r.when_label : `${r.when_label} (cancelled)`;
    if (isLive) live.add(r.order_item);
  }
  return out;
}
