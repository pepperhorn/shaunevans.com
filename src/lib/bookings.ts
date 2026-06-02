function directusBase(): string {
  const url = import.meta.env.DIRECTUS_URL as string | undefined;
  if (!url) throw new Error("DIRECTUS_URL not set");
  return url;
}

function directusToken(): string {
  const t = import.meta.env.DIRECTUS_TOKEN as string | undefined;
  if (!t) throw new Error("DIRECTUS_TOKEN not set");
  return t;
}

export type BookingRequest = {
  id: number;
  status: string | null;
  date_created: string | null;
  name: string;
  email: string;
  package_slug: string;
  instrument: string | null;
  experience_level: string | null;
  notes: string | null;
  preferred_date: string | null;
  time_preference: string | null;
};

export async function getBookingsForEmail(email: string): Promise<BookingRequest[]> {
  const url = new URL(`${directusBase()}/items/booking_requests`);
  url.searchParams.set("filter[email][_eq]", email);
  url.searchParams.set(
    "fields[]",
    "id,status,date_created,name,email,package_slug,instrument,experience_level,notes,preferred_date,time_preference",
  );
  url.searchParams.set("sort[]", "-date_created");
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${directusToken()}` },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: BookingRequest[] };
  return json.data ?? [];
}
