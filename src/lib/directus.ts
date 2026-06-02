/**
 * Thin Directus REST client for build-time data fetching.
 * Reads DIRECTUS_URL + DIRECTUS_TOKEN from env; the site builds
 * from stub data (src/data/*) when these aren't set.
 */

const BASE_URL = import.meta.env.DIRECTUS_URL as string | undefined;
const TOKEN = import.meta.env.DIRECTUS_TOKEN as string | undefined;

export const directusEnabled = Boolean(BASE_URL && TOKEN);

type DirectusResponse<T> = { data: T };

async function directusFetch<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  if (!BASE_URL || !TOKEN) {
    throw new Error("DIRECTUS_URL or DIRECTUS_TOKEN not set");
  }
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Directus fetch failed: ${res.status} ${url}`);
  }
  const json: DirectusResponse<T> = await res.json();
  return json.data;
}

/** Build a public asset URL from a Directus file UUID. */
export function assetUrl(
  uuid: string | null | undefined,
  fallback: string,
): string {
  if (!uuid || !BASE_URL) return fallback;
  return `${BASE_URL}/assets/${uuid}`;
}

// ── Products ──────────────────────────────────────────────────────────────

type RawProduct = {
  id: string;
  title: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  price: string | number;
  image: string | null;
  category: string | null;
  featured: boolean | null;
  square_checkout_link: string | null;
};

import type { Product } from "@/data/products";

export async function fetchProducts(): Promise<Product[]> {
  const items = await directusFetch<RawProduct[]>("/items/products", {
    "filter[status][_eq]": "published",
    "fields[]":
      "id,title,slug,tagline,description,price,image,category,featured,square_checkout_link",
    "sort[]": "sort,title",
    limit: "200",
  });
  return items.map((p) => ({
    id: p.id,
    name: p.title,
    slug: p.slug,
    tagline: p.tagline ?? "",
    description: p.description ?? "",
    price: Number(p.price),
    image: assetUrl(p.image, `https://picsum.photos/seed/se-${p.slug}/800/800`),
    category: (p.category ?? "merch") as Product["category"],
    featured: p.featured ?? false,
    square_checkout_link: p.square_checkout_link ?? undefined,
  }));
}

// ── Lessons ───────────────────────────────────────────────────────────────

type RawLesson = {
  id: number;
  name: string;
  slug: string;
  price: string | number;
  duration: string | null;
  format: string | null;
  tagline: string | null;
  description: string | null;
  includes: Array<{ item: string }> | null;
  popular: boolean | null;
};

import type { Lesson } from "@/data/lessons";

// ── Globals ───────────────────────────────────────────────────────────────

export type Globals = {
  homeCategoryItems: number;
};

type RawGlobals = {
  home_category_items: string | number | null;
};

export async function fetchGlobals(): Promise<Globals> {
  const raw = await directusFetch<RawGlobals>("/items/globals", {
    "fields[]": "home_category_items",
  });
  const parsed = Number(raw.home_category_items);
  return {
    homeCategoryItems: Number.isFinite(parsed) && parsed > 0 ? parsed : 4,
  };
}

export async function fetchLessons(): Promise<Lesson[]> {
  const items = await directusFetch<RawLesson[]>("/items/lessons", {
    "filter[status][_eq]": "published",
    "fields[]":
      "id,name,slug,price,duration,format,tagline,description,includes,popular",
    "sort[]": "sort,id",
    limit: "50",
  });
  return items.map((l) => ({
    id: String(l.id),
    name: l.name,
    slug: l.slug,
    price: Number(l.price),
    duration: l.duration ?? "",
    format: (l.format ?? "online") as Lesson["format"],
    tagline: l.tagline ?? "",
    description: l.description ?? "",
    includes: (l.includes ?? []).map((x) => x.item),
    popular: l.popular ?? false,
  }));
}
