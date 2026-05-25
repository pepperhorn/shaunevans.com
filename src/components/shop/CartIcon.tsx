import { useStore } from "@nanostores/react";
import { ShoppingBag } from "lucide-react";
import { cartCount, cartOpen } from "@/lib/cart";

export default function CartIcon() {
  const count = useStore(cartCount);

  return (
    <button
      type="button"
      onClick={() => cartOpen.set("open")}
      className="relative flex h-[30px] w-[30px] items-center justify-center"
      aria-label={`Open cart${count ? ` (${count} items)` : ""}`}
    >
      <ShoppingBag className="h-[18px] w-[18px]" strokeWidth={1.5} />
      {count > 0 && (
        <span
          className="absolute -right-1 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold leading-none text-background"
          aria-hidden="true"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
