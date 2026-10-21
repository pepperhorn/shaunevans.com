/** Display helpers for the booking panel (visitor zone + Sydney). Client-safe. */
import { BOOKING_TZ } from "@/lib/booking/time";

export const TZ_STORAGE_KEY = "se:tz";

export function isTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Saved zone (localStorage `se:tz`) or the browser's own. */
export function initialTimeZone(): string {
  try {
    const saved = localStorage.getItem(TZ_STORAGE_KEY);
    if (isTimeZone(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || BOOKING_TZ;
}

const FALLBACK_ZONES = [
  "Australia/Sydney",
  "Australia/Perth",
  "Pacific/Auckland",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
];

/** Every IANA zone the browser knows; a short list (+ the browser's own) where `supportedValuesOf` is missing. */
export function allTimeZones(): string[] {
  try {
    const all = Intl.supportedValuesOf?.("timeZone");
    if (all?.length) return all;
  } catch {
    /* fall through */
  }
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return own && !FALLBACK_ZONES.includes(own) ? [...FALLBACK_ZONES, own] : FALLBACK_ZONES;
}

/** Zones whose id or city contains `query` (case-insensitive; spaces match underscores). */
export function filterTimeZones(zones: string[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!q) return zones.slice(0, limit);
  const hits = zones.filter((z) => z.toLowerCase().includes(q));
  // City-prefix matches first ("lon" → London before Barcelona-ish partials).
  const city = (z: string) => (z.split("/").pop() ?? z).toLowerCase();
  hits.sort((a, b) => Number(!city(a).startsWith(q)) - Number(!city(b).startsWith(q)));
  return hits.slice(0, limit);
}

/** "Australia/Sydney" → "Sydney", "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export const cityOf = (tz: string) => (tz.split("/").pop() ?? tz).replace(/_/g, " ");

/** "GMT+1", "GMT+5:45", "GMT+0" at instant `at`. */
export function gmtOffset(tz: string, at = Date.now()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value === "GMT" ? "GMT+0" : (part?.value ?? "GMT");
}

const hhmm = (ms: number, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

/** "Wed 22 Oct" for a visitor-local YYYY-MM-DD (rendered at noon UTC, so any zone gives the same date). */
export function dayLabel(dateIso: string): { weekday: string; date: string } {
  const d = Date.parse(`${dateIso}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(d);
  return { weekday: f({ weekday: "short" }), date: f({ day: "numeric", month: "short" }) };
}

/** "20–26 Oct" / "29 Oct – 2 Nov". */
export function rangeLabel(first: string, last: string): string {
  const a = dayLabel(first).date.split(" ");
  const b = dayLabel(last).date.split(" ");
  return a[1] === b[1] ? `${a[0]}–${b[0]} ${b[1]}` : `${a.join(" ")} – ${b.join(" ")}`;
}

/** Summary bar lines: "Wed 22 Oct · 09:00–10:00 London" and "= 18:00 AEDT Sydney". */
export function selectionLabel(startMs: number, durationMins: number, tz: string): { local: string; sydney: string | null } {
  const endMs = startMs + durationMins * 60_000;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(startMs);
  const local = `${day.replace(",", "")} · ${hhmm(startMs, tz)}–${hhmm(endMs, tz)} ${cityOf(tz)}`;
  if (tz === BOOKING_TZ) return { local, sydney: null };
  const abbr =
    new Intl.DateTimeFormat("en-AU", { timeZone: BOOKING_TZ, timeZoneName: "short" })
      .formatToParts(startMs)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const sydDay = new Intl.DateTimeFormat("en-GB", { timeZone: BOOKING_TZ, weekday: "short" }).format(startMs);
  return { local, sydney: `= ${sydDay} ${hhmm(startMs, BOOKING_TZ)} ${abbr} Sydney`.replace(/\s+/g, " ") };
}

/** "18 Oct 2027". */
export const shortDate = (iso: string) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(Date.parse(iso)) : "";
