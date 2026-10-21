/**
 * Catalog data access layer.
 *
 * When DIRECTUS_URL + DIRECTUS_TOKEN env vars are set, data is fetched
 * from se-cms (instance 032cee79) at build time. Otherwise, the static
 * stub files under src/data/* are used — useful for local dev without
 * CMS access or as a fallback during CI.
 */

import { products as stubProducts, type Product } from "@/data/products";
import { lessons as stubLessons, type Lesson } from "@/data/lessons";
import { series as stubSeries, type Series } from "@/data/series";
import {
  directusEnabled,
  fetchProducts,
  fetchLessons,
  fetchSeries,
  fetchSeriesBySlug,
  fetchLearning,
  fetchLearningBySeries,
  fetchLearningBySlug,
  fetchGlobals,
  type Globals,
  type LearningItem,
  type LearningDetail,
} from "@/lib/directus";

const STUB_GLOBALS: Globals = { homeCategoryItems: 4 };

// Cache fetched data across calls within a single build.
let _products: Product[] | null = null;
let _lessons: Lesson[] | null = null;
let _series: Series[] | null = null;
let _globals: Globals | null = null;

export async function getProducts(): Promise<Product[]> {
  if (_products) return _products;
  if (directusEnabled) {
    try {
      _products = await fetchProducts();
      return _products;
    } catch (err) {
      console.warn("[catalog] Directus fetch failed, falling back to stubs:", err);
    }
  }
  _products = stubProducts;
  return _products;
}

export async function getProduct(slug: string): Promise<Product | undefined> {
  const all = await getProducts();
  return all.find((p) => p.slug === slug);
}

export async function getFeaturedProducts(): Promise<Product[]> {
  const all = await getProducts();
  return all.filter((p) => p.featured);
}

export async function getLessons(): Promise<Lesson[]> {
  if (_lessons) return _lessons;
  if (directusEnabled) {
    try {
      _lessons = await fetchLessons();
      return _lessons;
    } catch (err) {
      console.warn("[catalog] Directus fetch failed, falling back to stubs:", err);
    }
  }
  _lessons = stubLessons;
  return _lessons;
}

export async function getLesson(slug: string): Promise<Lesson | undefined> {
  const all = await getLessons();
  return all.find((l) => l.slug === slug);
}

export async function getSeries(): Promise<Series[]> {
  if (_series) return _series;
  if (directusEnabled) {
    try {
      _series = await fetchSeries();
      return _series;
    } catch (err) {
      console.warn("[catalog] Directus series fetch failed, falling back to stubs:", err);
    }
  }
  _series = stubSeries;
  return _series;
}

export async function getSeriesBySlug(slug: string): Promise<Series | null> {
  if (directusEnabled) {
    try {
      return await fetchSeriesBySlug(slug);
    } catch (err) {
      console.warn("[catalog] Directus series fetch failed:", err);
    }
  }
  return (await getSeries()).find((s) => s.slug === slug) ?? null;
}

// Learning items — page-builder-driven lesson posts, optionally grouped
// into a series. Built-time fetch + per-build cache. No stub fallback.
let _learning: LearningItem[] | null = null;
const _learningBySeries = new Map<string, LearningItem[]>();
const _learningBySlug = new Map<string, LearningDetail | null>();

export async function getLearning(): Promise<LearningItem[]> {
  if (_learning) return _learning;
  if (!directusEnabled) {
    _learning = [];
    return _learning;
  }
  try {
    _learning = await fetchLearning();
  } catch (err) {
    console.warn("[catalog] Directus learning fetch failed:", err);
    _learning = [];
  }
  return _learning;
}

export async function getLearningBySeries(seriesId: string): Promise<LearningItem[]> {
  const cached = _learningBySeries.get(seriesId);
  if (cached) return cached;
  if (!directusEnabled) return [];
  try {
    const items = await fetchLearningBySeries(seriesId);
    _learningBySeries.set(seriesId, items);
    return items;
  } catch (err) {
    console.warn("[catalog] Directus learning-by-series fetch failed:", err);
    return [];
  }
}

export async function getLearningBySlug(slug: string): Promise<LearningDetail | null> {
  if (_learningBySlug.has(slug)) return _learningBySlug.get(slug) ?? null;
  if (!directusEnabled) {
    _learningBySlug.set(slug, null);
    return null;
  }
  try {
    const item = await fetchLearningBySlug(slug);
    _learningBySlug.set(slug, item);
    return item;
  } catch (err) {
    console.warn("[catalog] Directus learning-by-slug fetch failed:", err);
    _learningBySlug.set(slug, null);
    return null;
  }
}

export async function getGlobals(): Promise<Globals> {
  if (_globals) return _globals;
  if (directusEnabled) {
    try {
      _globals = await fetchGlobals();
      return _globals;
    } catch (err) {
      console.warn("[catalog] Directus globals fetch failed, falling back:", err);
    }
  }
  _globals = STUB_GLOBALS;
  return _globals;
}

export type { Product, Lesson, Series, Globals, LearningItem, LearningDetail };
