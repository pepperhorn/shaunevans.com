import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Button } from "@/components/ui/button";
import { cart } from "@/lib/cart";
import { sessionState } from "@/lib/sessionClient";
import AuthOverlay from "./AuthOverlay";

export default function CheckoutButton() {
  const items = useStore(cart);
  const sess = useStore(sessionState);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceedToPayment() {
    if (items.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency: "GBP",
          items: items.map((i) => ({ product_id: i.id, quantity: i.quantity })),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        redirect_url?: string;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.redirect_url) {
        throw new Error(j.error ?? "Checkout failed");
      }
      window.location.href = j.redirect_url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function handleClick() {
    if (sess.status !== "authenticated") {
      setAuthOpen(true);
      return;
    }
    void proceedToPayment();
  }

  const isAuthed = sess.status === "authenticated";
  const isLoading = sess.status === "loading";

  return (
    <>
      <div className="checkout-button-group flex w-full flex-col gap-2">
        <Button
          onClick={handleClick}
          disabled={busy || isLoading || items.length === 0}
          className="btn-checkout w-full"
        >
          {busy
            ? "Redirecting to payment…"
            : isAuthed
              ? "Checkout"
              : "Sign in to checkout"}
        </Button>
        {error && <p className="checkout-error text-xs text-red-600">{error}</p>}
        {isAuthed && (
          <p className="checkout-signed-in text-xs text-muted-foreground">
            Signed in as {sess.user.email}
          </p>
        )}
      </div>
      <AuthOverlay
        open={authOpen}
        onOpenChange={setAuthOpen}
        onAuthenticated={() => void proceedToPayment()}
      />
    </>
  );
}
