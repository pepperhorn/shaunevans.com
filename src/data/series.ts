export type Series = {
  id: string;
  title: string;
  slug: string;
  access_tier: "free" | "paid" | "mixed";
  description?: string;
  coverImage?: string | null;
  itemCount?: number;
};

export const series: Series[] = [
  {
    id: "1",
    title: "Sax Fundamentals",
    slug: "sax-fundamentals",
    access_tier: "free",
    description: "Stub series — replace with Directus data.",
    itemCount: 0,
  },
  {
    id: "2",
    title: "Advanced Improvisation",
    slug: "advanced-improvisation",
    access_tier: "paid",
    description: "Stub series — replace with Directus data.",
    itemCount: 0,
  },
];
