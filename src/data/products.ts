export type Product = {
  id: string;
  slug: string;
  name: string;
  price: number;
  category: "sheet-music" | "recordings" | "merch" | "courses";
  tagline: string;
  description: string;
  image: string;
  featured?: boolean;
};

export const products: Product[] = [
  {
    id: "p_001",
    slug: "alto-sax-etudes-vol-1",
    name: "Alto Sax Etudes, Vol. 1",
    price: 18,
    category: "sheet-music",
    tagline: "Twelve studies for the contemporary player.",
    description:
      "A collection of twelve original etudes covering articulation, altissimo, and modal phrasing. PDF download, 64 pages, with practice notes for each piece.",
    image: "https://picsum.photos/seed/se-etudes/800/800",
    featured: true,
  },
  {
    id: "p_002",
    slug: "zoot-suite-score",
    name: "Zoot Suite — Full Score",
    price: 32,
    category: "sheet-music",
    tagline: "Full big-band score with parts.",
    description:
      "Concert-length suite in four movements, originally written for The Hot Buttered Sax Quintet. Includes conductor's score plus parts for sax 1–5, trumpet 1–4, trombone 1–4, rhythm section.",
    image: "https://picsum.photos/seed/se-zoot/800/800",
  },
  {
    id: "p_003",
    slug: "live-at-the-blue-room",
    name: "Live at the Blue Room",
    price: 14,
    category: "recordings",
    tagline: "2024 live album · 9 tracks.",
    description:
      "Recorded across two nights at the Blue Room. Lossless FLAC + 320kbps MP3 downloads, with liner notes and rehearsal photos as a bundled PDF.",
    image: "https://picsum.photos/seed/se-blueroom/800/800",
    featured: true,
  },
  {
    id: "p_004",
    slug: "after-hours-ep",
    name: "After Hours — EP",
    price: 8,
    category: "recordings",
    tagline: "Five-track EP of quiet ballads.",
    description:
      "Late-night sessions with piano, bass, and drums. Five originals and one Strayhorn arrangement. Digital download.",
    image: "https://picsum.photos/seed/se-afterhours/800/800",
  },
  {
    id: "p_005",
    slug: "signed-print",
    name: "Signed Tour Print",
    price: 25,
    category: "merch",
    tagline: "Limited 11×14 print, hand-signed.",
    description:
      "Black-and-white print from the 2024 tour, hand-numbered out of 100 and signed. Ships in a rigid mailer. Allow 2–3 weeks for delivery.",
    image: "https://picsum.photos/seed/se-print/800/800",
  },
  {
    id: "p_006",
    slug: "altissimo-tee",
    name: "Altissimo Tee",
    price: 30,
    category: "merch",
    tagline: "Heavyweight cotton, screen-printed.",
    description:
      "Heavy 240gsm cotton tee with a screen-printed altissimo fingering chart on the back. Available S–XXL. Order before the next pressing closes.",
    image: "https://picsum.photos/seed/se-tee/800/800",
  },
  {
    id: "p_007",
    slug: "modal-improv-course",
    name: "Modal Improvisation — Self-Paced",
    price: 89,
    category: "courses",
    tagline: "Eight modules · ~6 hours of video.",
    description:
      "A structured walk through modal improvisation, with backing tracks, transcribed solos, and practice prompts. Lifetime access; downloadable for offline practice.",
    image: "https://picsum.photos/seed/se-modal/800/800",
    featured: true,
  },
  {
    id: "p_008",
    slug: "arranging-for-small-groups",
    name: "Arranging for Small Groups",
    price: 65,
    category: "courses",
    tagline: "Six modules · score studies + assignments.",
    description:
      "How to voice a 5–8 piece group so it reads big without sounding dense. Includes Sibelius/MuseScore example files plus four full arrangements as score studies.",
    image: "https://picsum.photos/seed/se-arranging/800/800",
  },
];
