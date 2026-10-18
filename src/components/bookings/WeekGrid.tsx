import { useRef } from "react";
import type { CellState, GridModel } from "./gridModel";
import { dayLabel } from "./timeLabels";

type Props = {
  days: string[];
  model: GridModel;
  /** Cell key → start instant, for `start` cells. */
  startAt: Map<string, number>;
  /** Keys covered by the selected lesson span. */
  selected: Set<string>;
  onSelect: (startMs: number) => void;
  /** Mobile swipe: -1 = previous days, +1 = next days. */
  onSwipe?: (dir: -1 | 1) => void;
};

const HATCH =
  "bg-[repeating-linear-gradient(45deg,#e7e3de_0_4px,#efebe6_4px_8px)] dark:bg-[repeating-linear-gradient(45deg,#2b2a29_0_4px,#33312f_4px_8px)]";

const stateClass: Record<CellState, string> = {
  start:
    "booking-grid-cell--start cursor-pointer border border-[#d9d4ce] bg-white hover:border-[#231f20] hover:bg-[#f4f2ee] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#231f20] dark:border-neutral-600 dark:bg-neutral-800 dark:hover:border-neutral-200",
  available: "booking-grid-cell--available border border-[#d9d4ce] bg-white dark:border-neutral-600 dark:bg-neutral-800",
  booked: "booking-grid-cell--booked bg-[#cfcac4] dark:bg-neutral-600",
  unavailable: `booking-grid-cell--unavailable ${HATCH}`,
};

const SELECTED =
  "booking-grid-cell--selected border border-[#231f20] bg-[#231f20] dark:border-neutral-100 dark:bg-neutral-100";

export default function WeekGrid({ days, model, startAt, selected, onSelect, onSwipe }: Props) {
  const touchX = useRef<number | null>(null);

  return (
    <div
      className="booking-grid grid w-full gap-[3px] select-none"
      style={{ gridTemplateColumns: `2.75rem repeat(${days.length}, minmax(0, 1fr))` }}
      role="grid"
      aria-label="Available lesson start times"
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null || !onSwipe) return;
        const dx = end - start;
        if (Math.abs(dx) > 50) onSwipe(dx < 0 ? 1 : -1);
      }}
    >
      <div className="booking-grid-corner" role="presentation" />
      {days.map((d) => {
        const l = dayLabel(d);
        return (
          <div
            key={d}
            role="columnheader"
            className="booking-grid-day-header pb-1 text-center text-[11px] leading-tight text-[#6b6668] dark:text-neutral-400"
          >
            <span className="booking-grid-day-weekday block font-overpass-mono text-xs text-[#1f1d1e] dark:text-neutral-100">
              {l.weekday}
            </span>
            <span className="booking-grid-day-date block">{l.date}</span>
          </div>
        );
      })}

      {model.rows.map((row) => (
        <div key={row} className="booking-grid-row contents" role="row">
          <div
            role="rowheader"
            className={`booking-grid-time h-7 pr-1 text-right text-[10px] leading-7 text-[#8a8486] sm:h-[22px] sm:leading-[22px] dark:text-neutral-500 ${
              row.endsWith(":00") ? "" : "opacity-60"
            }`}
          >
            {row}
          </div>
          {days.map((d) => {
            const key = `${d}|${row}`;
            const state = model.cells[key] ?? "unavailable";
            const isSel = selected.has(key);
            const base = "booking-grid-cell h-7 rounded-[3px] sm:h-[22px]";
            const ms = startAt.get(key);
            if (state === "start" && ms != null) {
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  aria-selected={isSel}
                  aria-label={`${dayLabel(d).weekday} ${dayLabel(d).date} ${row}`}
                  onClick={() => onSelect(ms)}
                  className={`${base} ${isSel ? SELECTED : stateClass.start}`}
                />
              );
            }
            return (
              <div
                key={key}
                role="gridcell"
                aria-label={isSel ? undefined : state}
                className={`${base} ${isSel ? SELECTED : stateClass[state]}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function GridLegend() {
  const sw = "booking-legend-swatch inline-block h-2.5 w-3.5 rounded-[2px] align-middle";
  return (
    <div className="booking-legend mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#6b6668] dark:text-neutral-400">
      <span className="booking-legend-item flex items-center gap-1">
        <i className={`${sw} border border-[#d9d4ce] bg-white dark:border-neutral-600 dark:bg-neutral-800`} />
        Available
      </span>
      <span className="booking-legend-item flex items-center gap-1">
        <i className={`${sw} bg-[#cfcac4] dark:bg-neutral-600`} />
        Booked
      </span>
      <span className="booking-legend-item flex items-center gap-1">
        <i className={`${sw} ${HATCH}`} />
        Unavailable
      </span>
      <span className="booking-legend-item flex items-center gap-1">
        <i className={`${sw} bg-[#231f20] dark:bg-neutral-100`} />
        Your lesson
      </span>
    </div>
  );
}
