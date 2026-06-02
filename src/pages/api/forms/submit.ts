import type { APIRoute } from "astro";
import {
  fetchFormById,
  validateValue,
  FORM_QUARANTINE_FOLDER_ID,
  type FormField,
} from "@/lib/forms";

export const prerender = false;

const BASE_URL = import.meta.env.DIRECTUS_URL as string | undefined;
const TOKEN = import.meta.env.DIRECTUS_TOKEN as string | undefined;

type SubmissionValue = { field: string; value: string | null; file?: string };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function uploadFileToQuarantine(file: File, formTitle: string): Promise<string | null> {
  if (!BASE_URL || !TOKEN) return null;
  const upload = new FormData();
  upload.set("folder", FORM_QUARANTINE_FOLDER_ID);
  upload.set("title", `${formTitle} — ${file.name}`);
  upload.set("file", file, file.name);
  const res = await fetch(`${BASE_URL}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: upload,
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: { id?: string } };
  return j.data?.id ?? null;
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
  if (!BASE_URL || !TOKEN) return json(500, { error: "CMS not configured" });

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

  for (const field of form.fields) {
    if (field.type === "file") {
      const f = fd.get(field.name);
      if (!(f instanceof File) || f.size === 0) {
        if (field.required) fieldErrors[field.name] = "Please choose a file";
        continue;
      }
      const uploadedId = await uploadFileToQuarantine(f, form.title);
      if (!uploadedId) {
        fieldErrors[field.name] = "File upload failed. Please try again.";
        continue;
      }
      values.push({ field: field.id, value: f.name, file: uploadedId });
      continue;
    }

    const raw = readFieldValue(fd, field);
    const v = (raw ?? "").trim();

    if (field.required && (v === "" || v === "false")) {
      fieldErrors[field.name] = "This field is required";
      continue;
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

  if (Object.keys(fieldErrors).length > 0) {
    return json(400, { ok: false, error: "Please correct the highlighted fields", field_errors: fieldErrors });
  }

  const createRes = await fetch(`${BASE_URL}/items/form_submissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      form: form.id,
      timestamp: new Date().toISOString(),
      values,
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    console.error("form_submissions create failed", createRes.status, text);
    return json(502, { error: "Could not save your submission. Please try again." });
  }

  return json(200, {
    ok: true,
    on_success: form.on_success,
    success_message: form.success_message,
    success_redirect_url: form.success_redirect_url,
  });
};
