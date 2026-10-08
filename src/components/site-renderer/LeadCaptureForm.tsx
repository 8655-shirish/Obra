import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitLead } from "@/lib/leads.functions";

type LeadField = { id: string; label: string; required: boolean };

const DEFAULT_FIELDS: LeadField[] = [
  { id: "name", label: "Name", required: true },
  { id: "email", label: "Email", required: true },
  { id: "phone", label: "Phone", required: false },
  { id: "message", label: "Project details", required: true },
];

function leadFieldAttrs(field: LeadField): {
  autoComplete: string;
  spellCheck?: boolean;
  inputMode?: "email" | "tel" | "text";
  placeholder?: string;
} {
  const id = field.id.toLowerCase();
  if (id === "email" || field.label.toLowerCase().includes("email")) {
    return {
      autoComplete: "email",
      spellCheck: false,
      inputMode: "email",
      placeholder: "e.g. name@example.com…",
    };
  }
  if (id === "phone" || field.label.toLowerCase().includes("phone")) {
    return {
      autoComplete: "tel",
      spellCheck: false,
      inputMode: "tel",
      placeholder: "e.g. (555) 123-4567…",
    };
  }
  if (id === "name" || field.label.toLowerCase() === "name") {
    return { autoComplete: "name", placeholder: "Your name…" };
  }
  if (id === "message" || field.label.toLowerCase().includes("detail")) {
    return {
      autoComplete: "off",
      placeholder: "e.g. Scope, timeline, notes…",
    };
  }
  return { autoComplete: "off" };
}

const THANKS_COPY = "Thanks — we received your request and will follow up shortly.";

function leadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Unable to submit. Try again.";
}

export function LeadCaptureForm({
  websiteId,
  fields,
}: {
  websiteId: string;
  fields?: LeadField[];
}) {
  const formFields = fields && fields.length > 0 ? fields : DEFAULT_FIELDS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const submissionIdRef = useRef(crypto.randomUUID());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    try {
      await submitLead({
        data: {
          websiteId,
          formData: values,
          submissionId: submissionIdRef.current,
          companyWebsite,
        },
      });
      setStatus("success");
      setValues({});
      submissionIdRef.current = crypto.randomUUID();
    } catch (err) {
      setStatus("error");
      setError(leadErrorMessage(err));
    }
  }

  const liveMessage =
    status === "loading" ? "Sending…" : status === "success" ? THANKS_COPY : (error ?? "");

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>
      {status === "success" ? (
        <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm">{THANKS_COPY}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-lg font-semibold">Request a quote</h3>
          <input
            type="text"
            name="companyWebsite"
            tabIndex={-1}
            autoComplete="off"
            value={companyWebsite}
            onChange={(event) => setCompanyWebsite(event.target.value)}
            aria-hidden="true"
            className="absolute -left-[10000px] h-px w-px overflow-hidden"
          />
          {formFields.map((field) => {
            const attrs = leadFieldAttrs(field);
            const isLong = field.id === "message" || field.label.toLowerCase().includes("detail");
            return (
              <div key={field.id} className="space-y-1">
                <Label htmlFor={`lead-${field.id}`}>{field.label}</Label>
                {isLong ? (
                  <textarea
                    id={`lead-${field.id}`}
                    name={field.id}
                    autoComplete={attrs.autoComplete}
                    placeholder={attrs.placeholder}
                    className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={values[field.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                    required={field.required}
                  />
                ) : (
                  <Input
                    id={`lead-${field.id}`}
                    name={field.id}
                    type={field.id === "email" ? "email" : field.id === "phone" ? "tel" : "text"}
                    autoComplete={attrs.autoComplete}
                    spellCheck={attrs.spellCheck}
                    inputMode={attrs.inputMode}
                    placeholder={attrs.placeholder}
                    value={values[field.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                    required={field.required}
                  />
                )}
              </div>
            );
          })}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Sending…" : "Get a Quote"}
          </Button>
        </form>
      )}
    </div>
  );
}
