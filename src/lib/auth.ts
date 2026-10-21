/**
 * Server-only client for the `directus-otp-auth` endpoint extension on se-cms
 * (`/otp-auth/*`), plus the `users` row bookkeeping around it.
 *
 * The browser never talks to `/otp-auth` directly. We request BEARER
 * transport on verify, keep the returned token in the Astro session
 * (server-side storage), and replay it to Directus as the app-scoped session
 * cookie. Directus consumes a standard `Authorization` header before endpoint
 * extensions see it, so the cookie form is the only server-to-server
 * presentation that reaches the extension intact.
 *
 * Mirrors pepperhorn-platform/apps/primary/src/lib/otp-auth.ts.
 */

import { serverEnv } from "@/lib/env";

function directusBase(): string {
  const url = serverEnv("DIRECTUS_URL");
  if (!url) throw new Error("DIRECTUS_URL not set");
  return url;
}

function directusToken(): string {
  const t = serverEnv("DIRECTUS_TOKEN");
  if (!t) throw new Error("DIRECTUS_TOKEN not set");
  return t;
}

function appSlug(): string {
  return (serverEnv("OTP_AUTH_APP_SLUG") || "shaunevans").trim();
}

function sessionCookieName(): string {
  return `otp_auth_session__${appSlug()}`;
}

// Optional origin secret (`x-otp-auth-key`). The extension only enforces it
// once its origin allowlist is configured; without it, calls go unkeyed.
let warnedUnkeyed = false;
function otpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  const key = (serverEnv("OTP_AUTH_CALLER_KEY") ?? "").trim();
  if (key) {
    h["x-otp-auth-key"] = key;
  } else if (!warnedUnkeyed) {
    warnedUnkeyed = true;
    console.warn("[otp-auth] OTP_AUTH_CALLER_KEY is not set — calling /otp-auth unkeyed.");
  }
  return h;
}

function sessionHeaders(token: string): Record<string, string> {
  return otpHeaders({ Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}` });
}

function scopedUrl(path: string): string {
  return `${directusBase()}${path}?appSlug=${encodeURIComponent(appSlug())}`;
}

export class OtpAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OtpAuthError";
    this.status = status;
  }
}

// ── /otp-auth wire calls ────────────────────────────────────────────────────

/** Always 200 `{ok:true}` for a well-formed request (silent no-op for unknown/inactive rows). */
export async function requestCode(email: string): Promise<void> {
  const res = await fetch(`${directusBase()}/otp-auth/code`, {
    method: "POST",
    headers: otpHeaders(),
    body: JSON.stringify({ email, appSlug: appSlug() }),
  });
  if (!res.ok) throw new OtpAuthError(`POST /otp-auth/code -> ${res.status}`, res.status);
}

/** `null` is the uniform verify failure (wrong, expired, burned, unknown). */
export async function verifyCode(
  email: string,
  code: string,
  deviceLabel?: string,
): Promise<{ token: string; expiresAt: string } | null> {
  const res = await fetch(`${directusBase()}/otp-auth/verify`, {
    method: "POST",
    headers: otpHeaders(),
    body: JSON.stringify({ email, code, appSlug: appSlug(), transport: "bearer", deviceLabel }),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new OtpAuthError(`POST /otp-auth/verify -> ${res.status}`, res.status);

  const body = (await res.json().catch(() => null)) as { token?: string; expiresAt?: string } | null;
  if (!body?.token || !body.expiresAt) {
    throw new OtpAuthError(
      'POST /otp-auth/verify returned 200 with no token — is OTP_AUTH_TRANSPORT set to "both"?',
      500,
    );
  }
  return { token: body.token, expiresAt: body.expiresAt };
}

export type OtpSession = { principalId: string; principalType: string; expiresAt: string };

/** `null` means the token is no longer valid (revoked/expired). Throws on transport errors. */
export async function getOtpSession(token: string): Promise<OtpSession | null> {
  const res = await fetch(scopedUrl("/otp-auth/session"), { headers: sessionHeaders(token) });
  if (res.status === 401) return null;
  if (!res.ok) throw new OtpAuthError(`GET /otp-auth/session -> ${res.status}`, res.status);
  const body = (await res.json()) as {
    principal?: { id?: string | number; type?: string };
    expiresAt?: string;
  };
  return {
    principalId: body.principal?.id != null ? String(body.principal.id) : "",
    principalType: body.principal?.type ?? "",
    expiresAt: body.expiresAt ?? "",
  };
}

/** Revokes this app's session server-side. 401 (already gone) is treated as success. */
export async function logoutOtpSession(token: string): Promise<void> {
  const res = await fetch(`${directusBase()}/otp-auth/logout`, {
    method: "POST",
    headers: sessionHeaders(token),
    body: JSON.stringify({ appSlug: appSlug() }),
  });
  if (!res.ok && res.status !== 401) {
    throw new OtpAuthError(`POST /otp-auth/logout -> ${res.status}`, res.status);
  }
}

// ── `users` collection (app-level customers) ───────────────────────────────

export type AppUser = {
  id: number;
  email: string;
  name: string | null;
  status: string | null;
};

const USER_FIELDS = "id,email,name,status";

async function directusUsers(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${directusBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${directusToken()}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const qs = new URLSearchParams({
    limit: "25",
    fields: USER_FIELDS,
    "filter[email][_icontains]": email,
  });
  const res = await directusUsers(`/items/users?${qs}`);
  if (!res.ok) throw new Error(`users lookup failed: ${res.status} ${await res.text()}`);
  const rows = ((await res.json()) as { data?: AppUser[] }).data ?? [];
  // Directus has no case-insensitive equality operator; `_icontains` is a
  // substring match, so confirm an exact case-insensitive hit here.
  return rows.find((r) => r.email?.toLowerCase() === email) ?? null;
}

export async function getUserById(id: string | number): Promise<AppUser | null> {
  const res = await directusUsers(
    `/items/users/${encodeURIComponent(String(id))}?fields=${USER_FIELDS}`,
  );
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`users read failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data?: AppUser | null }).data ?? null;
}

export async function createUser(email: string, name?: string): Promise<AppUser | null> {
  const res = await directusUsers(`/items/users?fields=${USER_FIELDS}`, {
    method: "POST",
    body: JSON.stringify({
      email,
      ...(name ? { name } : {}),
      status: "active",
      email_verified: false,
    }),
  });
  if (res.ok) return ((await res.json()) as { data?: AppUser }).data ?? null;

  const body = (await res.json().catch(() => null)) as
    | { errors?: Array<{ extensions?: { code?: string } }> }
    | null;
  // Lost a create race on a unique email — use the winner's row.
  if (body?.errors?.[0]?.extensions?.code === "RECORD_NOT_UNIQUE") return findUserByEmail(email);
  throw new Error(`users create failed: ${res.status} ${JSON.stringify(body)}`);
}

export async function markUserVerified(id: string | number): Promise<void> {
  const res = await directusUsers(`/items/users/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: JSON.stringify({ email_verified: true, last_login_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`users update failed: ${res.status} ${await res.text()}`);
}

export type UserContact = { phone: string | null; sms_opt_in: boolean };

export async function getUserContact(id: string | number): Promise<UserContact | null> {
  const res = await directusUsers(`/items/users/${encodeURIComponent(String(id))}?fields=phone,sms_opt_in`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`users read failed: ${res.status} ${await res.text()}`);
  const row = ((await res.json()) as { data?: { phone?: string | null; sms_opt_in?: boolean | null } | null }).data;
  return row ? { phone: row.phone || null, sms_opt_in: row.sms_opt_in === true } : null;
}

/** PATCHes only `phone` + `sms_opt_in` on the user's row. */
export async function updateUserContact(id: string | number, contact: UserContact): Promise<void> {
  const res = await directusUsers(`/items/users/${encodeURIComponent(String(id))}?fields=id`, {
    method: "PATCH",
    body: JSON.stringify({ phone: contact.phone, sms_opt_in: contact.sms_opt_in }),
  });
  if (!res.ok) throw new Error(`users update failed: ${res.status} ${await res.text()}`);
}

// ── Astro session shapes ───────────────────────────────────────────────────

/** Stored at `session.get("user")` — shape relied on by checkout/account/confirmation. */
export type SessionUser = { id: number; email: string; name: string | null };

/** Stored at `session.get("otp")` — never sent to the browser. */
export type SessionOtp = { token: string; expiresAt: string; lastCheckedAt: number };
