import { describe, it, expect } from "vitest";
import { canSelfManage, whenLabel } from "@/lib/booking/policy";
import { DEFAULT_SETTINGS } from "@/lib/booking/slots";

const H = 3_600_000;
const M = 60_000;

describe("canSelfManage", () => {
  const start = Date.UTC(2026, 10, 10, 8, 0);
  it("true at exactly the cutoff", () => expect(canSelfManage(start, start - 24 * H, DEFAULT_SETTINGS)).toBe(true));
  it("false one minute inside", () => expect(canSelfManage(start, start - 24 * H + M, DEFAULT_SETTINGS)).toBe(false));
});

describe("whenLabel", () => {
  const s = Date.UTC(2026, 9, 21, 8, 0);
  it("shows visitor zone plus Sydney", () => {
    expect(whenLabel(s, s + H, "Europe/London")).toBe("Wed 21 Oct 2026, 09:00–10:00 (London) · 19:00 Sydney");
  });
  it("omits the Sydney suffix for Sydney visitors", () => {
    expect(whenLabel(s, s + H, "Australia/Sydney")).toBe("Wed 21 Oct 2026, 19:00–20:00 (Sydney)");
  });
});
