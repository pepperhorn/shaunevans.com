import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { setSessionUser, type ClientSession } from "@/lib/sessionClient";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAuthenticated?: () => void;
  initialEmail?: string;
};

type Step = "email" | "code";

// The directus-otp-auth extension issues OTP_AUTH_CODE_DIGITS-length codes
// (library default 8, allowed range 6–10). PUBLIC_OTP_AUTH_CODE_DIGITS only
// drives the copy/placeholder; the input itself accepts any length in range
// so a server-side change can't lock users out.
const CODE_MIN = 6;
const CODE_MAX = 10;
const CODE_DIGITS = (() => {
  const n = Number(import.meta.env.PUBLIC_OTP_AUTH_CODE_DIGITS ?? 8);
  return Number.isInteger(n) && n >= CODE_MIN && n <= CODE_MAX ? n : 8;
})();

export default function AuthOverlay({ open, onOpenChange, onAuthenticated, initialEmail }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setStep("email");
      setCode("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), name: name.trim() || undefined }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Couldn't send code");
      }
      setStep("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        user?: NonNullable<ClientSession>;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.user) {
        throw new Error(j.error ?? "Invalid code");
      }
      setSessionUser(j.user);
      onAuthenticated?.();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="auth-overlay flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{step === "email" ? "Sign in to continue" : "Enter your code"}</SheetTitle>
          <SheetDescription>
            {step === "email"
              ? "We'll email you a one-time code. No password needed."
              : `If ${email} can sign in, we've sent it a ${CODE_DIGITS}-digit code.`}
          </SheetDescription>
        </SheetHeader>

        {step === "email" ? (
          <form onSubmit={handleRequestCode} className="auth-form-email flex flex-1 flex-col gap-3 px-6">
            <label className="auth-field text-sm">
              <span className="auth-label mb-1 block text-muted-foreground">Email</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="you@example.com"
              />
            </label>
            <label className="auth-field text-sm">
              <span className="auth-label mb-1 block text-muted-foreground">Name (optional)</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="auth-input w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Your name"
              />
            </label>
            {error && <p className="auth-error text-sm text-red-600">{error}</p>}
            <SheetFooter>
              <Button type="submit" disabled={busy} className="btn-auth-send w-full">
                {busy ? "Sending…" : "Send me a code"}
              </Button>
            </SheetFooter>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="auth-form-code flex flex-1 flex-col gap-3 px-6">
            <label className="auth-field text-sm">
              <span className="auth-label mb-1 block text-muted-foreground">{CODE_DIGITS}-digit code</span>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern={`[0-9]{${CODE_MIN},${CODE_MAX}}`}
                minLength={CODE_MIN}
                maxLength={CODE_MAX}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_MAX))}
                className="auth-input auth-input-code w-full rounded-md border bg-background px-3 py-2 text-center text-lg tracking-[0.35em] tabular-nums"
                placeholder={"0".repeat(CODE_DIGITS)}
              />
            </label>
            {error && <p className="auth-error text-sm text-red-600">{error}</p>}
            <SheetFooter className="flex-col gap-2">
              <Button type="submit" disabled={busy || code.length < CODE_MIN || code.length > CODE_MAX} className="btn-auth-verify w-full">
                {busy ? "Verifying…" : "Verify"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
                className="btn-auth-back text-xs text-muted-foreground hover:underline"
              >
                Use a different email
              </button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
