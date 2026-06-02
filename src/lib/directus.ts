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

// ── Posts ─────────────────────────────────────────────────────────────────

export type CmsPost = {
  id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  image: string | null;
  imageUrl: string | null;
  authorName: string;
  publishedAt: string;
  tags: { name: string; slug: string }[];
};

type RawPost = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content: string | null;
  image: string | null;
  published_at: string | null;
  date_created: string | null;
  author: { first_name?: string; last_name?: string; email?: string } | string | null;
  post_tags: Array<{ post_tags_id: { id: string; name: string; slug: string } | null }> | null;
};

function mapPost(p: RawPost): CmsPost {
  let authorName = "";
  if (p.author && typeof p.author === "object") {
    authorName = [p.author.first_name, p.author.last_name].filter(Boolean).join(" ").trim();
    if (!authorName && p.author.email) authorName = p.author.email;
  }
  const tags = (p.post_tags ?? [])
    .map((j) => j.post_tags_id)
    .filter((t): t is { id: string; name: string; slug: string } => Boolean(t))
    .map((t) => ({ name: t.name, slug: t.slug }));
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description ?? "",
    content: p.content ?? "",
    image: p.image,
    imageUrl: p.image && BASE_URL ? `${BASE_URL}/assets/${p.image}` : null,
    authorName: authorName || "Shaun Evans",
    publishedAt: p.published_at ?? p.date_created ?? new Date().toISOString(),
    tags,
  };
}

const POST_FIELDS = [
  "id",
  "slug",
  "title",
  "description",
  "content",
  "image",
  "published_at",
  "date_created",
  "author.first_name",
  "author.last_name",
  "author.email",
  "post_tags.post_tags_id.id",
  "post_tags.post_tags_id.name",
  "post_tags.post_tags_id.slug",
].join(",");

export async function fetchPosts(): Promise<CmsPost[]> {
  const items = await directusFetch<RawPost[]>("/items/posts", {
    "filter[status][_eq]": "published",
    "fields[]": POST_FIELDS,
    "sort[]": "-published_at",
    limit: "500",
  });
  return items.map(mapPost);
}

export async function fetchPostsByTag(tagSlug: string): Promise<CmsPost[]> {
  const items = await directusFetch<RawPost[]>("/items/posts", {
    "filter[status][_eq]": "published",
    "filter[post_tags][post_tags_id][slug][_eq]": tagSlug,
    "fields[]": POST_FIELDS,
    "sort[]": "-published_at",
    limit: "500",
  });
  return items.map(mapPost);
}

export async function fetchPostBySlug(slug: string): Promise<CmsPost | null> {
  const items = await directusFetch<RawPost[]>("/items/posts", {
    "filter[status][_eq]": "published",
    "filter[slug][_eq]": slug,
    "fields[]": POST_FIELDS,
    limit: "1",
  });
  return items[0] ? mapPost(items[0]) : null;
}

// ── Pages ─────────────────────────────────────────────────────────────────

export type CmsBlock = {
  id: string;
  collection: string;
  background: "light" | "dark" | null;
  hideBlock: boolean;
  item: Record<string, unknown>;
};

export type CmsPage = {
  id: string;
  title: string;
  permalink: string;
  status: string;
  seo: { title?: string; meta_description?: string } | null;
  blocks: CmsBlock[];
};

type RawBlock = {
  id: string;
  sort: number | null;
  collection: string;
  background: "light" | "dark" | null;
  hide_block: boolean | null;
  item: Record<string, unknown> | string;
};

type RawPage = {
  id: string;
  title: string;
  permalink: string;
  status: string;
  seo: { title?: string; meta_description?: string } | null;
  blocks: RawBlock[] | null;
};

const PAGE_FIELDS = [
  "id",
  "title",
  "permalink",
  "status",
  "seo",
  "blocks.id",
  "blocks.sort",
  "blocks.collection",
  "blocks.background",
  "blocks.hide_block",
  "blocks.item.*",
  // block_form: pull the related form + its fields so the renderer can build the UI.
  "blocks.item:block_form.form.id",
  "blocks.item:block_form.form.title",
  "blocks.item:block_form.form.submit_label",
  "blocks.item:block_form.form.on_success",
  "blocks.item:block_form.form.success_message",
  "blocks.item:block_form.form.success_redirect_url",
  "blocks.item:block_form.form.is_active",
  "blocks.item:block_form.form.fields.id",
  "blocks.item:block_form.form.fields.name",
  "blocks.item:block_form.form.fields.type",
  "blocks.item:block_form.form.fields.label",
  "blocks.item:block_form.form.fields.placeholder",
  "blocks.item:block_form.form.fields.help",
  "blocks.item:block_form.form.fields.validation",
  "blocks.item:block_form.form.fields.width",
  "blocks.item:block_form.form.fields.choices",
  "blocks.item:block_form.form.fields.required",
  "blocks.item:block_form.form.fields.sort",
].join(",");

function mapPage(p: RawPage): CmsPage {
  const blocks = (p.blocks ?? [])
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .filter((b) => !b.hide_block)
    .map((b) => ({
      id: b.id,
      collection: b.collection,
      background: b.background,
      hideBlock: b.hide_block ?? false,
      item: typeof b.item === "object" && b.item !== null ? b.item : {},
    }));
  return {
    id: p.id,
    title: p.title,
    permalink: p.permalink,
    status: p.status,
    seo: p.seo,
    blocks,
  };
}

export async function fetchPageByPermalink(permalink: string): Promise<CmsPage | null> {
  const items = await directusFetch<RawPage[]>("/items/pages", {
    "filter[permalink][_eq]": permalink,
    "fields[]": PAGE_FIELDS,
    limit: "1",
  });
  return items[0] ? mapPage(items[0]) : null;
}

export async function fetchPages(): Promise<CmsPage[]> {
  const items = await directusFetch<RawPage[]>("/items/pages", {
    "filter[status][_eq]": "published",
    "fields[]": PAGE_FIELDS,
    "sort[]": "sort,permalink",
    limit: "200",
  });
  return items.map(mapPage);
}
