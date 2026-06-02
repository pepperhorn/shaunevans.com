import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Check, AlertCircle } from "lucide-react";
import type { Lesson } from "@/data/lessons";

type Props = {
  lessons: Lesson[];
};

// Injected at build time (PUBLIC_ prefix = available in browser bundle).
// Set PUBLIC_DIRECTUS_URL in your deploy environment to enable live submissions.
// Optionally set PUBLIC_DIRECTUS_BOOKING_TOKEN to a write-only token if you
// don't want to enable public-role create access on booking_requests.
const DIRECTUS_URL = import.meta.env.PUBLIC_DIRECTUS_URL as string | undefined;
const BOOKING_TOKEN = import.meta.env.PUBLIC_DIRECTUS_BOOKING_TOKEN as
  | string
  | undefined;

async function submitToDirectus(data: Record<string, string>): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (BOOKING_TOKEN) {
    headers["Authorization"] = `Bearer ${BOOKING_TOKEN}`;
  }
  const res = await fetch(`${DIRECTUS_URL}/items/booking_requests`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: data.name,
      email: data.email,
      package_slug: data.package,
      instrument: data.instrument || null,
      experience_level: data.experience,
      notes: data.notes || null,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Submission failed (${res.status}): ${text}`);
  }
}

export default function BookingForm({ lessons }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(event.currentTarget);
    const data = Object.fromEntries(fd.entries()) as Record<string, string>;

    try {
      if (DIRECTUS_URL) {
        await submitToDirectus(data);
      } else {
        // No CMS configured — simulate for local dev / preview.
        await new Promise((r) => setTimeout(r, 700));
      }
      setSubmitted(true);
    } catch (err) {
      console.error("[BookingForm] submission error:", err);
      setError(
        "Something went wrong submitting your request. Please try emailing directly at shaun@shaunevans.com.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="border-border/60">
        <CardContent className="space-y-3 p-8 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background">
            <Check className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold">Request received</h3>
          <p className="text-sm text-muted-foreground">
            Thanks — Shaun will reach out within two business days to confirm a
            time. Check your inbox for a confirmation email.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="booking-form" className="border-border/60">
      <CardHeader>
        <h2 className="text-xl font-semibold tracking-tight">
          Request a booking
        </h2>
        <p className="text-sm text-muted-foreground">
          Tell Shaun a bit about what you'd like to work on. You'll get a
          confirmation email and a few proposed time slots.
        </p>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="booking-name">Full name</Label>
              <Input
                id="booking-name"
                name="name"
                required
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-email">Email</Label>
              <Input
                id="booking-email"
                name="email"
                type="email"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="booking-package">Package</Label>
              <select
                id="booking-package"
                name="package"
                required
                defaultValue=""
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="" disabled>
                  Select a package
                </option>
                {lessons.map((lesson) => (
                  <option key={lesson.slug} value={lesson.slug}>
                    {lesson.name} — ${lesson.price}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-instrument">Instrument / focus</Label>
              <Input
                id="booking-instrument"
                name="instrument"
                placeholder="e.g. alto sax, composition, arranging"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="booking-experience">Experience level</Label>
            <select
              id="booking-experience"
              name="experience"
              defaultValue="intermediate"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="beginner">Just starting out</option>
              <option value="intermediate">A few years in</option>
              <option value="advanced">Advanced / pre-professional</option>
              <option value="professional">Professional</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="booking-notes">What would you like to cover?</Label>
            <Textarea
              id="booking-notes"
              name="notes"
              rows={4}
              placeholder="A piece you're working on, an audition you're prepping, something you want to get unstuck on..."
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Submitting…" : "Request booking"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
