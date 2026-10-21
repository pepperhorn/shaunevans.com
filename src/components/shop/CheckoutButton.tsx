import { useEffect, useState, type FormEvent } from "react";
import { useStore } from "@nanostores/react";
import { Button } from "@/components/ui/button";
import { cart, cartOpen, isHoldExpired, markHoldExpired, removeFromCart, toCheckoutItems } from "@/lib/cart";
import { sessionState } from "@/lib/sessionClient";
import AuthOverlay from "./AuthOverlay";

export default function CheckoutButton() {
  const items = useStore(cart);
  const sess = useStore(sessionState);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);

  // Back button from Square restores this page from bfcache with busy=true.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function proceedToPayment() {
    // Read the store directly: this also runs right after sign-in / phone save.
    const items = cart.get();
    if (items.length === 0) return;
    setError(null);
    if (items.some((i) => isHoldExpired(i))) {
      setError("A lesson time was released. Remove it or pick a new time to check out.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: toCheckoutItems(items) }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        redirect_url?: string;
        error?: string;
        booking_id?: string;
      };
      if (res.status === 409 && j.error === "hold_expired" && j.booking_id) {
        markHoldExpired(j.booking_id);
        setError("A lesson time was released. Remove it or pick a new time to check out.");
        setBusy(false);
        return;
      }
      if (res.status === 409 && j.error === "already_paid" && j.booking_id) {
        const paid = items.find((i) => i.bookingId === j.booking_id);
        if (paid) removeFromCart(paid.id);
        setError("This lesson is already paid — it's been removed from your cart.");
        setBusy(false);
        return;
      }
      if (res.status === 400 && j.error === "phone_required") {
        setNeedsPhone(true);
        setBusy(false);
        return;
      }
      if (!res.ok || !j.ok || !j.redirect_url) {
        throw new Error(j.error ?? "Checkout failed");
      }
      cartOpen.set("closed");
      window.location.href = j.redirect_url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function savePhoneAndRetry(e: FormEvent) {
    e.preventDefault();
    setPhoneError(null);
    setSavingPhone(true);
    try {
      const res = await fetch("/api/account/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, sms_opt_in: smsOptIn }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPhoneError(
          j.error === "invalid_phone"
            ? "That doesn't look like a valid phone number."
            : "Couldn't save your number. Please try again.",
        );
        return;
      }
      setNeedsPhone(false);
      void proceedToPayment();
    } finally {
      setSavingPhone(false);
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
        {needsPhone && (
          <form
            onSubmit={savePhoneAndRetry}
            className="checkout-phone-form flex flex-col gap-2 rounded-md border p-3"
          >
            <label htmlFor="checkout-phone" className="checkout-phone-label text-xs font-medium">
              This package needs a phone number so Shaun can reach you.
            </label>
            <input
              id="checkout-phone"
              type="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0412 345 678 or +44 7911 123456"
              className="checkout-phone-input h-9 rounded-md border bg-background px-3 text-sm"
            />
            <label className="checkout-phone-sms flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.checked)}
                className="checkout-phone-sms-checkbox"
              />
              Text me lesson reminders
            </label>
            {phoneError && <p className="checkout-phone-error text-xs text-red-600">{phoneError}</p>}
            <Button type="submit" size="sm" disabled={savingPhone} className="btn-checkout-phone-save">
              {savingPhone ? "Saving…" : "Save and continue"}
            </Button>
          </form>
        )}
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
