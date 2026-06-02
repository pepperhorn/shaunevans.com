import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import type { Lesson } from "@/data/lessons";

const formatLabel: Record<Lesson["format"], string> = {
  online: "Online",
  "in-person": "In person",
  hybrid: "Hybrid",
};

export default function LessonCard({ lesson }: { lesson: Lesson }) {
  return (
    <Card
      className={`relative flex flex-col border-border/60 ${
        lesson.popular ? "ring-2 ring-foreground/80" : ""
      }`}
    >
      {lesson.popular && (
        <Badge className="absolute -top-3 left-6">Most popular</Badge>
      )}
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{formatLabel[lesson.format]}</Badge>
          <span className="text-xs text-muted-foreground">
            {lesson.duration}
          </span>
        </div>
        <h3 className="text-xl font-semibold tracking-tight">{lesson.name}</h3>
        <p className="text-sm text-muted-foreground">{lesson.tagline}</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums">
            ${lesson.price}
          </span>
          {lesson.id === "l_004" && (
            <span className="text-xs text-muted-foreground">SGD</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{lesson.description}</p>
        <ul className="space-y-2 text-sm">
          {lesson.includes.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          variant={lesson.popular ? "default" : "outline"}
          onClick={() => {
            const form = document.getElementById("booking-form");
            const select = document.getElementById(
              "booking-package",
            ) as HTMLSelectElement | null;
            if (select) {
              select.value = lesson.slug;
              select.dispatchEvent(new Event("change", { bubbles: true }));
            }
            form?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          Book this package
        </Button>
      </CardFooter>
    </Card>
  );
}
