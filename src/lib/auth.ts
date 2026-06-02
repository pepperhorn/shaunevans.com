const OTP_REQUEST_FLOW_ID = "2652dfa1-6ca4-401f-8c32-db231fcf057f";
const OTP_VERIFY_FLOW_ID = "a7ab1bd3-720d-4934-b24a-3051b259ec0e";

function directusBase(): string {
  const url = import.meta.env.DIRECTUS_URL as string | undefined;
  if (!url) throw new Error("DIRECTUS_URL not set");
  return url;
}

export async function requestOtp(email: string, name?: string): Promise<void> {
  const res = await fetch(`${directusBase()}/flows/trigger/${OTP_REQUEST_FLOW_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OTP request failed: ${res.status} ${text}`);
  }
}

export type VerifiedUser = {
  id: number;
  email: string;
  name: string | null;
};

export async function verifyOtp(email: string, code: string): Promise<VerifiedUser | null> {
  const res = await fetch(`${directusBase()}/flows/trigger/${OTP_VERIFY_FLOW_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) return null;

  // The verify flow's terminal `return_user` exec op emits the user shape
  // directly. Directus wraps it as { data: { id, email, name } }.
  const json = (await res.json().catch(() => null)) as
    | { data?: { id?: number; email?: string; name?: string | null } | null }
    | null;
  const u = json?.data;
  if (!u || typeof u.id !== "number" || !u.email) return null;
  return { id: u.id, email: u.email, name: u.name ?? null };
}
