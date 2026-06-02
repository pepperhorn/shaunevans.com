export type Series = {
  id: string;
  title: string;
  slug: string;
  access_tier: "free" | "paid" | "mixed";
};

export const series: Series[] = [
  { id: "1", title: "Sax Fundamentals", slug: "sax-fundamentals", access_tier: "free" },
  { id: "2", title: "Advanced Improvisation", slug: "advanced-improvisation", access_tier: "paid" },
];
