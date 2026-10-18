import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BookingView } from "@/lib/bookings";
import { initialTimeZone, selectionLabel, shortDate } from "@/components/bookings/timeLabels";

type Credit = { id: string; packName: string; lessonId: number; remaining: number; expiresAt: string };
type Contact = { phone: string | null; sms_opt_in: boolean };

type Props = {
  upcoming: BookingView[];
  past: BookingView[];
  credits: Credit[];
  contact: Contact | null;
};

type Notice = { tone: "error" | "info"; text: string } | null;

function when(b: BookingView, tz: string) {
  const start = Date.parse(b.startAt);
  const mins = Math.round((Date.parse(b.endAt) - start) / 60_000);
  return selectionLabel(start, mins, tz);
}

function rescheduleHref(b: BookingView): string {
  const q = new URLSearchParams({ reschedule: b.id });
  if (b.lessonSlug) q.set("lesson", b.lessonSlug);
  return `/bookings?${q.toString()}#booking-panel`;
}

const CANCEL_ERRORS: Record<string, string> = {
  too_late: "It's too close to the lesson to cancel online — please get in touch.",
  not_confirmed: "This lesson has already been changed. Refresh to see the latest.",
};

export default function LessonsSection({ upcoming, past, credits, contact }: Props) {
  const tz = initialTimeZone();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [cancelledIds, setCancelledIds] = useState<string[]>([]);
  const shown = upcoming.filter((b) => !cancelledIds.includes(b.id));

  async function cancel(b: BookingView) {
    const label = when(b, tz).local;
    if (!window.confirm(`Cancel your lesson on ${label}?`)) return;
    setBusyId(b.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(b.id)}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        credit_id?: string | null;
        credit_pending?: boolean;
      };
      if (!res.ok) {
        setNotice({ tone: "error", text: CANCEL_ERRORS[j.error ?? ""] ?? "Couldn't cancel. Please try again." });
        return;
      }
      if (j.credit_pending) {
        // Cancelled, but the refund credit is queued for Shaun — reloading would hide this message.
        setCancelledIds((ids) => [...ids, b.id]);
        setNotice({ tone: "info", text: "Cancelled — your credit is being added." });
        return;
      }
      window.location.reload();
    } catch {
      setNotice({ tone: "error", text: "Couldn't cancel. Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="lessons-section font-inconsolata space-y-8">
      {notice && (
        <p
          role="status"
          className={`lessons-notice text-sm ${notice.tone === "error" ? "text-red-600" : "text-foreground"}`}
        >
          {notice.text}
        </p>
      )}

      <div className="lessons-upcoming">
        <div className="lessons-upcoming-head mb-3 flex items-baseline justify-between gap-3">
          <h3 className="lessons-subheading font-overpass-mono text-sm uppercase">Upcoming</h3>
          <a href="/bookings#booking-panel" className="lessons-book-link text-sm underline underline-offset-2">
            Book a lesson
          </a>
        </div>
        {shown.length === 0 ? (
          <p className="lessons-upcoming-empty text-sm text-muted-foreground">No lessons booked.</p>
        ) : (
          <ul className="lessons-upcoming-list flex flex-col gap-3">
            {shown.map((b) => {
              const w = when(b, tz);
              return (
                <li key={b.id} className="lesson-card rounded-md border p-4">
                  <p className="lesson-card-name text-sm font-medium">{b.lessonName}</p>
                  <p className="lesson-card-when font-overpass-mono text-xs">{w.local}</p>
                  {w.sydney && <p className="lesson-card-sydney text-xs text-muted-foreground">{w.sydney}</p>}
                  {b.meetLink && (
                    <a
                      href={b.meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lesson-card-meet mt-2 inline-block text-sm underline underline-offset-2"
                    >
                      Join on Google Meet
                    </a>
                  )}
                  {b.canSelfManage ? (
                    <div className="lesson-card-actions mt-3 flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline" className="btn-lesson-reschedule">
                        <a href={rescheduleHref(b)}>Reschedule</a>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="btn-lesson-cancel"
                        disabled={busyId === b.id}
                        onClick={() => void cancel(b)}
                      >
                        {busyId === b.id ? "Cancelling…" : "Cancel"}
                      </Button>
                    </div>
                  ) : (
                    <p className="lesson-card-late mt-3 text-xs text-muted-foreground">
                      <a href="/contact" className="lesson-card-contact underline underline-offset-2">
                        Need to change this? Get in touch.
                      </a>{" "}
                      Shaun reserves the right to charge for a no-show.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="lessons-credits">
        <h3 className="lessons-subheading mb-3 font-overpass-mono text-sm uppercase">Credits</h3>
        {credits.length === 0 ? (
          <p className="lessons-credits-empty text-sm text-muted-foreground">No lesson credits.</p>
        ) : (
          <ul className="lessons-credit-list flex flex-col gap-2 text-sm">
            {credits.map((c) => (
              <li key={c.id} className="lessons-credit flex flex-wrap justify-between gap-2 rounded-md border px-4 py-2">
                <span className="lessons-credit-name">
                  {c.packName}: {c.remaining} {c.remaining === 1 ? "lesson" : "lessons"} left
                </span>
                {c.expiresAt && (
                  <span className="lessons-credit-expiry text-xs text-muted-foreground">
                    Expires {shortDate(c.expiresAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {past.length > 0 && (
        <div className="lessons-past">
          <h3 className="lessons-subheading mb-3 font-overpass-mono text-sm uppercase">Past</h3>
          <ul className="lessons-past-list divide-y text-sm">
            {past.map((b) => (
              <li key={b.id} className="lessons-past-item flex flex-wrap justify-between gap-2 py-2">
                <span className="lessons-past-name">{b.lessonName}</span>
                <span className="lessons-past-when text-xs text-muted-foreground">
                  {when(b, tz).local}
                  {b.status === "no_show" ? " · missed" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ContactBlock initial={contact} />
    </div>
  );
}

function ContactBlock({ initial }: { initial: Contact | null }) {
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [sms, setSms] = useState(initial?.sms_opt_in === true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/account/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), sms_opt_in: sms }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; phone?: string | null; sms_opt_in?: boolean };
      if (!res.ok) {
        setNotice({
          tone: "error",
          text: j.error === "invalid_phone" ? "That doesn't look like a valid mobile number." : "Couldn't save your number.",
        });
        return;
      }
      setPhone(j.phone ?? "");
      setSms(j.sms_opt_in === true);
      setNotice({ tone: "info", text: "Saved." });
    } catch {
      setNotice({ tone: "error", text: "Couldn't save your number." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lessons-contact">
      <h3 className="lessons-subheading mb-3 font-overpass-mono text-sm uppercase">Reminders</h3>
      <div className="lessons-contact-form flex max-w-sm flex-col gap-2">
        <Input
          type="tel"
          autoComplete="tel"
          className="lessons-contact-phone h-9 text-sm"
          placeholder="Mobile (optional)"
          aria-label="Mobile number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <label className="lessons-contact-sms flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="lessons-contact-sms-checkbox"
            checked={sms}
            disabled={!phone.trim()}
            onChange={(e) => setSms(e.target.checked)}
          />
          Text me lesson reminders
        </label>
        <div className="lessons-contact-actions flex items-center gap-3">
          <Button type="button" size="sm" className="btn-lessons-contact-save" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {notice && (
            <span
              role="status"
              className={`lessons-contact-status text-xs ${notice.tone === "error" ? "text-red-600" : "text-muted-foreground"}`}
            >
              {notice.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
