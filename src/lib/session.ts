import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionPayload = {
  user_id: number;
  email: string;
  exp: number;
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function getSecret(): string {
  const s = import.meta.env.SESSION_SECRET as string | undefined;
  if (!s) throw new Error("SESSION_SECRET not set");
  return s;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function issueSessionToken(input: { user_id: number; email: string }): string {
  const payload: SessionPayload = {
    user_id: input.user_id,
    email: input.email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadStr = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(
    createHmac("sha256", getSecret()).update(payloadStr).digest(),
  );
  return `${payloadStr}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || token.indexOf(".") < 0) return null;
  const [payloadStr, sig] = token.split(".", 2);
  const expected = b64url(
    createHmac("sha256", getSecret()).update(payloadStr).digest(),
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadStr).toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
