import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import AddToCartButton from "./AddToCartButton";
import type { Product } from "@/data/products";

const categoryLabel: Record<Product["category"], string> = {
  "sheet-music": "Sheet Music",
  recordings: "Recordings",
  merch: "Merch",
  courses: "Courses",
};

export default function ProductCard({ product }: { product: Product }) {
  return (
    <Card className="group relative overflow-hidden border-border/60 transition-shadow hover:shadow-lg">
      <a href={`/shop/${product.slug}/`} className="block">
        <div className="aspect-square overflow-hidden bg-muted">
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      </a>
      {product.featured && (
        <Badge className="absolute left-3 top-3" variant="default">
          Featured
        </Badge>
      )}
      <CardContent className="space-y-2 p-4">
        <Badge variant="outline" className="text-xs">
          {categoryLabel[product.category]}
        </Badge>
        <a
          href={`/shop/${product.slug}/`}
          className="block font-medium leading-tight hover:underline"
        >
          {product.name}
        </a>
        <p className="text-sm text-muted-foreground line-clamp-2">
          {product.tagline}
        </p>
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2 p-4 pt-0">
        <span className="text-lg font-semibold tabular-nums">
          ${product.price}
        </span>
        <AddToCartButton
          size="sm"
          variant="outline"
          item={{
            id: product.id,
            slug: product.slug,
            name: product.name,
            price: product.price,
            image: product.image,
          }}
        />
      </CardFooter>
    </Card>
  );
}
