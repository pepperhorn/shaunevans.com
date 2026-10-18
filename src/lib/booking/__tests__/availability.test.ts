import { describe, it, expect } from "vitest";
import {
  expandAvailability,
  mergeIntervals,
  rowActiveOn,
  subtractIntervals,
  type AvailabilityRow,
} from "@/lib/booking/availability";
import { addDaysIso, sydneyWallToUtc, zonedParts } from "@/lib/booking/time";

const row = (o: Partial<AvailabilityRow>): AvailabilityRow => ({
  id: "r",
  entry_type: "available",
  recurrence: "weekly",
  day_of_week: 2,
  start_date: "2026-01-06",
  end_date: null,
  start_time: "19:00",
  end_time: "21:00",
  ...o,
});

describe("time helpers", () => {
  it("converts Sydney wall time to UTC across DST", () => {
    expect(sydneyWallToUtc("2026-10-20", "19:00")).toBe(Date.UTC(2026, 9, 20, 8, 0));
    expect(sydneyWallToUtc("2026-06-16", "19:00")).toBe(Date.UTC(2026, 5, 16, 9, 0));
  });
  it("zonedParts gives local date, time and ISO weekday", () => {
    const ms = sydneyWallToUtc("2026-10-20", "07:00");
    expect(zonedParts(ms, "Australia/Sydney")).toEqual({ date: "2026-10-20", hhmm: "07:00", isoWeekday: 2 });
    expect(zonedParts(ms, "Europe/London")).toEqual({ date: "2026-10-19", hhmm: "21:00", isoWeekday: 1 });
    expect(zonedParts(sydneyWallToUtc("2026-10-25", "10:00"), "Australia/Sydney").isoWeekday).toBe(7);
  });
  it("addDaysIso", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("expandAvailability", () => {
  it("weekly Tue 19:00-21:00 AEDT", () => {
    expect(expandAvailability([row({})], "2026-10-20", "2026-10-20")).toEqual([
      { start: Date.UTC(2026, 9, 20, 8, 0), end: Date.UTC(2026, 9, 20, 10, 0) },
    ]);
  });
  it("same block in AEST", () => {
    const r = expandAvailability([row({})], "2026-06-16", "2026-06-16");
    expect(r[0].start).toBe(Date.UTC(2026, 5, 16, 9, 0));
  });
  it("stays 19:00 Sydney either side of DST change", () => {
    expect(expandAvailability([row({})], "2026-04-07", "2026-04-07")[0].start).toBe(Date.UTC(2026, 3, 7, 9, 0));
    expect(expandAvailability([row({})], "2026-10-06", "2026-10-06")[0].start).toBe(Date.UTC(2026, 9, 6, 8, 0));
  });
  it("fortnightly parity", () => {
    const r = row({ recurrence: "fortnightly", start_date: "2026-10-20" });
    expect(rowActiveOn(r, "2026-11-03")).toBe(true);
    expect(rowActiveOn(r, "2026-10-27")).toBe(false);
    expect(rowActiveOn(r, "2026-10-13")).toBe(false);
  });
  it("unavailable one-off cuts available", () => {
    const rows = [
      row({ start_time: "18:00", end_time: "21:00" }),
      row({
        id: "u", entry_type: "unavailable", recurrence: "none", day_of_week: null,
        start_date: "2026-10-20", end_date: null, start_time: "19:00", end_time: "20:00",
      }),
    ];
    expect(expandAvailability(rows, "2026-10-20", "2026-10-20")).toEqual([
      { start: sydneyWallToUtc("2026-10-20", "18:00"), end: sydneyWallToUtc("2026-10-20", "19:00") },
      { start: sydneyWallToUtc("2026-10-20", "20:00"), end: sydneyWallToUtc("2026-10-20", "21:00") },
    ]);
  });
  it("unavailable date range blocks whole days", () => {
    const rows = [
      row({ recurrence: "none", day_of_week: null, start_date: "2026-12-01", end_date: "2026-12-31", start_time: "09:00", end_time: "17:00" }),
      row({ id: "u", entry_type: "unavailable", recurrence: "none", day_of_week: null, start_date: "2026-12-24", end_date: "2026-12-28", start_time: "00:00", end_time: "00:00" }),
    ];
    const out = expandAvailability(rows, "2026-12-25", "2026-12-25");
    expect(out).toEqual([]);
    expect(expandAvailability(rows, "2026-12-23", "2026-12-23")).toHaveLength(1);
    expect(expandAvailability(rows, "2026-12-29", "2026-12-29")).toHaveLength(1);
  });
  it("overnight block ends next day", () => {
    const r = row({ day_of_week: 5, start_time: "22:00", end_time: "01:00" });
    expect(expandAvailability([r], "2026-10-23", "2026-10-23")).toEqual([
      { start: sydneyWallToUtc("2026-10-23", "22:00"), end: sydneyWallToUtc("2026-10-24", "01:00") },
    ]);
  });
  it("end_date null is open-ended; past end_date excludes", () => {
    expect(rowActiveOn(row({ end_date: null }), "2030-01-01")).toBe(true);
    expect(rowActiveOn(row({ end_date: "2026-01-01" }), "2026-10-20")).toBe(false);
    expect(rowActiveOn(row({ start_date: "2026-11-01" }), "2026-10-20")).toBe(false);
  });
  it("none recurrence with null end_date is just start_date", () => {
    const r = row({ recurrence: "none", day_of_week: null, start_date: "2026-10-20" });
    expect(rowActiveOn(r, "2026-10-20")).toBe(true);
    expect(rowActiveOn(r, "2026-10-21")).toBe(false);
  });
});

describe("interval helpers", () => {
  it("mergeIntervals joins touching and overlapping", () => {
    expect(mergeIntervals([{ start: 5, end: 8 }, { start: 0, end: 5 }, { start: 7, end: 9 }, { start: 20, end: 30 }])).toEqual([
      { start: 0, end: 9 }, { start: 20, end: 30 },
    ]);
  });
  it("subtractIntervals full/partial/none", () => {
    const from = [{ start: 10, end: 20 }];
    expect(subtractIntervals(from, [{ start: 0, end: 30 }])).toEqual([]);
    expect(subtractIntervals(from, [{ start: 15, end: 25 }])).toEqual([{ start: 10, end: 15 }]);
    expect(subtractIntervals(from, [{ start: 12, end: 14 }])).toEqual([{ start: 10, end: 12 }, { start: 14, end: 20 }]);
    expect(subtractIntervals(from, [{ start: 30, end: 40 }])).toEqual(from);
  });
});
