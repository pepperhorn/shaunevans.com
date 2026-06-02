import { useStore } from "@nanostores/react";
import { Minus, Plus, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  cart,
  cartOpen,
  cartSubtotal,
  removeFromCart,
  updateQuantity,
  type CartItem,
} from "@/lib/cart";

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function CartLine({ item }: { item: CartItem }) {
  return (
    <li className="flex gap-3 py-4">
      <a
        href={`/shop/${item.slug}/`}
        className="block h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted"
      >
        <img
          src={item.image}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <a
            href={`/shop/${item.slug}/`}
            className="line-clamp-2 text-sm font-medium hover:underline"
          >
            {item.name}
          </a>
          <button
            type="button"
            onClick={() => removeFromCart(item.id)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${item.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatPrice(item.price)} each
        </span>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center rounded-md border">
            <button
              type="button"
              onClick={() => updateQuantity(item.id, item.quantity - 1)}
              className="flex h-7 w-7 items-center justify-center hover:bg-muted"
              aria-label="Decrease quantity"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-7 text-center text-sm tabular-nums">
              {item.quantity}
            </span>
            <button
              type="button"
              onClick={() => updateQuantity(item.id, item.quantity + 1)}
              className="flex h-7 w-7 items-center justify-center hover:bg-muted"
              aria-label="Increase quantity"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <span className="text-sm font-semibold tabular-nums">
            {formatPrice(item.price * item.quantity)}
          </span>
        </div>
      </div>
    </li>
  );
}

export default function CartSheet() {
  const open = useStore(cartOpen);
  const items = useStore(cart);
  const subtotal = useStore(cartSubtotal);

  return (
    <Sheet
      open={open === "open"}
      onOpenChange={(next) => cartOpen.set(next ? "open" : "closed")}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col bg-[#f2f2f2] text-gray-900 dark:bg-[rgb(34,33,37)] dark:text-[rgb(245,245,245)] sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>Your cart</SheetTitle>
          <SheetDescription>
            {items.length === 0
              ? "Nothing in your cart yet."
              : `${items.length} item${items.length === 1 ? "" : "s"} in your cart.`}
          </SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Your cart is empty. Find something in the shop.
            </p>
            <Button asChild variant="outline">
              <a href="/shop/">Browse the shop</a>
            </Button>
          </div>
        ) : (
          <ul className="flex-1 divide-y overflow-y-auto px-6">
            {items.map((item) => (
              <CartLine key={item.id} item={item} />
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <SheetFooter className="border-t">
            <div className="flex w-full items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-base font-semibold tabular-nums">
                {formatPrice(subtotal)}
              </span>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground">
              Shipping and taxes calculated at checkout.
            </p>
            <Button className="w-full" disabled>
              Checkout (coming soon)
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
