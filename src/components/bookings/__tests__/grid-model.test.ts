import { describe, it, expect } from "vitest";
import { toGridModel } from "@/components/bookings/gridModel";
import { sydneyWallToUtc } from "@/lib/booking/time";
import type { AvailabilityView } from "@/lib/booking/slots";

const M = 60_000;
const syd = (date: string, hhmm: string) => sydneyWallToUtc(date, hhmm);

describe("toGridModel", () => {
  // 13 Oct 2026: Sydney is on AEDT (UTC+11), London still on BST (UTC+1) → 10 h apart.
  it("groups by visitor-local day: a Sydney Tue 07:00 block is London Mon 21:00", () => {
    const start = syd("2026-10-13", "07:00");
    const view: AvailabilityView = {
      blocks: [{ start, end: start + 60 * M }],
      busy: [],
      starts: [start],
    };
    const g = toGridModel(view, ["2026-10-12", "2026-10-13"], "Europe/London", 60);
    expect(g.rows).toEqual(["21:00", "21:30"]);
    expect(g.cells["2026-10-12|21:00"]).toBe("start");
    expect(g.cells["2026-10-12|21:30"]).toBe("available");
    expect(g.cells["2026-10-13|21:00"]).toBe("unavailable");
  });

  it("marks busy half-hours booked and keeps only listed starts selectable", () => {
    const b0 = syd("2026-11-10", "18:00");
    const view: AvailabilityView = {
      blocks: [{ start: b0, end: b0 + 180 * M }], // 18:00–21:00 Sydney
      busy: [{ start: b0 + 60 * M, end: b0 + 120 * M }], // 19:00–20:00 booked
      starts: [b0, b0 + 120 * M], // 18:00 and 20:00
    };
    const g = toGridModel(view, ["2026-11-10"], "Australia/Sydney", 60);
    expect(g.rows).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00", "20:30"]);
    expect(g.cells).toMatchObject({
      "2026-11-10|18:00": "start",
      "2026-11-10|18:30": "available",
      "2026-11-10|19:00": "booked",
      "2026-11-10|19:30": "booked",
      "2026-11-10|20:00": "start",
      "2026-11-10|20:30": "available",
    });
  });

  it("omits half-hours that no day has a block in", () => {
    const a = syd("2026-11-10", "09:00");
    const b = syd("2026-11-11", "18:00");
    const view: AvailabilityView = {
      blocks: [
        { start: a, end: a + 60 * M },
        { start: b, end: b + 30 * M },
      ],
      busy: [],
      starts: [a],
    };
    const g = toGridModel(view, ["2026-11-10", "2026-11-11"], "Australia/Sydney", 60);
    expect(g.rows).toEqual(["09:00", "09:30", "18:00"]);
    expect(g.cells["2026-11-10|18:00"]).toBe("unavailable");
    expect(g.cells["2026-11-11|09:00"]).toBe("unavailable");
    expect(g.cells["2026-11-11|18:00"]).toBe("available");
    expect(Object.keys(g.cells).some((k) => k.endsWith("|12:00"))).toBe(false);
  });

  it("puts an overnight block's after-midnight half-hours on the next day", () => {
    const s = syd("2026-11-10", "22:00");
    const view: AvailabilityView = {
      blocks: [{ start: s, end: s + 180 * M }], // 22:00–01:00 Sydney
      busy: [],
      starts: [s, s + 60 * M, s + 120 * M],
    };
    const g = toGridModel(view, ["2026-11-10", "2026-11-11"], "Australia/Sydney", 60);
    expect(g.rows).toEqual(["00:00", "00:30", "22:00", "22:30", "23:00", "23:30"]);
    expect(g.cells["2026-11-11|00:00"]).toBe("start");
    expect(g.cells["2026-11-10|00:00"]).toBe("unavailable");
    expect(g.cells["2026-11-10|23:00"]).toBe("start");
  });
});
