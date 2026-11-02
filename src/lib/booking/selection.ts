import type { Lesson } from "@/data/lessons";

/** Unlisted is discoverability, not access control. The input catalogue is published-only. */
export function publicLessons(lessons: Lesson[], unlisted = "bws-consultation"): Lesson[] {
  const hidden = new Set(unlisted.split(",").map((s) => s.trim()).filter(Boolean));
  return lessons.filter((l) => !hidden.has(l.slug));
}

/** A reschedule owns the lesson query parameter; invalid moves must never become purchases. */
export function linkedLesson(lessons: Lesson[], search: string): Lesson | undefined {
  const q = new URLSearchParams(search);
  if (q.get("reschedule")) return undefined;
  return lessons.find((l) => l.slug === q.get("lesson") && l.kind === "single" && l.durationMinutes);
}
