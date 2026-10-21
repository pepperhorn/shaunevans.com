import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findUserByEmail, requestCode } from "@/lib/auth";
import { getOrderForUser } from "@/lib/orders";

type Call = { url: string; headers: Record<string, string> };
let calls: Call[];

const KEYS = ["DIRECTUS_URL", "DIRECTUS_TOKEN", "OTP_AUTH_CALLER_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 });
    }),
  );
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("server secrets are read from process.env at call time", () => {
  it("auth sends the current OTP_AUTH_CALLER_KEY and DIRECTUS_URL", async () => {
    process.env.DIRECTUS_URL = "https://runtime-a.test";
    process.env.OTP_AUTH_CALLER_KEY = "key-a";
    await requestCode("a@b.c");
    process.env.DIRECTUS_URL = "https://runtime-b.test";
    process.env.OTP_AUTH_CALLER_KEY = "key-b";
    await requestCode("a@b.c");

    expect(calls[0].url).toBe("https://runtime-a.test/otp-auth/code");
    expect(calls[0].headers["x-otp-auth-key"]).toBe("key-a");
    expect(calls[1].url).toBe("https://runtime-b.test/otp-auth/code");
    expect(calls[1].headers["x-otp-auth-key"]).toBe("key-b");
  });

  it("auth's users helpers send the current DIRECTUS_TOKEN", async () => {
    process.env.DIRECTUS_URL = "https://cms.test";
    process.env.DIRECTUS_TOKEN = "tok-1";
    await findUserByEmail("a@b.c");
    process.env.DIRECTUS_TOKEN = "tok-2";
    await findUserByEmail("a@b.c");
    expect(calls.map((c) => c.headers.Authorization)).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("orders sends the current DIRECTUS_TOKEN", async () => {
    process.env.DIRECTUS_URL = "https://cms.test";
    process.env.DIRECTUS_TOKEN = "tok-orders";
    await getOrderForUser("o-1", 7);
    expect(calls[0].headers.Authorization).toBe("Bearer tok-orders");
  });
});

// Under Vitest `import.meta.env` is itself backed by process.env, so the
// behavioural tests above can't see build-time inlining. In `astro build`,
// static `import.meta.env.X` member reads are replaced with the build-time
// value, so guard against them in the server modules that hold secrets.
describe("server modules don't use statically-inlined import.meta.env for secrets", () => {
  const files = [
    "lib/auth.ts",
    "lib/orders.ts",
    "lib/bookings.ts",
    "lib/forms.ts",
    "lib/booking/repo.ts",
    "pages/api/forms/submit.ts",
  ];
  const STATIC_READ = /import\.meta\.env\.(DIRECTUS_URL|DIRECTUS_TOKEN|OTP_AUTH_[A-Z_]+)/;
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8");
      expect(src).not.toMatch(STATIC_READ);
    });
  }
});
