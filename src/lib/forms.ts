/**
 * Form definitions sourced from the Directus `forms` collection
 * (Directus template's dynamic form builder). Used by:
 *   - CmsPageRenderer / block_form (read path) — form data is embedded
 *     in the page query, so reading from there is free.
 *   - /api/forms/submit (write path) — re-fetches the form server-side
 *     to re-validate input the browser sent (never trust the client).
 */

const BASE_URL = import.meta.env.DIRECTUS_URL as string | undefined;
const TOKEN = import.meta.env.DIRECTUS_TOKEN as string | undefined;

export const FORM_QUARANTINE_FOLDER_ID = "ff3972b6-aceb-4512-a644-8c3119190a02";

export type FormFieldType =
  | "text"
  | "textarea"
  | "checkbox"
  | "checkbox_group"
  | "radio"
  | "select"
  | "file"
  | "hidden";

export type FormFieldChoice = { text: string; value: string };

export type FormField = {
  id: string;
  name: string;
  type: FormFieldType;
  label: string;
  placeholder: string | null;
  help: string | null;
  validation: string | null;
  width: "100" | "67" | "50" | "33" | null;
  choices: FormFieldChoice[] | null;
  required: boolean;
  sort: number | null;
};

export type FormDefinition = {
  id: string;
  title: string;
  submit_label: string | null;
  on_success: "redirect" | "message";
  success_message: string | null;
  success_redirect_url: string | null;
  is_active: boolean;
  fields: FormField[];
};

const FORM_FIELDS = [
  "id",
  "title",
  "submit_label",
  "on_success",
  "success_message",
  "success_redirect_url",
  "is_active",
  "fields.id",
  "fields.name",
  "fields.type",
  "fields.label",
  "fields.placeholder",
  "fields.help",
  "fields.validation",
  "fields.width",
  "fields.choices",
  "fields.required",
  "fields.sort",
].join(",");

export async function fetchFormById(id: string): Promise<FormDefinition | null> {
  if (!BASE_URL || !TOKEN) throw new Error("DIRECTUS_URL or DIRECTUS_TOKEN not set");
  const url = new URL(`${BASE_URL}/items/forms/${id}`);
  url.searchParams.set("fields[]", FORM_FIELDS);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data: FormDefinition | null };
  const f = json.data;
  if (!f) return null;
  // Sort fields by their sort field (Directus does not always pre-sort O2M responses).
  f.fields = (f.fields ?? []).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return f;
}

/**
 * Run a single validation rule string (e.g. "email|max:255") against a value.
 * Returns null on pass, a human-readable error message on fail.
 * Empty values pass everything except `required` (handled separately).
 */
export function validateValue(value: string, rules: string | null): string | null {
  if (!rules) return null;
  if (value === "") return null;
  for (const raw of rules.split("|")) {
    const [name, arg] = raw.trim().split(":");
    if (name === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Please enter a valid email address";
    } else if (name === "url") {
      try {
        new URL(value);
      } catch {
        return "Please enter a valid URL";
      }
    } else if (name === "min") {
      const n = Number(arg);
      if (!Number.isNaN(n) && value.length < n) return `Must be at least ${n} characters`;
    } else if (name === "max") {
      const n = Number(arg);
      if (!Number.isNaN(n) && value.length > n) return `Must be no more than ${n} characters`;
    } else if (name === "length") {
      const n = Number(arg);
      if (!Number.isNaN(n) && value.length !== n) return `Must be exactly ${n} characters`;
    }
  }
  return null;
}
