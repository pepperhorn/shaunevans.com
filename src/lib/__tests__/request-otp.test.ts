import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUserByEmail = vi.fn();
const createUser = vi.fn();
const requestCode = vi.fn();

vi.mock("@/lib/auth", () => ({
  findUserByEmail: (...a: unknown[]) => findUserByEmail(...a),
  createUser: (...a: unknown[]) => createUser(...a),
  requestCode: (...a: unknown[]) => requestCode(...a),
}));

type Post = (ctx: unknown) => Promise<Response>;
let POST: Post;

async function call(body: unknown, ip = "1.1.1.1") {
  const request = new Request("http://localhost/api/auth/request-otp", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  return POST({ request, clientAddress: "127.0.0.1" });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T00:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  findUserByEmail.mockReset().mockResolvedValue(null);
  createUser.mockReset().mockResolvedValue({ id: 1 });
  requestCode.mockReset().mockResolvedValue(undefined);
  // Fresh module = fresh in-memory limiters per test.
  vi.resetModules();
  POST = (await import("@/pages/api/auth/request-otp")).POST as Post;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/auth/request-otp", () => {
  it("creates the user without the client-supplied name", async () => {
    const res = await call({ email: "New@Example.com", name: "<script>x</script>" });
    expect(await res.json()).toEqual({ ok: true });
    expect(createUser).toHaveBeenCalledWith("new@example.com");
    expect(requestCode).toHaveBeenCalledWith("new@example.com");
  });

  it("limits each email to 3 requests per 10 minutes, with an identical response", async () => {
    for (let i = 0; i < 3; i++) await call({ email: "a@b.c" }, `10.0.0.${i}`);
    expect(requestCode).toHaveBeenCalledTimes(3);

    const res = await call({ email: "a@b.c" }, "10.0.0.99");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(requestCode).toHaveBeenCalledTimes(3);
    expect(findUserByEmail).toHaveBeenCalledTimes(3);

    vi.setSystemTime(new Date("2026-10-21T00:10:00Z"));
    await call({ email: "a@b.c" }, "10.0.0.100");
    expect(requestCode).toHaveBeenCalledTimes(4);
  });

  it("limits each client IP to 5 requests per 10 minutes before any user lookup/create", async () => {
    for (let i = 0; i < 5; i++) await call({ email: `u${i}@b.c` }, "2.2.2.2, 10.0.0.1");
    expect(requestCode).toHaveBeenCalledTimes(5);

    const res = await call({ email: "u6@b.c" }, "2.2.2.2");
    expect(await res.json()).toEqual({ ok: true });
    expect(findUserByEmail).toHaveBeenCalledTimes(5);
    expect(createUser).toHaveBeenCalledTimes(5);
    expect(requestCode).toHaveBeenCalledTimes(5);

    // A different client is unaffected.
    await call({ email: "u7@b.c" }, "3.3.3.3");
    expect(requestCode).toHaveBeenCalledTimes(6);
  });
});
