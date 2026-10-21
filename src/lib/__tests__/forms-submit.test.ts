import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/forms/submit";
import type { FormField } from "@/lib/forms";

type Call = { method: string; path: string };
let calls: Call[];
let uploadResults: Array<string | null>;
let deleteOk: boolean;
let submissionOk: boolean;

function field(p: Partial<FormField> & Pick<FormField, "name" | "type">): FormField {
  return {
    id: `f-${p.name}`,
    label: p.name,
    placeholder: null,
    help: null,
    validation: null,
    width: null,
    choices: null,
    required: false,
    sort: 0,
    ...p,
  };
}

let fields: FormField[];

function mockDirectus() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const method = init.method ?? "GET";
      calls.push({ method, path: u.pathname });
      const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
      if (method === "GET" && u.pathname.startsWith("/items/forms/")) {
        return ok({ id: "form-1", title: "Contact", is_active: true, on_success: "message", success_message: "Thanks", success_redirect_url: null, submit_label: null, fields });
      }
      if (method === "POST" && u.pathname === "/files") {
        const id = uploadResults.shift() ?? null;
        return id ? ok({ id }) : new Response("nope", { status: 500 });
      }
      if (method === "DELETE" && u.pathname.startsWith("/files/")) {
        return new Response(null, { status: deleteOk ? 204 : 403 });
      }
      if (method === "POST" && u.pathname === "/items/form_submissions") {
        return submissionOk ? ok({ id: 1 }) : new Response("boom", { status: 500 });
      }
      throw new Error(`unmocked ${method} ${u.pathname}`);
    }),
  );
}

async function submit(entries: Array<[string, string | File]>) {
  const fd = new FormData();
  fd.set("form_id", "form-1");
  for (const [k, v] of entries) fd.append(k, v);
  const request = new Request("http://localhost/api/forms/submit", { method: "POST", body: fd });
  return (POST as (ctx: unknown) => Promise<Response>)({ request });
}

const file = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name);
const uploads = () => calls.filter((c) => c.method === "POST" && c.path === "/files");
const deletes = () => calls.filter((c) => c.method === "DELETE");

beforeEach(() => {
  vi.stubEnv("DIRECTUS_URL", "https://cms.test");
  vi.stubEnv("DIRECTUS_TOKEN", "tok");
  calls = [];
  uploadResults = ["file-a", "file-b"];
  deleteOk = true;
  submissionOk = true;
  fields = [];
  mockDirectus();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/forms/submit", () => {
  it("rejects a file over 10 MB with a field error and uploads nothing", async () => {
    fields = [field({ name: "cv", type: "file" })];
    const res = await submit([["cv", file("big.pdf", 10 * 1024 * 1024 + 1)]]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field_errors.cv).toMatch(/too large/);
    expect(uploads()).toHaveLength(0);
  });

  it("accepts a file of exactly 10 MB", async () => {
    fields = [field({ name: "cv", type: "file" })];
    const res = await submit([["cv", file("ok.pdf", 10 * 1024 * 1024)]]);
    expect(res.status).toBe(200);
    expect(uploads()).toHaveLength(1);
  });

  it("validates non-file fields before uploading anything", async () => {
    fields = [
      field({ name: "cv", type: "file", sort: 1 }),
      field({ name: "email", type: "text", validation: "email", sort: 2 }),
    ];
    const res = await submit([["cv", file("cv.pdf")], ["email", "not-an-email"]]);
    expect(res.status).toBe(400);
    expect((await res.json()).field_errors.email).toBeTruthy();
    expect(uploads()).toHaveLength(0);
    expect(calls.some((c) => c.path === "/items/form_submissions")).toBe(false);
  });

  it("uploads only after validation passes, then creates the submission", async () => {
    fields = [field({ name: "cv", type: "file" }), field({ name: "msg", type: "text" })];
    const res = await submit([["cv", file("cv.pdf")], ["msg", "hi"]]);
    expect(res.status).toBe(200);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /items/forms/form-1",
      "POST /files",
      "POST /items/form_submissions",
    ]);
  });

  it("deletes already-uploaded files when a later upload fails", async () => {
    fields = [field({ name: "a", type: "file", sort: 1 }), field({ name: "b", type: "file", sort: 2 })];
    uploadResults = ["file-a", null];
    const res = await submit([["a", file("a.pdf")], ["b", file("b.pdf")]]);
    expect(res.status).toBe(400);
    expect((await res.json()).field_errors.b).toMatch(/upload failed/);
    expect(deletes().map((c) => c.path)).toEqual(["/files/file-a"]);
    expect(calls.some((c) => c.path === "/items/form_submissions")).toBe(false);
  });

  it("logs orphaned upload ids when the token can't delete them", async () => {
    fields = [field({ name: "a", type: "file", sort: 1 }), field({ name: "b", type: "file", sort: 2 })];
    uploadResults = ["file-a", null];
    deleteOk = false;
    await submit([["a", file("a.pdf")], ["b", file("b.pdf")]]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("orphaned"), "file-a");
  });

  it("deletes uploaded files when the submission create fails", async () => {
    fields = [field({ name: "a", type: "file" })];
    submissionOk = false;
    const res = await submit([["a", file("a.pdf")]]);
    expect(res.status).toBe(502);
    expect(deletes().map((c) => c.path)).toEqual(["/files/file-a"]);
  });

  describe("choice fields", () => {
    const choices = [
      { text: "Alto", value: "alto" },
      { text: "Tenor", value: "tenor" },
    ];

    it.each(["select", "radio"] as const)("%s rejects a value outside choices", async (type) => {
      fields = [field({ name: "sax", type, choices })];
      const res = await submit([["sax", "bari"]]);
      expect(res.status).toBe(400);
      expect((await res.json()).field_errors.sax).toMatch(/valid option/);
    });

    it.each(["select", "radio"] as const)("%s accepts a listed value", async (type) => {
      fields = [field({ name: "sax", type, choices })];
      expect((await submit([["sax", "tenor"]])).status).toBe(200);
    });

    it("checkbox_group rejects any value outside choices", async () => {
      fields = [field({ name: "sax", type: "checkbox_group", choices })];
      const res = await submit([["sax", "alto"], ["sax", "bari"]]);
      expect(res.status).toBe(400);
      expect((await res.json()).field_errors.sax).toMatch(/valid option/);
    });

    it("checkbox_group accepts listed values", async () => {
      fields = [field({ name: "sax", type: "checkbox_group", choices })];
      expect((await submit([["sax", "alto"], ["sax", "tenor"]])).status).toBe(200);
    });

    it("leaves fields without choices unconstrained", async () => {
      fields = [field({ name: "sax", type: "select", choices: null })];
      expect((await submit([["sax", "anything"]])).status).toBe(200);
    });
  });

  it("encodes the form id in the forms lookup", async () => {
    const fd = new FormData();
    fd.set("form_id", "../users");
    const request = new Request("http://localhost/api/forms/submit", { method: "POST", body: fd });
    await (POST as (ctx: unknown) => Promise<Response>)({ request });
    expect(calls[0].path).toBe("/items/forms/..%2Fusers");
  });
});
