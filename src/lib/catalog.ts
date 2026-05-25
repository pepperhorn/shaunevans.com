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
import { directusEnabled, fetchProducts, fetchLessons } from "@/lib/directus";

// Cache fetched data across calls within a single build.
let _products: Product[] | null = null;
let _lessons: Lesson[] | null = null;

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

export type { Product, Lesson };
