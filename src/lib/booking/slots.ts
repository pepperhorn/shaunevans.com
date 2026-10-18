import {
  expandAvailability,
  subtractIntervals,
  type AvailabilityRow,
  type Interval,
} from "./availability";

export type BookingSettings = {
  minNoticeHours: number;
  horizonWeeks: number;
  paddingBeforeMins: number;
  paddingAfterMins: number;
  holdMinutes: number;
  slotStepMins: number;
  cancelCutoffHours: number;
  notifyEmail: string;
};

export const DEFAULT_SETTINGS: BookingSettings = {
  minNoticeHours: 24,
  horizonWeeks: 8,
  paddingBeforeMins: 0,
  paddingAfterMins: 0,
  holdMinutes: 15,
  slotStepMins: 30,
  cancelCutoffHours: 24,
  notifyEmail: "shaun@shaunevans.com",
};

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Grow an interval by the before/after padding. */
export function padInterval(i: Interval, s: BookingSettings): Interval {
  return { start: i.start - s.paddingBeforeMins * MIN_MS, end: i.end + s.paddingAfterMins * MIN_MS };
}

/**
 * Bookable start instants (epoch ms) for a lesson of `durationMins`.
 * Candidates sit on multiples of `slotStepMins` (UTC alignment equals Sydney
 * alignment because offsets are whole hours). A start is kept when its padded
 * lesson fits inside one free interval and lies within [now + notice, now + horizon].
 */
export function computeStarts(free: Interval[], durationMins: number, s: BookingSettings, now: number): number[] {
  const step = s.slotStepMins * MIN_MS;
  const before = s.paddingBeforeMins * MIN_MS;
  const span = durationMins * MIN_MS + s.paddingAfterMins * MIN_MS;
  const earliest = now + s.minNoticeHours * HOUR_MS;
  const latest = now + s.horizonWeeks * 7 * 24 * HOUR_MS;
  const starts = new Set<number>();
  for (const f of free) {
    let t = Math.ceil(Math.max(f.start + before, earliest) / step) * step;
    for (; t <= latest && t - before >= f.start && t + span <= f.end; t += step) starts.add(t);
  }
  return [...starts].sort((a, b) => a - b);
}

export type AvailabilityView = { blocks: Interval[]; busy: Interval[]; starts: number[] };

export function buildAvailabilityView(args: {
  rows: AvailabilityRow[];
  busy: Interval[]; // already padded (stored busy_start/busy_end)
  fromDate: string;
  toDate: string;
  durationMins: number;
  settings: BookingSettings;
  now: number;
}): AvailabilityView {
  const blocks = expandAvailability(args.rows, args.fromDate, args.toDate);
  const free = subtractIntervals(blocks, args.busy);
  return {
    blocks,
    busy: args.busy,
    starts: computeStarts(free, args.durationMins, args.settings, args.now),
  };
}
