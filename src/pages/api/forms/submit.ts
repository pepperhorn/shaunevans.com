import type { APIRoute } from "astro";
import {
  fetchFormById,
  validateValue,
  FORM_QUARANTINE_FOLDER_ID,
  type FormField,
} from "@/lib/forms";
import { serverEnv } from "@/lib/env";

export const prerender = false;

/** Per-file cap. The node adapter's `bodySizeLimit` (astro.config.mjs) caps the whole request. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type SubmissionValue = { field: string; value: string | null; file?: string };
type Cms = { baseUrl: string; token: string };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fieldErrorResponse(fieldErrors: Record<string, string>): Response {
  return json(400, { ok: false, error: "Please correct the highlighted fields", field_errors: fieldErrors });
}

async function uploadFileToQuarantine(cms: Cms, file: File, formTitle: string): Promise<string | null> {
  const upload = new FormData();
  upload.set("folder", FORM_QUARANTINE_FOLDER_ID);
  upload.set("title", `${formTitle} — ${file.name}`);
  upload.set("file", file, file.name);
  try {
    const res = await fetch(`${cms.baseUrl}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cms.token}` },
      body: upload,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { id?: string } };
    return j.data?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort removal of files uploaded for a submission that then failed.
 * The DIRECTUS_TOKEN role may lack delete on directus_files; anything not
 * deleted is logged so an operator can clear it from Form Quarantine.
 */
async function discardUploads(cms: Cms, ids: string[]): Promise<void> {
  const orphaned: string[] = [];
  for (const id of ids) {
    try {
      const res = await fetch(`${cms.baseUrl}/files/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${cms.token}` },
      });
      if (!res.ok) orphaned.push(id);
    } catch {
      orphaned.push(id);
    }
  }
  if (orphaned.length > 0) {
    console.error("[forms] could not delete orphaned quarantine uploads:", orphaned.join(", "));
  }
}

/** Selected values for a choice field, or null when the field is not choice-constrained. */
function selectedChoices(fd: FormData, field: FormField, v: string): string[] | null {
  if (!field.choices || field.choices.length === 0) return null;
  if (field.type === "checkbox_group") {
    return fd.getAll(field.name).filter((x): x is string => typeof x === "string" && x !== "");
  }
  if (field.type === "select" || field.type === "radio") return v === "" ? [] : [v];
  return null;
}

function readFieldValue(fd: FormData, field: FormField): string | null {
  if (field.type === "checkbox") {
    const v = fd.get(field.name);
    return v ? "true" : "false";
  }
  if (field.type === "checkbox_group") {
    const values = fd
      .getAll(field.name)
      .filter((x): x is string => typeof x === "string" && x !== "");
    return values.length > 0 ? JSON.stringify(values) : null;
  }
  const v = fd.get(field.name);
  if (typeof v !== "string") return null;
  return v;
}

export const POST: APIRoute = async ({ request }) => {
  const baseUrl = serverEnv("DIRECTUS_URL");
  const token = serverEnv("DIRECTUS_TOKEN");
  if (!baseUrl || !token) return json(500, { error: "CMS not configured" });
  const cms: Cms = { baseUrl, token };

  let fd: FormData;
  try {
    fd = await request.formData();
  } catch {
    return json(400, { error: "Invalid request body" });
  }

  const formId = fd.get("form_id");
  if (typeof formId !== "string" || formId === "") {
    return json(400, { error: "Missing form_id" });
  }

  // Honeypot: silently succeed so the bot doesn't retry. No DB write.
  const hp = fd.get("hp_field");
  if (typeof hp === "string" && hp.trim() !== "") {
    return json(200, { ok: true, on_success: "message", success_message: "Thanks." });
  }

  const form = await fetchFormById(formId);
  if (!form) return json(404, { error: "Form not found" });
  if (!form.is_active) return json(400, { error: "This form is no longer accepting submissions" });

  const fieldErrors: Record<string, string> = {};
  const values: SubmissionValue[] = [];
  const pendingFiles: Array<{ field: FormField; file: File }> = [];

  // Pass 1: validate everything. Nothing is written to Directus until the
  // whole submission passes, so a bad text field never strands an upload.
  for (const field of form.fields) {
    if (field.type === "file") {
      const f = fd.get(field.name);
      if (!(f instanceof File) || f.size === 0) {
        if (field.required) fieldErrors[field.name] = "Please choose a file";
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        fieldErrors[field.name] = `File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`;
        continue;
      }
      pendingFiles.push({ field, file: f });
      continue;
    }

    const raw = readFieldValue(fd, field);
    const v = (raw ?? "").trim();

    if (field.required && (v === "" || v === "false")) {
      fieldErrors[field.name] = "This field is required";
      continue;
    }

    const selected = selectedChoices(fd, field, v);
    if (selected) {
      const allowed = new Set((field.choices ?? []).map((c) => c.value));
      if (selected.some((x) => !allowed.has(x))) {
        fieldErrors[field.name] = "Please choose a valid option";
        continue;
      }
    }

    if (v !== "" && field.type !== "checkbox" && field.type !== "checkbox_group") {
      const err = validateValue(v, field.validation);
      if (err) {
        fieldErrors[field.name] = err;
        continue;
      }
    }

    values.push({ field: field.id, value: raw });
  }

  if (Object.keys(fieldErrors).length > 0) return fieldErrorResponse(fieldErrors);

  // Pass 2: upload files. On the first failure, discard what already landed.
  const uploadedIds: string[] = [];
  for (const { field, file } of pendingFiles) {
    const uploadedId = await uploadFileToQuarantine(cms, file, form.title);
    if (!uploadedId) {
      await discardUploads(cms, uploadedIds);
      return fieldErrorResponse({ [field.name]: "File upload failed. Please try again." });
    }
    uploadedIds.push(uploadedId);
    values.push({ field: field.id, value: file.name, file: uploadedId });
  }

  const createRes = await fetch(`${cms.baseUrl}/items/form_submissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cms.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      form: form.id,
      timestamp: new Date().toISOString(),
      values,
    }),
  }).catch(() => null);

  if (!createRes || !createRes.ok) {
    const text = createRes ? await createRes.text().catch(() => "") : "network error";
    console.error("form_submissions create failed", createRes?.status, text);
    await discardUploads(cms, uploadedIds);
    return json(502, { error: "Could not save your submission. Please try again." });
  }

  return json(200, {
    ok: true,
    on_success: form.on_success,
    success_message: form.success_message,
    success_redirect_url: form.success_redirect_url,
  });
};
