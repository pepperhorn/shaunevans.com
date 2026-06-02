import { useState } from "react";
import { ShoppingBag, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addToCart, type CartItem } from "@/lib/cart";

type Props = {
  item: Omit<CartItem, "quantity">;
  quantity?: number;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline";
  label?: string;
  className?: string;
};

export default function AddToCartButton({
  item,
  quantity = 1,
  size = "default",
  variant = "default",
  label = "Add to cart",
  className,
}: Props) {
  const [added, setAdded] = useState(false);

  function handleClick() {
    addToCart(item, quantity);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={handleClick}
      className={className}
    >
      {added ? (
        <>
          <Check className="h-4 w-4" />
          Added
        </>
      ) : (
        <>
          <ShoppingBag className="h-4 w-4" />
          {label}
        </>
      )}
    </Button>
  );
}
