import { addDaysIso, sydneyWallToUtc } from "./time";

/** Half-open interval of epoch ms. */
export type Interval = { start: number; end: number };

export type AvailabilityRow = {
  id: string;
  entry_type: "available" | "unavailable";
  recurrence: "none" | "weekly" | "fortnightly";
  day_of_week: number | null; // ISO 1=Mon..7=Sun
  start_date: string;
  end_date: string | null; // YYYY-MM-DD, Sydney dates
  start_time: string;
  end_time: string; // "HH:MM" Sydney; end <= start => ends next day
};

const DAY_MS = 86_400_000;

function isoWeekday(dateIso: string): number {
  const d = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Ported from crf-newsched availabilityActiveOn, plus weekday matching. */
export function rowActiveOn(row: AvailabilityRow, dateIso: string): boolean {
  const { start_date: start, recurrence } = row;
  if (recurrence === "none") return dateIso >= start && dateIso <= (row.end_date ?? start);
  if (row.end_date && row.end_date < start) return false;
  if (dateIso < start) return false;
  if (row.end_date && dateIso > row.end_date) return false;
  if (row.day_of_week !== isoWeekday(dateIso)) return false;
  if (recurrence === "fortnightly") {
    // whole weeks between the Mondays of start_date's and dateIso's weeks
    const monday = (iso: string) => new Date(`${addDaysIso(iso, 1 - isoWeekday(iso))}T00:00:00Z`).getTime();
    const weeks = Math.round((monday(dateIso) - monday(start)) / (7 * DAY_MS));
    return weeks >= 0 && weeks % 2 === 0;
  }
  return true;
}

export function mergeIntervals(xs: Interval[]): Interval[] {
  const sorted = xs.filter((x) => x.end > x.start).map((x) => ({ ...x })).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push(x);
  }
  return out;
}

export function subtractIntervals(from: Interval[], minus: Interval[]): Interval[] {
  const cuts = mergeIntervals(minus);
  const out: Interval[] = [];
  for (const f of mergeIntervals(from)) {
    let cur = f.start;
    for (const c of cuts) {
      if (c.end <= cur || c.start >= f.end) continue;
      if (c.start > cur) out.push({ start: cur, end: c.start });
      cur = Math.max(cur, c.end);
    }
    if (cur < f.end) out.push({ start: cur, end: f.end });
  }
  return out;
}

function rowInterval(row: AvailabilityRow, dateIso: string): Interval {
  const overnight = row.end_time <= row.start_time;
  return {
    start: sydneyWallToUtc(dateIso, row.start_time),
    end: sydneyWallToUtc(overnight ? addDaysIso(dateIso, 1) : dateIso, row.end_time),
  };
}

/**
 * Available minus unavailable, merged. fromDate/toDate are inclusive Sydney
 * dates; a row contributes the interval that STARTS on each active date.
 * Unavailable rows are also scanned from the day before fromDate so an
 * overnight block spilling into fromDate still cuts.
 */
export function expandAvailability(rows: AvailabilityRow[], fromDate: string, toDate: string): Interval[] {
  const avail: Interval[] = [];
  const blocked: Interval[] = [];
  for (let d = addDaysIso(fromDate, -1); d <= toDate; d = addDaysIso(d, 1)) {
    for (const r of rows) {
      if (!rowActiveOn(r, d)) continue;
      if (r.entry_type === "unavailable") blocked.push(rowInterval(r, d));
      else if (d >= fromDate) avail.push(rowInterval(r, d));
    }
  }
  return subtractIntervals(mergeIntervals(avail), blocked);
}
