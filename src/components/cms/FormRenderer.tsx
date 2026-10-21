import { useState } from "react";
import type { FormDefinition, FormField } from "@/lib/forms";
import { validateValue } from "@/lib/forms";

type Props = {
  form: FormDefinition;
  headline?: string;
  tagline?: string;
};

function widthClass(w: FormField["width"]): string {
  switch (w) {
    case "33":
      return "md:col-span-4";
    case "50":
      return "md:col-span-6";
    case "67":
      return "md:col-span-8";
    default:
      return "md:col-span-12";
  }
}

export default function FormRenderer({ form, headline, tagline }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!form.is_active) {
    return (
      <div className="form-inactive mx-auto max-w-2xl px-4 py-8 text-center text-sm text-gray-500">
        This form is currently unavailable.
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    const formEl = e.currentTarget;
    const fd = new FormData(formEl);

    // Client-side validation (server re-validates).
    const next: Record<string, string> = {};
    for (const field of form.fields) {
      if (field.type === "file" || field.type === "checkbox" || field.type === "checkbox_group") continue;
      const v = (fd.get(field.name) as string | null) ?? "";
      if (field.required && v.trim() === "") {
        next[field.name] = "This field is required";
        continue;
      }
      const err = validateValue(v, field.validation);
      if (err) next[field.name] = err;
    }
    for (const field of form.fields) {
      if (field.type === "checkbox_group") {
        const values = fd.getAll(field.name).filter((x) => typeof x === "string" && x !== "");
        if (field.required && values.length === 0) next[field.name] = "Select at least one";
      } else if (field.type === "checkbox") {
        const v = fd.get(field.name);
        if (field.required && !v) next[field.name] = "This is required";
      } else if (field.type === "file") {
        const f = fd.get(field.name) as File | null;
        if (field.required && (!f || f.size === 0)) next[field.name] = "Please choose a file";
      }
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    fd.set("form_id", form.id);

    setSubmitting(true);
    try {
      const res = await fetch("/api/forms/submit", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        on_success?: "redirect" | "message";
        success_message?: string | null;
        success_redirect_url?: string | null;
        error?: string;
        field_errors?: Record<string, string>;
      };
      if (!res.ok || !json.ok) {
        if (json.field_errors) setErrors(json.field_errors);
        setServerError(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (json.on_success === "redirect" && json.success_redirect_url) {
        window.location.href = json.success_redirect_url;
        return;
      }
      setSuccessMessage(json.success_message ?? "Thanks — we got it.");
      formEl.reset();
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (successMessage) {
    return (
      <div className="form-success mx-auto max-w-2xl px-4 py-12 text-center">
        {tagline && (
          <p className="cms-tagline font-overpass-mono uppercase text-sm text-gray-500 dark:text-gray-400 mb-2">
            {tagline}
          </p>
        )}
        {headline && (
          <h2 className="cms-headline font-overpass-mono text-3xl sm:text-4xl mb-4">{headline}</h2>
        )}
        <div className="form-success-message prose dark:prose-invert mx-auto max-w-none">
          <p>{successMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cms-form mx-auto max-w-3xl px-4 py-8">
      {tagline && (
        <p className="cms-tagline font-overpass-mono uppercase text-sm text-gray-500 dark:text-gray-400 mb-2 text-center">
          {tagline}
        </p>
      )}
      {headline && (
        <h2 className="cms-headline font-overpass-mono text-3xl sm:text-4xl mb-6 text-center">
          {headline}
        </h2>
      )}
      <form onSubmit={onSubmit} noValidate className="form-fields grid grid-cols-12 gap-4">
        {/* Honeypot — bots fill anything visible. Real users won't see this. */}
        <div className="hp-trap" aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px", overflow: "hidden" }}>
          <label>
            Leave this field empty
            <input type="text" name="hp_field" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        {form.fields.map((field) => {
          const fieldErr = errors[field.name];
          const id = `form-${form.id}-${field.name}`;
          if (field.type === "hidden") {
            return (
              <input
                key={field.id}
                type="hidden"
                name={field.name}
                defaultValue={field.placeholder ?? ""}
              />
            );
          }
          const wrap = `form-field col-span-12 ${widthClass(field.width)}`;
          const inputBase =
            "w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-[rgb(40,39,43)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";
          return (
            <div key={field.id} className={wrap}>
              {field.type !== "checkbox" && (
                <label htmlFor={id} className="form-label block text-sm font-medium mb-1">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
              )}

              {field.type === "text" && (
                <input
                  id={id}
                  type="text"
                  name={field.name}
                  placeholder={field.placeholder ?? undefined}
                  required={field.required}
                  className={inputBase}
                />
              )}

              {field.type === "textarea" && (
                <textarea
                  id={id}
                  name={field.name}
                  placeholder={field.placeholder ?? undefined}
                  required={field.required}
                  rows={5}
                  className={inputBase}
                />
              )}

              {field.type === "select" && (
                <select id={id} name={field.name} required={field.required} className={inputBase} defaultValue="">
                  <option value="" disabled>
                    {field.placeholder ?? "Choose an option"}
                  </option>
                  {(field.choices ?? []).map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.text}
                    </option>
                  ))}
                </select>
              )}

              {field.type === "radio" && (
                <div className="form-radio-group flex flex-col gap-2">
                  {(field.choices ?? []).map((c) => (
                    <label key={c.value} className="form-radio inline-flex items-center gap-2 text-sm">
                      <input type="radio" name={field.name} value={c.value} required={field.required} />
                      {c.text}
                    </label>
                  ))}
                </div>
              )}

              {field.type === "checkbox_group" && (
                <div className="form-checkbox-group flex flex-col gap-2">
                  {(field.choices ?? []).map((c) => (
                    <label key={c.value} className="form-checkbox inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" name={field.name} value={c.value} />
                      {c.text}
                    </label>
                  ))}
                </div>
              )}

              {field.type === "checkbox" && (
                <label htmlFor={id} className="form-checkbox-single inline-flex items-start gap-2 text-sm">
                  <input
                    id={id}
                    type="checkbox"
                    name={field.name}
                    value="true"
                    required={field.required}
                    className="mt-1"
                  />
                  <span>
                    {field.label}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </span>
                </label>
              )}

              {field.type === "file" && (
                <input
                  id={id}
                  type="file"
                  name={field.name}
                  required={field.required}
                  className="form-file block w-full text-sm"
                />
              )}

              {field.help && <p className="form-help text-xs text-gray-500 mt-1">{field.help}</p>}
              {fieldErr && <p className="form-error text-xs text-red-600 mt-1">{fieldErr}</p>}
            </div>
          );
        })}

        {serverError && (
          <div className="form-server-error col-span-12 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </div>
        )}

        <div className="form-actions col-span-12 mt-2">
          <button
            type="submit"
            disabled={submitting}
            className="btn-form-submit inline-flex items-center justify-center rounded-full bg-foreground px-6 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Sending…" : form.submit_label || "Submit"}
          </button>
        </div>
      </form>
    </div>
  );
}
