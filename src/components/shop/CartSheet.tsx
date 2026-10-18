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
import CheckoutButton from "./CheckoutButton";

function formatPrice(value: number) {
  return value.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

function CartLine({ item }: { item: CartItem }) {
  return (
    <li className="cart-sheet-item flex gap-3 py-4">
      <a
        href={`/shop/${item.slug}/`}
        className="cart-sheet-item-thumb block h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted"
      >
        <img
          src={item.image}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </a>
      <div className="cart-sheet-item-body flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <a
            href={`/shop/${item.slug}/`}
            className="cart-sheet-item-name line-clamp-2 min-w-0 break-words text-sm font-medium hover:underline"
          >
            {item.name}
          </a>
          <button
            type="button"
            onClick={() => removeFromCart(item.id)}
            className="cart-sheet-item-remove -m-1.5 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
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
        className="cart-sheet flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="cart-sheet-header p-6 pb-4 pr-14 text-left">
          <SheetTitle>Your cart</SheetTitle>
          <SheetDescription>
            {items.length === 0
              ? "Nothing in your cart yet."
              : `${items.length} item${items.length === 1 ? "" : "s"} in your cart.`}
          </SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="cart-sheet-empty flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Your cart is empty. Find something in the shop.
            </p>
            <Button asChild variant="outline">
              <a href="/shop/">Browse the shop</a>
            </Button>
          </div>
        ) : (
          <ul className="cart-sheet-items min-h-0 flex-1 divide-y overflow-y-auto border-t px-6">
            {items.map((item) => (
              <CartLine key={item.id} item={item} />
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <SheetFooter className="cart-sheet-footer flex-col gap-3 border-t p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:flex-col sm:justify-start sm:space-x-0">
            <div className="cart-total flex w-full items-center justify-between text-sm">
              <span className="text-muted-foreground">Total (incl. GST)</span>
              <span className="text-base font-semibold tabular-nums">
                {formatPrice(subtotal)}
              </span>
            </div>
            <Separator />
            <p className="cart-sheet-note text-xs text-muted-foreground">
              Prices include 10% GST. Digital goods — delivered by email after
              payment.
            </p>
            <CheckoutButton />
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
