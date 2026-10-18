import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const BOOKING_TZ = "Australia/Sydney";

/** Epoch ms of a Sydney wall-clock date ("YYYY-MM-DD") and time ("HH:MM"). */
export function sydneyWallToUtc(dateIso: string, hhmm: string): number {
  return dayjs.tz(`${dateIso} ${hhmm}`, "YYYY-MM-DD HH:mm", BOOKING_TZ).valueOf();
}

/** Local date, time and ISO weekday (1=Mon..7=Sun) of an instant in `tz`. */
export function zonedParts(ms: number, tz: string): { date: string; hhmm: string; isoWeekday: number } {
  const d = dayjs(ms).tz(tz);
  return { date: d.format("YYYY-MM-DD"), hhmm: d.format("HH:mm"), isoWeekday: d.day() === 0 ? 7 : d.day() };
}

/** Calendar-date arithmetic on a YYYY-MM-DD string (timezone-free). */
export function addDaysIso(dateIso: string, n: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
