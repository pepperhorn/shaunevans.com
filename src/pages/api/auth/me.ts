import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async ({ session }) => {
  if (!session) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  const user = await session.get<{ id: number; email: string; name: string | null }>("user");
  if (!user) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      user: { user_id: user.id, email: user.email, name: user.name },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};
