import { describe, it, expect } from "vitest";
import { icsTokenMatches, renderIcs } from "@/lib/booking/ics";

const NOW = Date.UTC(2026, 9, 19, 1, 2, 3);
const S = Date.UTC(2026, 9, 21, 8, 0);
const H = 3_600_000;

const ev = (over: Partial<Parameters<typeof renderIcs>[0][number]> = {}) => ({
  uid: "booking-abc@shaunevans.com",
  start: S,
  end: S + H,
  summary: "Jo Bloggs — Saxophone lesson",
  description: "hello",
  ...over,
});

/** Undo RFC 5545 folding (CRLF + one space). */
const unfold = (s: string) => s.replace(/\r\n /g, "");

describe("renderIcs", () => {
  it("starts with BEGIN:VCALENDAR and ends with END:VCALENDAR CRLF", () => {
    const out = renderIcs([ev()], NOW);
    expect(out.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("uses CRLF line endings only", () => {
    const out = renderIcs([ev()], NOW);
    expect(out.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes UTC times ending in Z", () => {
    const out = renderIcs([ev()], NOW);
    expect(out).toContain("DTSTART:20261021T080000Z\r\n");
    expect(out).toContain("DTEND:20261021T090000Z\r\n");
    expect(out).toContain("DTSTAMP:20261019T010203Z\r\n");
  });

  it("folds a 100-char description at 75 octets", () => {
    const description = "x".repeat(100);
    const out = renderIcs([ev({ description })], NOW);
    for (const line of out.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(out).toMatch(/\r\n x/);
    expect(unfold(out)).toContain(`DESCRIPTION:${description}\r\n`);
  });

  it("never splits a multi-byte character when folding", () => {
    const summary = "é—".repeat(40);
    const out = renderIcs([ev({ summary })], NOW);
    for (const line of out.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(unfold(out)).toContain(`SUMMARY:${summary}\r\n`);
  });

  it("escapes ; , \\ and newlines", () => {
    const out = unfold(renderIcs([ev({ description: "a;b,c\\d\ne\r\nf" })], NOW));
    expect(out).toContain("DESCRIPTION:a\\;b\\,c\\\\d\\ne\\nf\r\n");
  });

  it("emits UID, URL and TRANSP:TRANSPARENT when set", () => {
    const out = renderIcs([ev({ url: "https://example.com/x", transparent: true })], NOW);
    expect(out).toContain("UID:booking-abc@shaunevans.com\r\n");
    expect(out).toContain("URL:https://example.com/x\r\n");
    expect(out).toContain("TRANSP:TRANSPARENT\r\n");
  });

  it("marks events opaque by default and renders an empty calendar", () => {
    expect(renderIcs([ev()], NOW)).toContain("TRANSP:OPAQUE\r\n");
    const empty = renderIcs([], NOW);
    expect(empty).not.toContain("BEGIN:VEVENT");
    expect(empty.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("icsTokenMatches", () => {
  it("rejects a missing token", () => expect(icsTokenMatches(null, "s3cret")).toBe(false));
  it("rejects an empty token", () => expect(icsTokenMatches("", "s3cret")).toBe(false));
  it("rejects a wrong token, including one of a different length", () => {
    expect(icsTokenMatches("s3creT", "s3cret")).toBe(false);
    expect(icsTokenMatches("s3cret-longer", "s3cret")).toBe(false);
  });
  it("rejects everything when no token is configured", () => {
    expect(icsTokenMatches("anything", undefined)).toBe(false);
    expect(icsTokenMatches("", "")).toBe(false);
  });
  it("accepts the right token", () => expect(icsTokenMatches("s3cret", "s3cret")).toBe(true));
});
