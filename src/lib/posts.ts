/**
 * Post & page data-access layer. Mirrors the catalog.ts pattern for
 * products/lessons: fetches from Directus when env vars are set, caches
 * per-build, and exposes thin helpers for Astro pages to consume.
 *
 * No MDX fallback — MDX content has been migrated to Directus posts
 * (collection `posts`) and Directus pages (collection `pages`).
 */

import {
  directusEnabled,
  fetchPosts,
  fetchPostsByTag,
  fetchPostBySlug,
  fetchPages,
  fetchPageByPermalink,
  type CmsPost,
  type CmsPage,
} from "@/lib/directus";

let _allPosts: CmsPost[] | null = null;
const _postsByTag = new Map<string, CmsPost[]>();
const _postBySlug = new Map<string, CmsPost | null>();
let _allPages: CmsPage[] | null = null;
const _pageByPermalink = new Map<string, CmsPage | null>();

function assertDirectus(): void {
  if (!directusEnabled) {
    throw new Error(
      "Directus is not configured. Set DIRECTUS_URL and DIRECTUS_TOKEN to fetch CMS content.",
    );
  }
}

export async function getAllPosts(): Promise<CmsPost[]> {
  if (_allPosts) return _allPosts;
  assertDirectus();
  _allPosts = await fetchPosts();
  return _allPosts;
}

export async function getPostsByTag(tagSlug: string): Promise<CmsPost[]> {
  const cached = _postsByTag.get(tagSlug);
  if (cached) return cached;
  assertDirectus();
  const items = await fetchPostsByTag(tagSlug);
  _postsByTag.set(tagSlug, items);
  return items;
}

export async function getPost(slug: string): Promise<CmsPost | null> {
  if (_postBySlug.has(slug)) return _postBySlug.get(slug) ?? null;
  assertDirectus();
  const post = await fetchPostBySlug(slug);
  _postBySlug.set(slug, post);
  return post;
}

export async function getAllPages(): Promise<CmsPage[]> {
  if (_allPages) return _allPages;
  assertDirectus();
  _allPages = await fetchPages();
  return _allPages;
}

export async function getPage(permalink: string): Promise<CmsPage | null> {
  if (_pageByPermalink.has(permalink)) return _pageByPermalink.get(permalink) ?? null;
  assertDirectus();
  const page = await fetchPageByPermalink(permalink);
  _pageByPermalink.set(permalink, page);
  return page;
}

/**
 * Filter posts that have BOTH category and target tags. Uses the
 * category fetch (already cached) and filters in-memory.
 */
export async function getCategoryPostsWithTag(
  categorySlug: string,
  tagSlug: string,
): Promise<CmsPost[]> {
  const all = await getPostsByTag(categorySlug);
  return all.filter((p) => p.tags.some((t) => t.slug === tagSlug));
}

/**
 * Unique tags (excluding the category tag itself) appearing on
 * posts in the given category.
 */
export async function getCategoryTags(
  categorySlug: string,
): Promise<{ name: string; slug: string }[]> {
  const posts = await getPostsByTag(categorySlug);
  const seen = new Map<string, { name: string; slug: string }>();
  for (const p of posts) {
    for (const t of p.tags) {
      if (t.slug === categorySlug) continue;
      if (!seen.has(t.slug)) seen.set(t.slug, t);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type { CmsPost, CmsPage } from "@/lib/directus";
