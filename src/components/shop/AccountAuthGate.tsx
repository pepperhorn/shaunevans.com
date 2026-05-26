import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { Button } from "@/components/ui/button";
import { session, clearSession } from "@/lib/sessionClient";
import AuthOverlay from "./AuthOverlay";

type Props = {
  mode: "gate" | "signout";
};

export default function AccountAuthGate({ mode }: Props) {
  const sess = useStore(session);
  const [authOpen, setAuthOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (mode === "gate" && sess?.token) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("t") !== sess.token) {
        params.set("t", sess.token);
        window.location.replace(`${window.location.pathname}?${params.toString()}`);
      }
    }
  }, [sess, mode]);

  if (mode === "signout") {
    if (!sess) return null;
    return (
      <button
        type="button"
        onClick={() => {
          clearSession();
          window.location.href = "/account";
        }}
        className="btn-signout text-xs text-muted-foreground hover:underline"
      >
        Sign out
      </button>
    );
  }

  if (!hydrated) return null;
  if (sess) return null;

  return (
    <div className="account-gate flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        Sign in with your email to see your orders and lesson bookings.
      </p>
      <Button onClick={() => setAuthOpen(true)} className="btn-account-signin">
        Sign in
      </Button>
      <AuthOverlay
        open={authOpen}
        onOpenChange={setAuthOpen}
        onAuthenticated={() => {
          window.location.reload();
        }}
      />
    </div>
  );
}
