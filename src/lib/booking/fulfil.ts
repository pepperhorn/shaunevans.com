/**
 * Post-payment fulfilment (server-only). After Square marks an order paid:
 * confirm its held bookings (re-occupying the slot if the hold already
 * expired) and create lesson_credits for pack lines. Idempotent — the
 * webhook calls it on every `paid` delivery, including replays.
 */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { createBooking, getBookingSettings, request, type BookingStatus } from "./repo";
import { BOOKING_TZ } from "./time";

dayjs.extend(utc);

const DEFAULT_CREDIT_EXPIRY_MONTHS = 12;
/** Cancel reasons that mean the hold lapsed before payment (repo expireStaleHolds / release route) — the only ones re-occupied. */
const LAPSED_HOLD_REASONS = ["hold_expired", "released"];

type RawOrder = { id: string; user: number | null; paid_at: string | null; notes: string | null };

type RawBooking = {
  id: string;
  status: BookingStatus;
  user: number | null;
  lesson: number | null;
  start_at: string;
  end_at: string;
  visitor_timezone: string | null;
  order: string | null;
  cancel_reason: string | null;
};

type RawLine = {
  id: string;
  lesson: {
    id: number;
    kind: string | null;
    credits: number | null;
    credit_lesson: number | null;
    credit_expiry_months: number | null;
  } | null;
  booking: RawBooking | null;
};

export type FulfilResult = { confirmed: string[]; credits: string[]; attention: string[] };

export const supersededNote = (bookingId: string) =>
  `Booking ${bookingId} belongs to a newer order — this payment may be a duplicate; refund if so.`;
export const slotTakenNote = (bookingId: string) =>
  `Booking ${bookingId} could not be confirmed: slot taken after hold expired — refund or rebook.`;

export async function fulfillPaidOrder(orderId: string): Promise<FulfilResult> {
  const id = encodeURIComponent(orderId);
  const order = await request<RawOrder>("GET", `/items/orders/${id}`, {
    params: { fields: "id,user,paid_at,notes" },
  });
  const lines = await request<RawLine[]>("GET", "/items/order_items", {
    params: {
      filter: JSON.stringify({ order: { _eq: orderId } }),
      fields: [
        "id",
        "lesson.id,lesson.kind,lesson.credits,lesson.credit_lesson,lesson.credit_expiry_months",
        "booking.id,booking.status,booking.user,booking.lesson,booking.start_at,booking.end_at,booking.visitor_timezone,booking.order,booking.cancel_reason",
      ].join(","),
      limit: "-1",
    },
  });

  const existingNotes = order.notes ?? "";
  const result: FulfilResult = { confirmed: [], credits: [], attention: [] };
  const flag = (msg: string) => result.attention.push(msg);

  for (const line of lines) {
    const b = line.booking;
    if (b) {
      // Ruling R8: a re-checkout re-points the hold at the newer order; never confirm it from this one.
      if (b.order !== orderId) {
        flag(supersededNote(b.id));
      } else if (b.status === "held") {
        await request("PATCH", `/items/bookings/${encodeURIComponent(b.id)}`, {
          params: { fields: "id" },
          body: { status: "confirmed", hold_expires_at: null },
        });
        result.confirmed.push(b.id);
      } else if (b.status === "cancelled" && LAPSED_HOLD_REASONS.includes(b.cancel_reason ?? "")) {
        const outcome = await reoccupy(order, line.id, b, existingNotes);
        if (outcome.kind === "confirmed") result.confirmed.push(outcome.id);
        else if (outcome.kind === "attention") flag(slotTakenNote(b.id));
      }
      // confirmed / completed / no_show, or cancelled for any other reason (e.g. Shaun
      // cancelled + refunded in admin): already handled — never re-book.
    }

    const lesson = line.lesson;
    if (lesson?.kind === "pack") {
      if (order.user == null) {
        flag(`Order item ${line.id}: pack ${lesson.id} paid but the order has no user — add credits by hand.`);
        continue;
      }
      if (!lesson.credits || lesson.credit_lesson == null) {
        flag(`Order item ${line.id}: pack ${lesson.id} has no credits / credit lesson configured — add credits by hand.`);
        continue;
      }
      const creditId = await ensurePackCredits(order, line.id, lesson);
      if (creditId) result.credits.push(creditId);
    }
  }

  const newLines = result.attention.filter((m) => !existingNotes.split("\n").includes(m));
  if (newLines.length > 0) {
    await request("PATCH", `/items/orders/${id}`, {
      params: { fields: "id" },
      body: {
        needs_attention: true,
        notes: [existingNotes, ...newLines].filter(Boolean).join("\n"),
      },
    });
  }
  return result;
}

/**
 * The hold expired (swept to cancelled) before payment landed: book the same
 * time again as `confirmed` (Ruling R2 — only the DB overlap constraint
 * decides). Skips if a replacement for this line already exists, or if an
 * earlier run already flagged the slot as taken.
 */
async function reoccupy(
  order: RawOrder,
  orderItemId: string,
  b: RawBooking,
  existingNotes: string,
): Promise<{ kind: "confirmed"; id: string } | { kind: "attention" } | { kind: "done" }> {
  if (existingNotes.split("\n").includes(slotTakenNote(b.id))) return { kind: "attention" };

  // Any other booking for this line (in any status, even cancelled) means a replacement was already made.
  const replacement = await request<Array<{ id: string }>>("GET", "/items/bookings", {
    params: {
      filter: JSON.stringify({ order_item: { _eq: orderItemId }, id: { _neq: b.id } }),
      fields: "id",
      limit: "1",
    },
  });
  if (replacement.length > 0) return { kind: "done" };

  const userId = b.user ?? order.user;
  const startAt = Date.parse(b.start_at);
  const durationMins = Math.round((Date.parse(b.end_at) - startAt) / 60_000);
  if (userId == null || b.lesson == null || !(durationMins > 0)) return { kind: "attention" };

  const res = await createBooking({
    userId,
    lessonId: b.lesson,
    startAt,
    durationMins,
    status: "confirmed",
    source: "purchase",
    visitorTz: b.visitor_timezone || BOOKING_TZ,
    settings: await getBookingSettings(),
    skipAvailabilityCheck: true,
    orderId: order.id,
    orderItemId,
  });
  return res.ok ? { kind: "confirmed", id: res.id } : { kind: "attention" };
}

/**
 * One lesson_credits row per pack order_item (enforced by the partial unique index
 * lesson_credits_one_per_pack_item); returns the new id, or null if it already exists.
 */
async function ensurePackCredits(
  order: RawOrder,
  orderItemId: string,
  pack: NonNullable<RawLine["lesson"]>,
): Promise<string | null> {
  if ((await findPackCredit(orderItemId)) !== null) return null;

  const months = pack.credit_expiry_months ?? DEFAULT_CREDIT_EXPIRY_MONTHS;
  const paidAt = order.paid_at ? dayjs.utc(order.paid_at) : dayjs.utc();
  const body = {
    status: "active",
    user: order.user,
    pack: pack.id,
    lesson: pack.credit_lesson,
    order_item: orderItemId,
    credits_total: pack.credits,
    expires_at: paidAt.add(months, "month").toISOString(),
  };
  try {
    const created = await request<{ id: string }>("POST", "/items/lesson_credits", { params: { fields: "id" }, body });
    return created.id;
  } catch (err) {
    // A parallel delivery won the unique index lesson_credits_one_per_pack_item (se-cms answers
    // 400 RECORD_NOT_UNIQUE); any failure with the row now present counts as done.
    if ((await findPackCredit(orderItemId)) !== null) return null;
    throw err;
  }
}

async function findPackCredit(orderItemId: string): Promise<string | null> {
  const rows = await request<Array<{ id: string }>>("GET", "/items/lesson_credits", {
    params: {
      filter: JSON.stringify({ order_item: { _eq: orderItemId }, pack: { _nnull: true } }),
      fields: "id",
      limit: "1",
    },
  });
  return rows[0]?.id ?? null;
}
