import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import type { Lesson } from "@/data/lessons";
import { addToCart } from "@/lib/cart";

/** Shared with BookingPanel (kept here so the card doesn't pull in the panel bundle). */
export const PICK_LESSON_EVENT = "booking:pick-lesson";

const formatLabel: Record<Lesson["format"], string> = {
  online: "Online",
  "in-person": "In person",
  hybrid: "Hybrid",
};

export default function LessonCard({ lesson }: { lesson: Lesson }) {
  const kind = lesson.kind ?? (lesson.bookingMode === "contact" ? "contact" : "single");
  return (
    <Card
      className={`lesson-card relative flex flex-col border-border/60 ${
        lesson.popular ? "ring-2 ring-foreground/80" : ""
      }`}
    >
      {lesson.popular && (
        <Badge className="lesson-popular-badge absolute -top-3 left-6">Most popular</Badge>
      )}
      <CardHeader className="lesson-card-header space-y-2">
        <div className="lesson-meta flex items-center gap-2">
          <Badge variant="outline">{formatLabel[lesson.format]}</Badge>
          <span className="lesson-duration text-xs text-muted-foreground">
            {lesson.duration}
          </span>
        </div>
        <h3 className="lesson-name text-xl font-semibold tracking-tight">{lesson.name}</h3>
        <p className="lesson-tagline text-sm text-muted-foreground">{lesson.tagline}</p>
      </CardHeader>
      <CardContent className="lesson-card-content flex-1 space-y-4">
        <div className="lesson-price flex items-baseline gap-1">
          {lesson.priceFrom && (
            <span className="lesson-price-from text-sm text-muted-foreground">from</span>
          )}
          <span className="lesson-price-amount text-3xl font-bold tabular-nums">
            ${lesson.price}
          </span>
          {lesson.currency && (
            <span className="lesson-price-currency text-xs text-muted-foreground">
              {lesson.currency}
            </span>
          )}
        </div>
        <p className="lesson-description text-sm text-muted-foreground">{lesson.description}</p>
        <ul className="lesson-includes space-y-2 text-sm">
          {lesson.includes.map((line) => (
            <li key={line} className="lesson-include flex items-start gap-2">
              <Check className="lesson-include-icon mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="lesson-card-footer">
        {kind === "contact" ? (
          <Button
            asChild
            className="lesson-contact-btn w-full"
            variant={lesson.popular ? "default" : "outline"}
          >
            <a href="/contact">Contact Shaun</a>
          </Button>
        ) : kind === "pack" ? (
          <Button
            className="lesson-buy-pack-btn w-full"
            variant={lesson.popular ? "default" : "outline"}
            onClick={() =>
              addToCart({
                id: `pack:${lesson.id}`,
                slug: lesson.slug,
                name: lesson.name,
                price: lesson.price,
                image: "",
                kind: "lesson_pack",
                lessonId: Number(lesson.id),
              })
            }
          >
            Buy pack
          </Button>
        ) : (
          <Button
            className="lesson-pick-time-btn w-full"
            variant={lesson.popular ? "default" : "outline"}
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent(PICK_LESSON_EVENT, { detail: { slug: lesson.slug } }),
              );
              document
                .getElementById("booking-panel")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Pick a time
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
