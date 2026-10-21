/**
 * Minimal RFC 5545 calendar writer for the bookings subscription feed.
 * UTC instants only (`…Z`), CRLF line endings, lines folded at 75 octets.
 */

export type IcsEvent = {
  uid: string;
  start: number; // epoch ms
  end: number; // epoch ms
  summary: string;
  description: string;
  url?: string;
  transparent?: boolean;
};

const CRLF = "\r\n";
const MAX_OCTETS = 75;

/** 20261021T080000Z */
function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** TEXT value escaping (RFC 5545 §3.3.11). */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold one content line at 75 octets without splitting a UTF-8 character (§3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let octets = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    // Continuation lines start with a space, which counts toward their 75.
    if (octets + n > MAX_OCTETS) {
      out.push(cur);
      cur = " ";
      octets = 1;
    }
    cur += ch;
    octets += n;
  }
  out.push(cur);
  return out.join(CRLF);
}

export function renderIcs(events: IcsEvent[], now: number): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//shaunevans.com//Lesson bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Shaun Evans — lessons",
  ];
  const stamp = utcStamp(now);
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(e.start)}`,
      `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
    );
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push(`TRANSP:${e.transparent ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join(CRLF) + CRLF;
}
