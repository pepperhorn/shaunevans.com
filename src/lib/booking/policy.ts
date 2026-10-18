import dayjs from "dayjs";
import { BOOKING_TZ } from "./time";
import type { BookingSettings } from "./slots";

const HOUR_MS = 3_600_000;

/** Self-service changes are allowed while at least `cancelCutoffHours` remain. */
export function canSelfManage(startAt: number, now: number, s: BookingSettings): boolean {
  return startAt - now >= s.cancelCutoffHours * HOUR_MS;
}

function cityOf(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

/** e.g. "Wed 21 Oct 2026, 09:00–10:00 (London) · 19:00 Sydney" */
export function whenLabel(startAt: number, endAt: number, visitorTz: string): string {
  const s = dayjs(startAt).tz(visitorTz);
  const e = dayjs(endAt).tz(visitorTz);
  const base = `${s.format("ddd D MMM YYYY, HH:mm")}–${e.format("HH:mm")} (${cityOf(visitorTz)})`;
  if (visitorTz === BOOKING_TZ) return base;
  return `${base} · ${dayjs(startAt).tz(BOOKING_TZ).format("HH:mm")} Sydney`;
}
