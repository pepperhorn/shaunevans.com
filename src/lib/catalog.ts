import { products, type Product } from "@/data/products";
import { lessons, type Lesson } from "@/data/lessons";

// TODO: swap these readers for se-cms (Directus) calls once the
// products and lessons collections land in the CMS. The shapes above
// in @/data/* match the intended Directus schema, so the call sites
// won't need to change.

export function getProducts(): Product[] {
  return products;
}

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function getFeaturedProducts(): Product[] {
  return products.filter((p) => p.featured);
}

export function getLessons(): Lesson[] {
  return lessons;
}

export function getLesson(slug: string): Lesson | undefined {
  return lessons.find((l) => l.slug === slug);
}

export type { Product, Lesson };
