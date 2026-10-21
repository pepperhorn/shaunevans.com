import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";

describe("createRateLimiter", () => {
  it("allows `limit` hits per key per window, then refuses until the window slides", () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect([rl.hit("a"), rl.hit("a"), rl.hit("a"), rl.hit("a")]).toEqual([true, true, true, false]);
    expect(rl.hit("b")).toBe(true);
    t += 59_999;
    expect(rl.hit("a")).toBe(false);
    t += 1;
    expect(rl.hit("a")).toBe(true);
  });

  it("does not record refused hits", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 1, windowMs: 10, now: () => t });
    expect(rl.hit("k")).toBe(true);
    t = 5;
    expect(rl.hit("k")).toBe(false);
    t = 10;
    expect(rl.hit("k")).toBe(true);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": " 1.2.3.4 , 10.0.0.1" } });
    expect(clientIp(req, () => "9.9.9.9")).toBe("1.2.3.4");
  });

  it("falls back to clientAddress, and tolerates it throwing", () => {
    const req = new Request("http://x");
    expect(clientIp(req, () => "9.9.9.9")).toBe("9.9.9.9");
    expect(
      clientIp(req, () => {
        throw new Error("unavailable");
      }),
    ).toBe("unknown");
  });
});
