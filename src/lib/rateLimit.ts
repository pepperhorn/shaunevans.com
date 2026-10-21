/**
 * In-memory sliding-window rate limiter. Per-process only: counts reset on
 * restart/redeploy and aren't shared between replicas (Coolify runs one).
 */
export type RateLimiter = {
  /** Records a hit for `key`; returns false when the key is over its limit (the hit is not recorded). */
  hit(key: string): boolean;
};

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs } = opts;
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  function sweep(t: number) {
    if (t - lastSweep < windowMs) return;
    lastSweep = t;
    for (const [k, times] of hits) {
      if (times.every((x) => t - x >= windowMs)) hits.delete(k);
    }
  }

  return {
    hit(key: string): boolean {
      const t = now();
      sweep(t);
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}

/** First `x-forwarded-for` entry (set by the reverse proxy), else the socket address. */
export function clientIp(request: Request, clientAddress: () => string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  try {
    return clientAddress() || "unknown";
  } catch {
    return "unknown";
  }
}
