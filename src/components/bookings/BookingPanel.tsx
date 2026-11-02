import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AuthOverlay from "@/components/shop/AuthOverlay";
import { addLessonBooking } from "@/lib/cart";
import { sessionState } from "@/lib/sessionClient";
import { addDaysIso, zonedParts, BOOKING_TZ } from "@/lib/booking/time";
import type { AvailabilityView } from "@/lib/booking/slots";
import type { Lesson } from "@/data/lessons";
import WeekGrid, { GridLegend } from "./WeekGrid";
import { linkedLesson } from "@/lib/booking/selection";
import { PICK_LESSON_EVENT } from "./LessonCard";
import { cellKey, spanKeys, toGridModel } from "./gridModel";
import {
  allTimeZones,
  cityOf,
  filterTimeZones,
  gmtOffset,
  initialTimeZone,
  isTimeZone,
  rangeLabel,
  selectionLabel,
  shortDate,
  TZ_STORAGE_KEY,
} from "./timeLabels";


type Credit = { id: string; packName: string; lessonId: number; remaining: number; expiresAt: string };
type Mode = { type: "single"; slug: string } | { type: "credit"; creditId: string };
type Status = { tone: "error" | "info"; text: string } | null;

type Props = { lessons: Lesson[]; horizonWeeks: number; unlistedSlugs?: string[] };

/** `/bookings?reschedule=<booking id>&lesson=<slug>` (from /account) moves an existing lesson. */
type Reschedule = { bookingId: string; slug: string };

/**
 * `undefined` = no reschedule requested; `null` = requested but the lesson isn't a bookable
 * single (missing/unpublished) — the panel then refuses rather than falling back to a purchase.
 */
function readReschedule(singles: Lesson[]): Reschedule | null | undefined {
  const q = new URLSearchParams(window.location.search);
  const bookingId = q.get("reschedule");
  if (!bookingId) return undefined;
  const slug = q.get("lesson");
  if (!slug || !singles.some((l) => l.slug === slug)) return null;
  return { bookingId, slug };
}

const RESCHEDULE_ERRORS: Record<string, string> = {
  too_late: "It's too close to the session to move it online — please get in touch.",
  not_confirmed: "That session has already been changed. Check your account for the latest.",
  no_credits: "That credit has no sessions left to move onto this time.",
  free_booking_limit: "You already have this free session type held or booked. Manage it in your account or release its hold first.",
  not_bookable:
    "That time can't be booked. Times that overlap your current session can't be chosen — pick another time or get in touch.",
};

const MOBILE_QUERY = "(max-width: 799.98px)"; // below the site's `sm` (800px)

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, body: j };
}

export default function BookingPanel({ lessons, horizonWeeks, unlistedSlugs = [] }: Props) {
  const sess = useStore(sessionState);
  const authed = sess.status === "authenticated";
  const mobile = useIsMobile();

  const singles = useMemo(() => lessons.filter((l) => l.kind === "single" && l.durationMinutes), [lessons]);

  // ── Time zone ───────────────────────────────────────────────────────────
  const [tz, setTz] = useState(initialTimeZone);
  const [tzEditing, setTzEditing] = useState(false);
  const [tzQuery, setTzQuery] = useState("");
  const zones = useMemo(allTimeZones, []);
  const tzMatches = useMemo(() => filterTimeZones(zones, tzQuery), [zones, tzQuery]);
  function closeTzPicker() {
    setTzEditing(false);
    setTzQuery("");
  }
  function chooseTz(next: string) {
    if (!isTimeZone(next)) return;
    setTz(next);
    setTzEditing(false);
    setTzQuery("");
    try {
      localStorage.setItem(TZ_STORAGE_KEY, next);
    } catch {
      /* storage blocked */
    }
  }

  // ── Lesson / credit selection ──────────────────────────────────────────
  const [deepLink] = useState(() => linkedLesson(singles, window.location.search));
  const selectableSingles = useMemo(() => singles.filter((l) => !unlistedSlugs.includes(l.slug) || l.slug === deepLink?.slug), [singles, unlistedSlugs, deepLink]);
  useEffect(() => {
    if (deepLink) document.getElementById("booking-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [deepLink]);
  const [rescheduleParam] = useState(() => readReschedule(singles));
  const reschedule = rescheduleParam ?? null;
  const [mode, setMode] = useState<Mode | null>(() => {
    if (reschedule) return { type: "single", slug: reschedule.slug };
    const initial = deepLink ?? selectableSingles[0];
    return initial ? { type: "single", slug: initial.slug } : null;
  });
  const [credits, setCredits] = useState<Credit[]>([]);

  const loadCredits = useCallback(async () => {
    const res = await fetch("/api/bookings/credits", { credentials: "same-origin" }).catch(() => null);
    if (!res?.ok) return setCredits([]);
    const j = (await res.json().catch(() => ({}))) as { credits?: Credit[] };
    setCredits(j.credits ?? []);
  }, []);

  useEffect(() => {
    if (authed) void loadCredits();
    else setCredits([]);
  }, [authed, loadCredits]);

  // A credit books its pack's single-lesson type (matched by numeric lesson id).
  const lessonForCredit = useCallback(
    (c: Credit) => singles.find((l) => Number(l.id) === c.lessonId),
    [singles],
  );
  const usableCredits = credits.filter((c) => lessonForCredit(c));

  const activeCredit = mode?.type === "credit" ? usableCredits.find((c) => c.id === mode.creditId) : undefined;
  const lesson =
    mode?.type === "single" ? singles.find((l) => l.slug === mode.slug) : activeCredit ? lessonForCredit(activeCredit) : undefined;
  const durationMins = lesson?.durationMinutes ?? 60;

  useEffect(() => {
    // Credit vanished (used up, signed out) → fall back to the first single.
    if (mode?.type === "credit" && !activeCredit) setMode(selectableSingles[0] ? { type: "single", slug: selectableSingles[0].slug } : null);
  }, [mode, activeCredit, selectableSingles]);

  useEffect(() => {
    const onPick = (e: Event) => {
      const slug = (e as CustomEvent<{ slug: string }>).detail?.slug;
      if (reschedule) return; // locked to the lesson being moved
      if (selectableSingles.some((l) => l.slug === slug)) setMode({ type: "single", slug });
    };
    window.addEventListener(PICK_LESSON_EVENT, onPick);
    return () => window.removeEventListener(PICK_LESSON_EVENT, onPick);
  }, [selectableSingles, reschedule]);

  // ── Visible days ───────────────────────────────────────────────────────
  const today = zonedParts(Date.now(), tz).date;
  const lastBookable = addDaysIso(today, horizonWeeks * 7);
  const span = mobile ? 3 : 7;
  const firstStart = mobile ? today : addDaysIso(today, 1 - zonedParts(Date.now(), tz).isoWeekday);
  const [windowStart, setWindowStart] = useState(firstStart);
  useEffect(() => setWindowStart(firstStart), [firstStart]); // tz or layout changed
  const days = useMemo(
    () => Array.from({ length: span }, (_, i) => addDaysIso(windowStart, i)),
    [windowStart, span],
  );
  const canPrev = days[0] > today;
  const canNext = days[days.length - 1] < lastBookable;
  const step = (dir: -1 | 1) => {
    if ((dir < 0 && !canPrev) || (dir > 0 && !canNext)) return;
    const next = addDaysIso(windowStart, dir * span);
    setWindowStart(mobile && next < today ? today : next);
  };

  // ── Availability ───────────────────────────────────────────────────────
  const [view, setView] = useState<AvailabilityView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const refetch = () => setReloadTick((n) => n + 1);

  useEffect(() => {
    if (!lesson) return;
    // Visitor days straddle Sydney dates, so ask for one Sydney day either side,
    // clamped to the range the API accepts.
    const sydToday = zonedParts(Date.now(), BOOKING_TZ).date;
    const minFrom = addDaysIso(sydToday, -1);
    const maxTo = addDaysIso(sydToday, horizonWeeks * 7 + 1);
    let from = addDaysIso(days[0], -1);
    let to = addDaysIso(days[days.length - 1], 1);
    if (from < minFrom) from = minFrom;
    if (to > maxTo) to = maxTo;
    if (from > to) {
      setView({ blocks: [], busy: [], starts: [] });
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(false);
    fetch(`/api/bookings/availability?lesson=${encodeURIComponent(lesson.slug)}&from=${from}&to=${to}`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setView((await res.json()) as AvailabilityView);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setView(null);
        setLoadError(true);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [lesson?.slug, days, horizonWeeks, reloadTick]);

  const model = useMemo(
    () => (view ? toGridModel(view, days, tz, durationMins) : { rows: [], cells: {} }),
    [view, days, tz, durationMins],
  );
  const startAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of view?.starts ?? []) m.set(cellKey(s, tz), s);
    return m;
  }, [view, tz]);

  // ── Selection ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => setSelected(null), [lesson?.slug, tz]);
  useEffect(() => {
    if (selected != null && view && !view.starts.includes(selected)) setSelected(null);
  }, [view, selected]);
  const selectedKeys = useMemo(
    () => new Set(selected != null ? spanKeys(selected, durationMins, tz) : []),
    [selected, durationMins, tz],
  );
  const sel = selected != null ? selectionLabel(selected, durationMins, tz) : null;

  // ── Contact (signed in) ────────────────────────────────────────────────
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const savedContact = useRef<{ phone: string; sms: boolean }>({ phone: "", sms: false });
  useEffect(() => {
    if (!authed) return;
    void fetch("/api/account/contact", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { phone?: string | null; sms_opt_in?: boolean } | null) => {
        if (!j) return;
        savedContact.current = { phone: j.phone ?? "", sms: j.sms_opt_in === true };
        setPhone(j.phone ?? "");
        setSmsOptIn(j.sms_opt_in === true);
      })
      .catch(() => {});
  }, [authed]);

  // ── Actions ────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [booked, setBooked] = useState<{ name: string; when: string } | null>(null);

  async function saveContactIfChanged(): Promise<boolean> {
    const was = savedContact.current;
    if (phone.trim() === was.phone && smsOptIn === was.sms) return true;
    const r = await postJson("/api/account/contact", { phone: phone.trim(), sms_opt_in: smsOptIn });
    if (!r.ok) {
      setStatus({
        tone: "error",
        text: r.body.error === "invalid_phone" ? "That doesn't look like a valid mobile number." : "Couldn't save your number.",
      });
      return false;
    }
    savedContact.current = { phone: String(r.body.phone ?? ""), sms: r.body.sms_opt_in === true };
    setPhone(savedContact.current.phone);
    setSmsOptIn(savedContact.current.sms);
    return true;
  }

  function onTaken() {
    setStatus({ tone: "error", text: "Someone just took that time — please pick another." });
    setSelected(null);
    refetch();
  }

  async function submit() {
    if (selected == null || !lesson) return;
    setStatus(null);
    setBusy(true);
    try {
      if (!(await saveContactIfChanged())) return;
      const startIso = new Date(selected).toISOString();
      if (reschedule) {
        const r = await postJson(`/api/bookings/${encodeURIComponent(reschedule.bookingId)}/reschedule`, {
          start_at: startIso,
          visitor_tz: tz,
        });
        if (r.status === 401) return setAuthOpen(true);
        if (r.status === 409 && r.body.error === "slot_taken") return onTaken();
        if (!r.ok) {
          const msg = RESCHEDULE_ERRORS[String(r.body.error ?? "")] ?? "That time can't be booked any more. Please pick another.";
          setStatus({ tone: "error", text: msg });
          setSelected(null);
          refetch();
          return;
        }
        setBooked({ name: lesson.name, when: String(r.body.when_label ?? sel?.local ?? "") });
        setSelected(null);
        return;
      }
      if (activeCredit) {
        const r = await postJson("/api/bookings/credit", { credit_id: activeCredit.id, start_at: startIso, visitor_tz: tz });
        if (r.status === 401) return setAuthOpen(true);
        if (r.status === 409 && r.body.error === "no_credits") {
          setStatus({ tone: "error", text: "No credits left on this pack." });
          setSelected(null);
          refetch();
          void loadCredits();
          return;
        }
        if (r.status === 409 && r.body.error === "free_booking_limit") {
          setStatus({ tone: "error", text: RESCHEDULE_ERRORS.free_booking_limit });
          setSelected(null);
          return;
        }
        if (r.status === 409) return onTaken();
        if (!r.ok) {
          setStatus({ tone: "error", text: "That credit can't be used for this time. Please refresh and try again." });
          refetch();
          return;
        }
        setBooked({ name: lesson.name, when: String(r.body.when_label ?? sel?.local ?? "") });
        setSelected(null);
        refetch();
        void loadCredits();
        return;
      }
      const r = await postJson("/api/bookings/hold", { lesson_slug: lesson.slug, start_at: startIso, visitor_tz: tz });
      if (r.status === 401) return setAuthOpen(true);
      if (r.status === 409 && r.body.error === "free_booking_limit") {
        setStatus({ tone: "error", text: "You already have this free session type held or booked. Complete checkout, release the hold, or manage your booking in your account." });
        setSelected(null);
        return;
      }
      if (r.status === 409) return onTaken();
      if (r.status === 429 && r.body.error === "too_many_holds") {
        setStatus({ tone: "error", text: "You're holding too many times — check out or release one first." });
        setSelected(null);
        return;
      }
      if (!r.ok) {
        setStatus({ tone: "error", text: "That time can't be booked any more. Please pick another." });
        setSelected(null);
        refetch();
        return;
      }
      addLessonBooking({
        bookingId: String(r.body.booking_id),
        lessonId: Number(lesson.id),
        name: lesson.name,
        price: Number(r.body.price ?? lesson.price),
        whenLabel: String(r.body.when_label ?? sel?.local ?? ""),
        holdExpiresAt: String(r.body.hold_expires_at ?? ""),
      });
      setStatus({ tone: "info", text: "Added to your cart — the time is held while you check out." });
      setSelected(null);
      refetch();
    } catch {
      setStatus({ tone: "error", text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  function onAction() {
    if (!authed) {
      setAuthOpen(true);
      return;
    }
    void submit();
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (rescheduleParam === null) {
    return (
      <p className="booking-reschedule-unavailable rounded-[10px] bg-[rgb(244,242,238)] p-5 font-inconsolata text-sm text-red-600 dark:bg-neutral-900">
        This session can't be moved online right now.{" "}
        <a className="booking-reschedule-contact underline underline-offset-2" href="/contact">
          Get in touch
        </a>{" "}
        and Shaun will sort out a new time.
      </p>
    );
  }
  if (!booked && !lesson && !selectableSingles.length) {
    return (
      <p className="booking-panel-empty text-sm text-muted-foreground">
        Online booking isn't open right now. <a className="underline" href="/contact">Get in touch</a> to arrange a session.
      </p>
    );
  }

  const pill = (on: boolean) =>
    `booking-mode-pill rounded-full border px-3 py-1 text-xs transition-colors ${
      on
        ? "border-[#231f20] bg-[#231f20] text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
        : "border-[#cfcac4] bg-white text-[#1f1d1e] hover:border-[#231f20] dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
    }`;

  if (booked) {
    return (
      <div className="booking-confirmed space-y-3 rounded-[10px] bg-[rgb(244,242,238)] p-5 font-inconsolata text-[#1f1d1e] dark:bg-neutral-900 dark:text-neutral-100">
        <h3 className="booking-confirmed-title font-overpass-mono text-lg tracking-tight">
          {reschedule ? `${booked.name} moved` : `${booked.name} confirmed`}
        </h3>
        <p className="booking-confirmed-when text-sm">{booked.when}</p>
        <p className="booking-confirmed-note text-sm text-[#6b6668] dark:text-neutral-400">
          {reschedule
            ? "Your old time has been released. The session link is sent before your session."
            : "A confirmation email is on its way. The session link is sent before your session."}
        </p>
        <div className="booking-confirmed-actions flex flex-wrap gap-2">
          <Button asChild size="sm" className="btn-booking-account">
            <a href="/account">View in your account</a>
          </Button>
          {!reschedule && (
            <Button size="sm" variant="outline" className="btn-booking-another" onClick={() => setBooked(null)}>
              Book another
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="booking-panel rounded-[10px] bg-[rgb(244,242,238)] p-4 font-inconsolata text-[13px] text-[#1f1d1e] sm:p-5 dark:bg-neutral-900 dark:text-neutral-100">
      <h3 className="booking-panel-title mb-2 font-overpass-mono text-base tracking-tight">
        {reschedule ? "Pick a new time" : "Pick a time"}
      </h3>

      {reschedule ? (
        <p className="booking-reschedule-note text-xs text-[#6b6668] dark:text-neutral-400">
          Moving your {lesson?.name ?? "session"}. Your current time stays booked until you choose a new one ·{" "}
          <a href="/account" className="booking-reschedule-keep underline underline-offset-2">
            keep current time
          </a>
        </p>
      ) : (
        <div className="booking-mode-list flex flex-wrap gap-2" role="radiogroup" aria-label="Session">
          {selectableSingles.map((l) => {
            const on = mode?.type === "single" && mode.slug === l.slug;
            return (
              <button
                key={l.slug}
                type="button"
                role="radio"
                aria-checked={on}
                className={pill(on)}
                onClick={() => setMode({ type: "single", slug: l.slug })}
              >
                {l.name} · {l.durationMinutes} min
              </button>
            );
          })}
          {usableCredits.map((c) => {
            const on = mode?.type === "credit" && mode.creditId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={pill(on)}
                onClick={() => setMode({ type: "credit", creditId: c.id })}
              >
                Use a credit — {c.packName} ({c.remaining} left{c.expiresAt ? `, expires ${shortDate(c.expiresAt)}` : ""})
              </button>
            );
          })}
        </div>
      )}

      <div className="booking-tz mt-3 text-xs text-[#6b6668] dark:text-neutral-400">
        Times in{" "}
        <b className="booking-tz-name text-[#1f1d1e] dark:text-neutral-100">
          {cityOf(tz)} ({gmtOffset(tz, Date.parse(`${days[0]}T12:00:00Z`))})
        </b>{" "}
        ·{" "}
        <button
          type="button"
          className="booking-tz-change underline underline-offset-2"
          onClick={() => setTzEditing((v) => !v)}
          aria-expanded={tzEditing}
        >
          change
        </button>
        {tzEditing && (
          <div className="booking-tz-picker mt-2 max-w-sm">
            <div className="booking-tz-search flex items-center gap-2">
              <Input
                className="booking-tz-input h-8 bg-white text-xs dark:bg-neutral-800"
                placeholder="Search city, e.g. London"
                aria-label="Time zone"
                aria-controls="booking-tz-options"
                autoFocus
                value={tzQuery}
                onChange={(e) => setTzQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (tzMatches[0]) chooseTz(tzMatches[0]);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closeTzPicker();
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="btn-booking-tz-close h-8 w-8 shrink-0"
                aria-label="Close time zone picker"
                onClick={closeTzPicker}
              >
                <X />
              </Button>
            </div>
            <ul
              id="booking-tz-options"
              role="listbox"
              aria-label="Matching time zones"
              className="booking-tz-options mt-1 max-h-48 overflow-y-auto rounded-md border border-[#d9d4ce] bg-white dark:border-neutral-700 dark:bg-neutral-800"
            >
              {tzMatches.length === 0 ? (
                <li className="booking-tz-none px-3 py-1.5 text-xs">No matching time zone</li>
              ) : (
                tzMatches.map((z, i) => (
                  <li key={z} role="option" aria-selected={z === tz} className="booking-tz-option-item">
                    <button
                      type="button"
                      className={`booking-tz-option w-full px-3 py-1.5 text-left text-xs hover:bg-[#f4f2ee] dark:hover:bg-neutral-700 ${
                        i === 0 ? "bg-[#f4f2ee] dark:bg-neutral-700" : ""
                      }`}
                      onClick={() => chooseTz(z)}
                    >
                      {cityOf(z)} <span className="booking-tz-option-id text-[#8a8486]">{z}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="booking-week-nav mt-3 mb-2 flex items-center justify-between gap-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="btn-booking-prev h-8 w-8"
          onClick={() => step(-1)}
          disabled={!canPrev}
          aria-label="Earlier days"
        >
          <ChevronLeft />
        </Button>
        <span className="booking-week-label font-overpass-mono text-xs">{rangeLabel(days[0], days[days.length - 1])}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="btn-booking-next h-8 w-8"
          onClick={() => step(1)}
          disabled={!canNext}
          aria-label="Later days"
        >
          <ChevronRight />
        </Button>
      </div>

      <div className={`booking-grid-wrap transition-opacity ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
        {loadError ? (
          <p className="booking-grid-error py-6 text-center text-xs text-red-600">
            Couldn't load times.{" "}
            <button type="button" className="booking-grid-retry underline" onClick={refetch}>
              Try again
            </button>
          </p>
        ) : model.rows.length === 0 ? (
          <p className="booking-grid-empty py-6 text-center text-xs text-[#6b6668] dark:text-neutral-400">
            {loading ? "Loading times…" : "No open times in these days — try the next ones."}
          </p>
        ) : (
          <WeekGrid
            days={days}
            model={model}
            startAt={startAt}
            selected={selectedKeys}
            onSelect={(ms) => {
              setStatus(null);
              setSelected(ms);
            }}
            onSwipe={mobile ? step : undefined}
          />
        )}
      </div>

      <GridLegend />

      {status && (
        <p
          role="status"
          className={`booking-status mt-3 text-xs ${status.tone === "error" ? "text-red-600" : "text-[#1f1d1e] dark:text-neutral-100"}`}
        >
          {status.text}
        </p>
      )}

      {sel && (
        // Sticky above the site's fixed footer (taller on mobile, where it stacks) so the CTA is never hidden.
        <div className="booking-summary sticky bottom-[calc(7rem+env(safe-area-inset-bottom))] z-20 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d9d4ce] bg-white p-3 shadow-md sm:bottom-24 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="booking-summary-when min-w-0">
            <div className="booking-summary-local font-overpass-mono text-xs">{sel.local}</div>
            {sel.sydney && (
              <div className="booking-summary-sydney text-xs text-[#6b6668] dark:text-neutral-400">{sel.sydney}</div>
            )}
          </div>
          {authed && (
            <div className="booking-summary-contact flex w-full flex-col gap-1.5 sm:w-auto">
              <Input
                type="tel"
                autoComplete="tel"
                className="booking-summary-phone h-8 text-xs"
                placeholder="Mobile (optional)"
                aria-label="Mobile number (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <label className="booking-summary-sms flex items-center gap-2 text-xs text-[#6b6668] dark:text-neutral-400">
                <input
                  type="checkbox"
                  className="booking-summary-sms-checkbox"
                  checked={smsOptIn}
                  disabled={!phone.trim()}
                  onChange={(e) => setSmsOptIn(e.target.checked)}
                />
                Text me session reminders
              </label>
            </div>
          )}
          <Button
            type="button"
            className="btn-booking-action w-full sm:w-auto"
            disabled={busy || sess.status === "loading"}
            onClick={onAction}
          >
            {busy ? "Working…" : reschedule ? "Move session here" : activeCredit ? "Book with credit" : "Add to cart"}
          </Button>
        </div>
      )}

      <AuthOverlay open={authOpen} onOpenChange={setAuthOpen} onAuthenticated={() => void submit()} />
    </div>
  );
}
