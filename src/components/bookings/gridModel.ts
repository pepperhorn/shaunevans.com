/**
 * Pure helpers that turn an availability view (UTC epoch ms) into a
 * visitor-local week grid of half-hour cells. Client-safe (no Directus).
 */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import type { AvailabilityView } from "@/lib/booking/slots";
import type { Interval } from "@/lib/booking/availability";
import { zonedParts } from "@/lib/booking/time";

dayjs.extend(utc);
dayjs.extend(timezone);

export type CellState = "available" | "booked" | "unavailable" | "start";
export type GridModel = { rows: string[]; cells: Record<string, CellState> };

const STEP_MS = 30 * 60_000;

/** Grid key "YYYY-MM-DD|HH:MM" of an instant in the visitor's zone. */
export function cellKey(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.date}|${p.hhmm}`;
}

/** Epoch ms of local midnight starting `dateIso` in `tz`. */
export function localMidnight(dateIso: string, tz: string): number {
  return dayjs.tz(`${dateIso} 00:00`, "YYYY-MM-DD HH:mm", tz).valueOf();
}

/** Cell keys covered by a lesson of `durationMins` starting at `startMs` (selection highlight). */
export function spanKeys(startMs: number, durationMins: number, tz: string): string[] {
  const keys: string[] = [];
  for (let t = startMs; t < startMs + durationMins * 60_000; t += STEP_MS) keys.push(cellKey(t, tz));
  return keys;
}

const overlaps = (xs: Interval[], a: number, b: number) => xs.some((i) => i.start < b && i.end > a);
const inside = (xs: Interval[], a: number, b: number) => xs.some((i) => i.start <= a && i.end >= b);

/**
 * Half-hour cells for `days` (visitor-local YYYY-MM-DD) in `tz`.
 * Cells sit on UTC half-hours (= Sydney :00/:30), so a :45-offset zone gets
 * "HH:15"/"HH:45" labels. `rows` lists only labels where some day touches a
 * block; every day still gets a state for every row.
 */
export function toGridModel(view: AvailabilityView, days: string[], tz: string, durationMins: number): GridModel {
  const starts = new Set(view.starts);
  const cells: Record<string, CellState> = {}; // every half-hour of every day
  const rowSet = new Set<string>();

  for (const day of days) {
    const dayStart = localMidnight(day, tz);
    const dayEnd = localMidnight(dayjs(day).add(1, "day").format("YYYY-MM-DD"), tz);
    for (let t = Math.ceil(dayStart / STEP_MS) * STEP_MS; t < dayEnd; t += STEP_MS) {
      const key = cellKey(t, tz);
      if (cells[key] && cells[key] !== "unavailable") continue; // DST fall-back repeat: keep the first useful state
      const end = t + STEP_MS;
      const state: CellState = overlaps(view.busy, t, end)
        ? "booked"
        : starts.has(t)
          ? "start"
          : inside(view.blocks, t, end)
            ? "available"
            : "unavailable";
      cells[key] = state;
      if (overlaps(view.blocks, t, end)) rowSet.add(key.slice(11));
    }
  }

  // A start's whole lesson span must be visible, even if a block edge trimmed a row.
  const daySet = new Set(days);
  for (const s of view.starts) {
    for (const key of spanKeys(s, durationMins, tz)) if (daySet.has(key.slice(0, 10))) rowSet.add(key.slice(11));
  }

  const rows = [...rowSet].sort();
  const out: Record<string, CellState> = {};
  for (const day of days) for (const r of rows) out[`${day}|${r}`] = cells[`${day}|${r}`] ?? "unavailable";
  return { rows, cells: out };
}
