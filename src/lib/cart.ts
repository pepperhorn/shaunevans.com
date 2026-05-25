import { computed } from "nanostores";
import { persistentAtom } from "@nanostores/persistent";

export type CartItem = {
  id: string;
  slug: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
};

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
  if (existing) {
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
  cart.set(items.map((i) => (i.id === id ? { ...i, quantity } : i)));
}

export function removeFromCart(id: string) {
  cart.set(cart.get().filter((i) => i.id !== id));
}

export function clearCart() {
  cart.set([]);
}
