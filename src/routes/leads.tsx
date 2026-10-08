import { Inbox, Mail, Phone } from "lucide-react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { ObraLogoLink } from "@/components/ObraLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { contractorLoginRedirect } from "@/lib/auth/contractor-return-path";
import { getLeadsPage } from "@/lib/leads.functions";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "Website Leads | Obra" }, ...NOINDEX_META] }),
  beforeLoad: async () => {
    try {
      return { initialPage: await getLeadsPage({ data: {} }) };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "Unauthorized" || error.message === "Forbidden")
      ) {
        throw redirect(contractorLoginRedirect("/leads"));
      }
      throw error;
    }
  },
  errorComponent: ({ reset }) => (
    <main className="min-h-screen bg-background px-4 py-10">
      <div
        className="mx-auto max-w-5xl rounded-lg border border-destructive/40 bg-destructive/5 p-5"
        role="alert"
      >
        <h1 className="font-semibold">Website leads could not be loaded</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Please retry. Your saved leads have not been changed.
        </p>
        <Button className="mt-3" variant="outline" onClick={reset}>
          Retry
        </Button>
      </div>
    </main>
  ),
  loader: ({ context }) => context.initialPage,
  pendingComponent: () => <LeadsStatus message="Loading website leads…" />,
  component: LeadsPage,
});

type LeadRow = Awaited<ReturnType<typeof getLeadsPage>>["leads"][number];
type DisplayField = { id: string; label: string; required: boolean; value: string | null };

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function textValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}
function fieldsFor(lead: LeadRow): DisplayField[] {
  const data = asObject(lead.form_data);
  if (Array.isArray(lead.field_snapshot)) {
    const fields = lead.field_snapshot.flatMap((item) => {
      const row = asObject(item);
      const id = textValue(row.id);
      const label = textValue(row.label);
      if (!id || !label) return [];
      return [
        {
          id,
          label,
          required: row.required === true,
          value: textValue(row.value) ?? textValue(data[id]),
        },
      ];
    });
    if (fields.length) return fields;
  }
  return Object.entries(data)
    .slice(0, 20)
    .map(([id, value]) => ({
      id,
      label: id.replace(/[_-]+/g, " "),
      required: false,
      value: textValue(value),
    }));
}
function namedValue(fields: DisplayField[], id: string) {
  return fields.find((field) => field.id.toLowerCase() === id)?.value ?? null;
}
function sourceFor(lead: LeadRow) {
  const source = asObject(lead.source_snapshot);
  return {
    name: textValue(source.name) ?? "Website",
    domain: textValue(source.domain),
    path: textValue(source.path),
  };
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
function validEmail(value: string | null): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}
function validPhone(value: string | null): value is string {
  return Boolean(value && /^[+()0-9 .-]{7,30}$/.test(value));
}

function LeadsStatus({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <p className="mx-auto max-w-5xl text-sm text-muted-foreground" role="status">
        {message}
      </p>
    </main>
  );
}

function LeadsPage() {
  const initial = Route.useLoaderData();
  const [leads, setLeads] = useState(initial.leads);
  const [cursor, setCursor] = useState(initial.cursor);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await getLeadsPage({ data: { cursor } });
      setLeads((current) => [...current, ...page.leads]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch {
      setError("We couldn't load more leads. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  const detailFields = selected ? fieldsFor(selected) : [];
  const detailEmail = namedValue(detailFields, "email");
  const detailPhone = namedValue(detailFields, "phone");
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <ObraLogoLink to="/" size={30} showWordmark />
            <div className="mt-6 flex items-center gap-3">
              <Inbox className="h-7 w-7 text-primary" />
              <h1 className="text-3xl font-bold">Website Leads</h1>
            </div>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Quote requests from all of your published websites, newest first.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/user/$userId" params={{ userId: initial.profileId }}>
              Back to workspace
            </Link>
          </Button>
        </header>
        {!initial.collectionEnabled ? (
          <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            New lead collection is not currently enabled, but your previous requests remain
            available.
          </div>
        ) : null}
        {leads.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No website leads yet</CardTitle>
              <CardDescription>
                {initial.collectionEnabled
                  ? "New quote requests will appear here after visitors submit your published Starter website form."
                  : "No new requests can be collected until an eligible published Starter website has a visible contact form."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {leads.map((lead) => {
              const fields = fieldsFor(lead);
              const source = sourceFor(lead);
              const name = namedValue(fields, "name") ?? "Name not supplied";
              const email = namedValue(fields, "email");
              const phone = namedValue(fields, "phone");
              const message = namedValue(fields, "message");
              return (
                <Card key={lead.id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-lg">{name}</CardTitle>
                    <CardDescription>
                      {formatDate(lead.submitted_at)} · {source.name}
                      {source.domain ? ` · ${source.domain}` : ""}
                      {source.path ? ` · ${source.path}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <dl className="space-y-2 text-sm">
                      <div>
                        <dt className="font-medium">Email</dt>
                        <dd className="break-all text-muted-foreground">
                          {email ?? "Not supplied"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium">Phone</dt>
                        <dd className="text-muted-foreground">{phone ?? "Not supplied"}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Project details</dt>
                        <dd className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                          {message ?? "Not supplied"}
                        </dd>
                      </div>
                    </dl>
                    <Button
                      className="mt-auto self-start"
                      variant="outline"
                      onClick={() => setSelected(lead)}
                    >
                      View details
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {error ? (
          <div
            className="mt-5 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
            role="alert"
          >
            <p>{error}</p>
            <Button className="mt-2" size="sm" variant="outline" onClick={() => void loadMore()}>
              Retry
            </Button>
          </div>
        ) : null}
        {hasMore ? (
          <div className="mt-6 text-center">
            <Button onClick={() => void loadMore()} disabled={loading}>
              {loading ? "Loading…" : "Load more leads"}
            </Button>
          </div>
        ) : null}
      </div>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{namedValue(detailFields, "name") ?? "Lead details"}</DialogTitle>
                <DialogDescription>
                  {selected.snapshot_status === "captured"
                    ? `Received ${formatDate(selected.submitted_at)} from ${sourceFor(selected).name}${sourceFor(selected).domain ? ` (${sourceFor(selected).domain})` : ""}.`
                    : `Received ${formatDate(selected.submitted_at)}. Original field labels and source details are unavailable for this legacy lead.`}
                </DialogDescription>
              </DialogHeader>
              {validEmail(detailEmail) || validPhone(detailPhone) ? (
                <div className="flex flex-wrap gap-2">
                  {validEmail(detailEmail) ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`mailto:${detailEmail}`}>
                        <Mail className="mr-2 h-4 w-4" />
                        Email
                      </a>
                    </Button>
                  ) : null}
                  {validPhone(detailPhone) ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`tel:${detailPhone.replace(/[^+0-9]/g, "")}`}>
                        <Phone className="mr-2 h-4 w-4" />
                        Call
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <dl className="divide-y rounded-lg border">
                {detailFields.map((field) => (
                  <div
                    key={field.id}
                    className="grid gap-1 p-4 sm:grid-cols-[minmax(120px,1fr)_2fr]"
                  >
                    <dt className="font-medium">
                      {field.label}
                      {field.required ? <span className="sr-only"> (required)</span> : null}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                      {field.value ?? "Not supplied"}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
