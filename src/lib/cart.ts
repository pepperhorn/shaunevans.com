import { computed } from "nanostores";
import { persistentAtom } from "@nanostores/persistent";

export type CartItem = {
  id: string;
  slug: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  /** Missing = "product" (carts saved before lesson lines existed). */
  kind?: "product" | "lesson_booking" | "lesson_pack";
  bookingId?: string;
  lessonId?: number;
  whenLabel?: string;
  holdExpiresAt?: string;
};

/** Body item for POST /api/checkout. */
export type CheckoutItem =
  | { kind?: "product"; product_id: string; quantity: number }
  | { kind: "lesson_booking"; booking_id: string }
  | { kind: "lesson_pack"; lesson_id: number };

/** Lesson lines are always quantity 1 (no stepper). */
export const isLessonLine = (item: CartItem) =>
  item.kind === "lesson_booking" || item.kind === "lesson_pack";

/** Whether a held lesson line's hold has run out at `now`. */
export const isHoldExpired = (item: CartItem, now = Date.now()) =>
  item.kind === "lesson_booking" && (!item.holdExpiresAt || Date.parse(item.holdExpiresAt) <= now);

export function toCheckoutItems(items: CartItem[]): CheckoutItem[] {
  return items.map((i): CheckoutItem => {
    if (i.kind === "lesson_booking") return { kind: "lesson_booking", booking_id: i.bookingId! };
    if (i.kind === "lesson_pack") return { kind: "lesson_pack", lesson_id: i.lessonId! };
    return { product_id: i.id, quantity: i.quantity };
  });
}

export const cart = persistentAtom<CartItem[]>("se:cart", [], {
  encode: JSON.stringify,
  decode: JSON.parse,
});

export const cartCount = computed(cart, (items) =>
  items.reduce((sum, item) => sum + item.quantity, 0),
);

export const cartSubtotal = computed(cart, (items) =>
  items.reduce((sum, item) => sum + item.price * item.quantity, 0),
);

export const cartOpen = persistentAtom<"open" | "closed">(
  "se:cart-open",
  "closed",
);

export function addToCart(item: Omit<CartItem, "quantity">, quantity = 1) {
  const items = cart.get();
  const existing = items.find((i) => i.id === item.id);
  if (isLessonLine(item as CartItem)) {
    // Packs and held slots are one-per-line; adding again just reopens the cart.
    if (!existing) cart.set([...items, { ...item, quantity: 1 }]);
  } else if (existing) {
    cart.set(
      items.map((i) =>
        i.id === item.id ? { ...i, quantity: i.quantity + quantity } : i,
      ),
    );
  } else {
    cart.set([...items, { ...item, quantity }]);
  }
  cartOpen.set("open");
}

export function updateQuantity(id: string, quantity: number) {
  const items = cart.get();
  if (quantity <= 0) {
    cart.set(items.filter((i) => i.id !== id));
    return;
  }
  cart.set(items.map((i) => (i.id === id && !isLessonLine(i) ? { ...i, quantity } : i)));
}

/** Put a held lesson slot (from POST /api/bookings/hold) in the cart. */
export function addLessonBooking(b: {
  bookingId: string;
  lessonId: number;
  name: string;
  price: number;
  whenLabel: string;
  holdExpiresAt: string;
}) {
  addToCart({
    id: `booking:${b.bookingId}`,
    slug: "",
    name: b.name,
    price: b.price,
    image: "",
    kind: "lesson_booking",
    bookingId: b.bookingId,
    lessonId: b.lessonId,
    whenLabel: b.whenLabel,
    holdExpiresAt: b.holdExpiresAt,
  });
}

/** Mark a held lesson line as released (the server said its hold is gone). */
export function markHoldExpired(bookingId: string) {
  const now = new Date().toISOString();
  cart.set(
    cart.get().map((i) =>
      i.kind === "lesson_booking" && i.bookingId === bookingId ? { ...i, holdExpiresAt: now } : i,
    ),
  );
}

export function removeFromCart(id: string) {
  cart.set(cart.get().filter((i) => i.id !== id));
}

export function clearCart() {
  cart.set([]);
}
