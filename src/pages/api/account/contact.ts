import type { APIRoute } from "astro";
import { updateUserContact } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";

export const prerender = false;

type SessionUser = { id: number; email: string; name: string | null };
type ContactRequest = { phone?: string | null; sms_opt_in?: boolean };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Save the signed-in user's phone (E.164) and SMS opt-in. Empty phone clears both. */
export const POST: APIRoute = async ({ request, session }) => {
  try {
    const user = await session?.get<SessionUser>("user");
    if (!user) return json({ error: "auth required" }, 401);

    const body = (await request.json().catch(() => ({}))) as ContactRequest;
    const raw = typeof body.phone === "string" ? body.phone.trim() : "";
    let contact: { phone: string | null; sms_opt_in: boolean };
    if (!raw) {
      contact = { phone: null, sms_opt_in: false };
    } else {
      const phone = normalizePhone(raw);
      if (!phone) return json({ error: "invalid_phone" }, 400);
      contact = { phone, sms_opt_in: body.sms_opt_in === true };
    }

    await updateUserContact(user.id, contact);
    return json({ ok: true, ...contact });
  } catch (err) {
    console.error("[account/contact]", err);
    return json({ error: "update failed" }, 500);
  }
};
