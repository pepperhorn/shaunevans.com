import type { APIRoute } from "astro";
import { verifyOtp } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, session }) => {
  try {
    const body = (await request.json()) as { email?: string; code?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const code = (body.code ?? "").trim();
    if (!email || !code) {
      return new Response(JSON.stringify({ error: "email and code required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const user = await verifyOtp(email, code);
    if (!user) {
      return new Response(JSON.stringify({ error: "invalid or expired code" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!session) {
      return new Response(JSON.stringify({ error: "sessions not enabled" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    await session.regenerate();
    await session.set("user", { id: user.id, email: user.email, name: user.name });

    return new Response(
      JSON.stringify({
        ok: true,
        user: { user_id: user.id, email: user.email, name: user.name },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
