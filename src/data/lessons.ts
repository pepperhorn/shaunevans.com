export type Lesson = {
  id: string;
  slug: string;
  name: string;
  price: number;
  duration: string;
  format: "online" | "in-person" | "hybrid";
  tagline: string;
  description: string;
  includes: string[];
  popular?: boolean;
};

export const lessons: Lesson[] = [
  {
    id: "l_001",
    slug: "single-session",
    name: "Single Session",
    price: 90,
    duration: "60 min",
    format: "online",
    tagline: "One-off lesson · sax, theory, or improvisation.",
    description:
      "A focused single session — pick a topic in advance or come with a piece you're stuck on. Includes a written summary and practice plan after.",
    includes: [
      "60-minute live session over Zoom",
      "Written practice plan",
      "Recording of the session",
    ],
  },
  {
    id: "l_002",
    slug: "four-pack",
    name: "Four-Pack",
    price: 320,
    duration: "4 × 60 min",
    format: "online",
    tagline: "Four lessons booked over six weeks.",
    description:
      "Best for working on a specific project — recital prep, a tricky chart, building an improv vocabulary. Schedule sessions at your pace across six weeks.",
    includes: [
      "Four 60-minute sessions over Zoom",
      "Practice plan after each lesson",
      "Session recordings kept indefinitely",
      "Email follow-ups between sessions",
    ],
    popular: true,
  },
  {
    id: "l_003",
    slug: "composition-mentorship",
    name: "Composition Mentorship",
    price: 540,
    duration: "6 × 75 min",
    format: "online",
    tagline: "Three-month mentorship for one piece.",
    description:
      "We take a single piece from sketch to finished score over six biweekly sessions. Tailored to whatever stage you're at — concert work, small-group chart, or song with lyrics.",
    includes: [
      "Six 75-minute mentorship sessions",
      "Score review between sessions",
      "Final read-through with a player",
      "Recording of the read-through",
    ],
  },
  {
    id: "l_004",
    slug: "in-person-intensive",
    name: "In-Person Intensive (Singapore)",
    price: 600,
    duration: "Full day",
    format: "in-person",
    tagline: "One day, in studio, in Singapore.",
    description:
      "A full day in the studio working on technique, repertoire, or your own composition project. Includes lunch and a recording of any playing we do.",
    includes: [
      "Six hours of one-on-one studio time",
      "Lunch and refreshments",
      "Studio recording of any playing",
      "Follow-up call within two weeks",
    ],
  },
];
