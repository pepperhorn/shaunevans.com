import { describe, expect, it } from "vitest";
import { publicLessons, linkedLesson } from "@/lib/booking/selection";
import { lessons, type Lesson } from "@/data/lessons";

const free: Lesson = { ...lessons[0], id: "9", slug: "bws-consultation", name: "Build with Shaun consultation", price: 0, durationMinutes: 30 };
const intro: Lesson = { ...free, id: "10", slug: "intro-15", name: "Free 15-minute intro", tagline: "Getting to know you", durationMinutes: 15 };
const catalogue = [...lessons, intro, free];

describe("unlisted lessons and deep links", () => {
  it("hides the default consultation without removing it from the bookable catalogue", () => {
    expect(publicLessons(catalogue)).toEqual([...lessons, intro]);
    expect(linkedLesson(catalogue, "?lesson=intro-15")).toEqual(intro);
    expect(linkedLesson(catalogue, "?lesson=bws-consultation")).toEqual(free);
  });
  it("trims comma-separated slugs and allows an explicit empty list", () => {
    expect(publicLessons(catalogue, " single-session, bws-consultation, ,").map((l) => l.slug)).not.toContain("single-session");
    expect(publicLessons(catalogue, "")).toEqual(catalogue);
  });
  it("preselects ordinary published singles too", () => {
    expect(linkedLesson(catalogue, "?lesson=single-session")).toEqual(lessons[0]);
  });
  it.each(["?lesson=unknown", "?lesson=four-pack", "?lesson=in-person-intensive", "", "?reschedule=b1&lesson=bws-consultation"])("does not select %s as a purchase", (search) => {
    expect(linkedLesson(catalogue, search)).toBeUndefined();
  });
});
