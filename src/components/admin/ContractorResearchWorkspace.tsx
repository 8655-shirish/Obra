import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  createContractorResearchTab,
  deleteContractorResearchSheet,
  getContractorResearchDossier,
  listContractorResearch,
  patchContractorResearchComment,
  renameContractorResearchSheet,
  startContractorResearch,
  uploadContractorResearchCsv,
  type ContractorResearchRowView,
  type ContractorResearchSheetView,
} from "@/lib/admin-contractor-research.functions";
import type { ResearchDossier } from "@/lib/admin/research-dossier";
import { listedWebsiteLine } from "@/lib/admin/research-dossier";

const POLL_MS = 3000;

export function ContractorResearchWorkspace() {
  const [sheets, setSheets] = useState<ContractorResearchSheetView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewRowId, setViewRowId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const next = await listContractorResearch();
    setSheets(next.sheets);
    setSelectedId((current) => {
      if (current && next.sheets.some((sheet) => sheet.id === current)) return current;
      return next.sheets.at(-1)?.id ?? null;
    });
    return next.sheets;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load sheets");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selected = sheets.find((sheet) => sheet.id === selectedId) ?? null;

  async function addTab() {
    setBusy(true);
    setError(null);
    try {
      const created = await createContractorResearchTab();
      await refresh();
      setSelectedId(created.sheetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create tab");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(file: File) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const csvText = await file.text();
      await uploadContractorResearchCsv({
        data: { sheetId: selected.id, filename: file.name, csvText },
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload CSV");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDeleteTab(sheet: ContractorResearchSheetView) {
    const unused = sheet.rows.length === 0 && !sheet.originalFilename;
    if (!unused && !window.confirm(`Delete “${sheet.title}”? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteContractorResearchSheet({ data: { sheetId: sheet.id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete tab");
    } finally {
      setBusy(false);
    }
  }

  async function onRename(sheetId: string, title: string) {
    try {
      const saved = await renameContractorResearchSheet({ data: { sheetId, title } });
      setSheets((current) =>
        current.map((sheet) => (sheet.id === sheetId ? { ...sheet, title: saved.title } : sheet)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rename tab");
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading contractor research…</p>;
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-1 overflow-x-auto border-b">
          {sheets.map((sheet) => (
            <ResearchTab
              key={sheet.id}
              sheet={sheet}
              selected={sheet.id === selectedId}
              disabled={busy}
              onSelect={() => setSelectedId(sheet.id)}
              onRename={onRename}
              onDelete={() => void onDeleteTab(sheet)}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mb-0.5 shrink-0"
            disabled={busy}
            onClick={() => void addTab()}
            aria-label="New tab"
          >
            <Plus />
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!selected ? (
          <p className="text-sm text-muted-foreground">
            Open a tab with +, then upload a CSLB contractor CSV.
          </p>
        ) : selected.rows.length === 0 ? (
          <EmptyTab disabled={busy} fileRef={fileRef} onFile={(file) => void onUpload(file)} />
        ) : (
          <ResearchGrid
            sheet={selected}
            busy={busy}
            onStart={async (rowId) => {
              setBusy(true);
              setError(null);
              try {
                await startContractorResearch({ data: { rowId } });
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Unable to start research");
              } finally {
                setBusy(false);
              }
            }}
            onComment={async (rowId, comment) => {
              try {
                await patchContractorResearchComment({ data: { rowId, comment } });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Unable to save comment");
                throw err;
              }
            }}
            onView={setViewRowId}
          />
        )}

        <p className="text-xs text-muted-foreground">
          Research shares the same job runner as Get my information — about 13 minutes per
          contractor when the queue is idle. There is no Start all.
        </p>
      </div>
      <ResearchViewDialog rowId={viewRowId} onClose={() => setViewRowId(null)} />
    </TooltipProvider>
  );
}

function ResearchTab({
  sheet,
  selected,
  disabled,
  onSelect,
  onRename,
  onDelete,
}: {
  sheet: ContractorResearchSheetView;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename: (sheetId: string, title: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(sheet.title);

  useEffect(() => {
    setTitle(sheet.title);
  }, [sheet.title]);

  return (
    <div
      className={`mb-[-1px] flex max-w-[16rem] items-center gap-1 rounded-t-md border border-b-0 px-2 py-1.5 text-sm ${
        selected
          ? "border-border bg-background"
          : "border-transparent bg-muted/60 text-muted-foreground"
      }`}
    >
      {editing ? (
        <input
          className="w-32 bg-transparent text-sm outline-none"
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() !== sheet.title) void onRename(sheet.id, title);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") {
              setTitle(sheet.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="truncate px-1 text-left"
          onClick={onSelect}
          onDoubleClick={() => {
            onSelect();
            setEditing(true);
          }}
        >
          {sheet.title}
        </button>
      )}
      <button
        type="button"
        className="rounded p-0.5 hover:bg-muted"
        disabled={disabled}
        aria-label={`Close ${sheet.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EmptyTab({
  disabled,
  fileRef,
  onFile,
}: {
  disabled: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">
        Upload a CSLB contractor list exported as CSV. Excel files are not accepted.
      </p>
      <Input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="mx-auto mt-4 max-w-sm"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

function ResearchGrid({
  sheet,
  busy,
  onStart,
  onComment,
  onView,
}: {
  sheet: ContractorResearchSheetView;
  busy: boolean;
  onStart: (rowId: string) => Promise<void>;
  onComment: (rowId: string, comment: string) => Promise<void>;
  onView: (rowId: string) => void;
}) {
  const headers = useMemo(() => sheet.headers, [sheet.headers]);

  return (
    <div className="overflow-auto rounded-md border">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            {headers.map((header) => (
              <th
                key={header}
                className="sticky top-0 z-10 whitespace-nowrap border-b bg-muted px-3 py-2 text-left font-medium"
              >
                {header}
              </th>
            ))}
            <th className="sticky top-0 z-10 whitespace-nowrap border-b bg-muted px-3 py-2 text-left font-medium">
              Research
            </th>
            <th className="sticky top-0 z-10 min-w-[14rem] whitespace-nowrap border-b bg-muted px-3 py-2 text-left font-medium">
              Comments
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row) => (
            <tr key={row.id} className="align-top">
              {headers.map((header) => (
                <td
                  key={header}
                  className="max-w-[16rem] truncate border-b px-3 py-2"
                  title={row.cells[header]}
                >
                  {row.cells[header] || ""}
                </td>
              ))}
              <td className="whitespace-nowrap border-b px-3 py-2">
                <ResearchCell row={row} busy={busy} onStart={onStart} onView={onView} />
              </td>
              <td className="border-b px-3 py-2">
                <CommentCell row={row} onSave={onComment} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResearchCell({
  row,
  busy,
  onStart,
  onView,
}: {
  row: ContractorResearchRowView;
  busy: boolean;
  onStart: (rowId: string) => Promise<void>;
  onView: (rowId: string) => void;
}) {
  if (row.hasActiveWork) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Researching…
      </span>
    );
  }

  const showView =
    row.poll === "complete" ||
    row.hasEnrichment ||
    row.researchStatus === "complete" ||
    row.researchStatus === "partial";
  const showRetry =
    row.poll === "failed" ||
    row.researchStatus === "partial" ||
    row.researchStatus === "failed" ||
    row.researchStatus === "no_results_found";

  if (showView || showRetry) {
    return (
      <span className="inline-flex items-center gap-2">
        {showView && (
          <Button type="button" size="sm" variant="outline" onClick={() => onView(row.id)}>
            View
          </Button>
        )}
        {showRetry && (
          <Button
            type="button"
            size="sm"
            disabled={busy || !row.identityOk}
            onClick={() => void onStart(row.id)}
          >
            Retry
          </Button>
        )}
      </span>
    );
  }

  const startButton = (
    <Button
      type="button"
      size="sm"
      disabled={busy || !row.identityOk}
      onClick={() => void onStart(row.id)}
    >
      Start
    </Button>
  );
  if (row.identityOk) return startButton;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{startButton}</span>
      </TooltipTrigger>
      <TooltipContent>
        {row.identityReason ?? "Business name and license are required"}
      </TooltipContent>
    </Tooltip>
  );
}

function CommentCell({
  row,
  onSave,
}: {
  row: ContractorResearchRowView;
  onSave: (rowId: string, comment: string) => Promise<void>;
}) {
  const [value, setValue] = useState(row.comment);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setValue(row.comment);
  }, [row.comment]);

  return (
    <div>
      <Textarea
        value={value}
        maxLength={2000}
        rows={2}
        className="min-h-[2.5rem] resize-y"
        onChange={(event) => {
          setValue(event.target.value);
          setSaveError(false);
        }}
        onBlur={async () => {
          if (value === row.comment) return;
          try {
            await onSave(row.id, value);
          } catch {
            setSaveError(true);
          }
        }}
      />
      {saveError && <p className="mt-1 text-xs text-destructive">Comment did not save.</p>}
    </div>
  );
}

function ResearchViewDialog({ rowId, onClose }: { rowId: string | null; onClose: () => void }) {
  const [dossier, setDossier] = useState<ResearchDossier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rowId) {
      setDossier(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setDossier(null);
    getContractorResearchDossier({ data: { rowId } })
      .then((next) => {
        if (!cancelled) setDossier(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load research");
      });
    return () => {
      cancelled = true;
    };
  }, [rowId]);

  return (
    <Dialog open={Boolean(rowId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dossier?.identity.businessName ?? "Contractor research"}</DialogTitle>
          <DialogDescription>
            {dossier
              ? [dossier.identity.licenseNumber, dossier.identity.city].filter(Boolean).join(" · ")
              : "Firecrawl listings, photos, and website/social for this row."}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !dossier && <p className="text-sm text-muted-foreground">Loading…</p>}
        {dossier && <DossierBody dossier={dossier} />}
      </DialogContent>
    </Dialog>
  );
}

function DossierBody({ dossier }: { dossier: ResearchDossier }) {
  return (
    <div className="space-y-6 text-sm">
      <section>
        <h3 className="mb-1 font-medium">Identity</h3>
        <p>
          {dossier.identity.address || "No address on file"}
          {dossier.identity.phone ? ` · ${dossier.identity.phone}` : ""}
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-medium">Photos</h3>
        {dossier.images.length === 0 ? (
          <p className="text-muted-foreground">No photos in the scrape.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {dossier.images.map((image) => (
              <img
                key={image.displayUrl}
                src={image.displayUrl}
                alt={image.alt ?? image.platform ?? "Contractor photo"}
                className="h-32 w-full rounded-md object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 font-medium">Existing website</h3>
        <p>{listedWebsiteLine(dossier.listedWebsite)}</p>
        {dossier.listedWebsite.hosts.map((host) => (
          <p key={host.url}>
            <a href={host.url} className="text-primary underline" target="_blank" rel="noreferrer">
              {host.url}
            </a>
          </p>
        ))}
      </section>

      <section>
        <h3 className="mb-1 font-medium">Social pages</h3>
        {dossier.social.length === 0 ? (
          <p className="text-muted-foreground">No Facebook or Instagram pages found.</p>
        ) : (
          <ul className="space-y-1">
            {dossier.social.map((link) => (
              <li key={link.url}>
                {link.platform}:{" "}
                <a
                  href={link.url}
                  className="text-primary underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1 font-medium">Reviews</h3>
        {dossier.reviews.length === 0 ? (
          <p className="text-muted-foreground">No matched reviews.</p>
        ) : (
          <ul className="space-y-2">
            {dossier.reviews.map((review, index) => (
              <li key={`${review.quote}-${index}`}>
                “{review.quote}”{review.author ? ` — ${review.author}` : ""}
                {review.source ? ` (${review.source})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1 font-medium">Listings</h3>
        <ul className="space-y-1">
          {dossier.platforms.map((card) => (
            <li key={card.platform}>
              <span className="font-medium">{card.platform}</span> · {card.status}
              {card.listingUrl ? (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href={card.listingUrl}
                    className="text-primary underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    listing
                  </a>
                </>
              ) : null}
              {card.rating ? ` · ${card.rating}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-1 font-medium">Unmatched hits</h3>
        {dossier.unmatchedHits.length === 0 ? (
          <p className="text-muted-foreground">No unmatched listings.</p>
        ) : (
          <ul className="space-y-1">
            {dossier.unmatchedHits.map((hit, index) => (
              <li key={`${hit.platform}-${hit.url ?? hit.businessName ?? index}`}>
                <span className="font-medium">{hit.platform}</span>
                {hit.businessName ? ` · ${hit.businessName}` : ""}
                {hit.url ? (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={hit.url}
                      className="text-primary underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {hit.url}
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
