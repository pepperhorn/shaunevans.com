import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, buildAvailabilityView, computeStarts } from "@/lib/booking/slots";
import { zonedParts, sydneyWallToUtc } from "@/lib/booking/time";
import type { AvailabilityRow } from "@/lib/booking/availability";

const H = 3_600_000;
const M = 60_000;
const day = "2026-11-10";
const at = (hhmm: string) => sydneyWallToUtc(day, hhmm);
const block = (a: string, b: string) => ({ start: at(a), end: at(b) });
const now = at("18:00") - 72 * H;
const labels = (xs: number[]) => xs.map((x) => zonedParts(x, "Australia/Sydney").hhmm);

describe("computeStarts", () => {
  it("fits 60-min lessons on the half hour", () => {
    expect(labels(computeStarts([block("18:00", "21:00")], 60, DEFAULT_SETTINGS, now))).toEqual([
      "18:00", "18:30", "19:00", "19:30", "20:00",
    ]);
  });
  it("allows ending exactly at block end, not a minute over", () => {
    expect(labels(computeStarts([block("18:00", "19:30")], 60, DEFAULT_SETTINGS, now))).toEqual(["18:00", "18:30"]);
    const short = { start: at("18:00"), end: at("19:30") - M };
    expect(labels(computeStarts([short], 60, DEFAULT_SETTINGS, now))).toEqual(["18:00"]);
  });
  it("respects padding", () => {
    const s = { ...DEFAULT_SETTINGS, paddingBeforeMins: 15, paddingAfterMins: 15 };
    expect(labels(computeStarts([block("18:00", "21:00")], 60, s, now))).toEqual(["18:30", "19:00", "19:30"]);
  });
  it("enforces min notice", () => {
    const f = [block("18:00", "19:00")]; // only start is the block start
    expect(computeStarts(f, 60, DEFAULT_SETTINGS, at("18:00") - 23 * H)).toEqual([]);
    expect(computeStarts(f, 60, DEFAULT_SETTINGS, at("18:00") - 25 * H).length).toBeGreaterThan(0);
  });
  it("enforces horizon", () => {
    const far = { start: now + 63 * 24 * H, end: now + 63 * 24 * H + 3 * H };
    expect(computeStarts([far], 60, DEFAULT_SETTINGS, now)).toEqual([]);
  });
});

describe("buildAvailabilityView", () => {
  const rows: AvailabilityRow[] = [
    { id: "a", entry_type: "available", recurrence: "none", day_of_week: null, start_date: day, end_date: null, start_time: "18:00", end_time: "21:00" },
  ];
  it("subtracts busy from blocks", () => {
    const busy = [block("19:00", "20:00")];
    const v = buildAvailabilityView({ rows, busy, fromDate: day, toDate: day, durationMins: 60, settings: DEFAULT_SETTINGS, now });
    expect(v.blocks).toEqual([block("18:00", "21:00")]);
    expect(v.busy).toEqual(busy);
    expect(labels(v.starts)).toEqual(["18:00", "20:00"]);
  });
});
