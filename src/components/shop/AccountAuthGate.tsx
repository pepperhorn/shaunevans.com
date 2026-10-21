import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Button } from "@/components/ui/button";
import { sessionState, signOut } from "@/lib/sessionClient";
import AuthOverlay from "./AuthOverlay";

type Props = {
  mode: "gate" | "signout";
};

export default function AccountAuthGate({ mode }: Props) {
  const sess = useStore(sessionState);
  const [authOpen, setAuthOpen] = useState(false);

  if (mode === "signout") {
    if (sess.status !== "authenticated") return null;
    return (
      <button
        type="button"
        onClick={async () => {
          await signOut();
          window.location.href = "/account";
        }}
        className="btn-signout text-xs text-muted-foreground hover:underline"
      >
        Sign out
      </button>
    );
  }

  if (sess.status === "loading") {
    return <p className="text-sm text-muted-foreground">Checking your session…</p>;
  }
  if (sess.status === "authenticated") {
    return null;
  }

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
