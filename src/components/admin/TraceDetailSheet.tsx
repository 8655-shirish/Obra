import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  abandonAgentExternalOperation,
  getAgentTraceDetail,
  recoverAgentTrace,
} from "@/lib/admin-traces.functions";

import { ExpandableCell } from "./ExpandableCell";

type TraceDetail = Awaited<ReturnType<typeof getAgentTraceDetail>>;

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TraceDetailSheet({
  traceId,
  onClose,
}: {
  traceId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function refreshDetail(id: string) {
    const nextDetail = await getAgentTraceDetail({ data: { traceId: id } });
    setDetail(nextDetail);
    return nextDetail;
  }

  useEffect(() => {
    if (!traceId) {
      setDetail(null);
      setReason("");
      setActionError(null);
      return;
    }
    setLoading(true);
    refreshDetail(traceId).finally(() => setLoading(false));
  }, [traceId]);

  const runningOperations =
    detail?.externalOperations.filter((operation) => operation.status === "running") ?? [];
  const hasReason = reason.trim().length > 0;

  async function abandonOperation(operation: TraceDetail["externalOperations"][number]) {
    if (!detail || !hasReason) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await abandonAgentExternalOperation({
        data: {
          operationKey: operation.operationKey,
          expectedTraceId: detail.trace.id,
          expectedOwnerToken: operation.ownerToken,
          reason,
        },
      });
      await refreshDetail(detail.trace.id);
      if (!result.abandoned) {
        setActionError(
          "The operation state changed before it could be abandoned. Detail refreshed.",
        );
      } else {
        setReason("");
      }
    } catch {
      setActionError("Unable to abandon the external operation. Detail may have changed.");
      await refreshDetail(detail.trace.id).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function recoverTrace(status: "error" | "cancelled") {
    if (!detail || !hasReason || runningOperations.length > 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await recoverAgentTrace({
        data: {
          traceId: detail.trace.id,
          expectedOwnerToken: detail.trace.ownerToken,
          status,
          reason,
        },
      });
      if (result.recovered) {
        await refreshDetail(detail.trace.id);
        onClose();
      } else {
        await refreshDetail(detail.trace.id);
        setActionError("The trace state changed before it could be recovered. Detail refreshed.");
      }
    } catch {
      setActionError("Unable to recover the trace. Detail may have changed.");
      await refreshDetail(detail.trace.id).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={Boolean(traceId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Trace detail</SheetTitle>
        </SheetHeader>

        {loading || !detail ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {detail.profile?.businessName ?? "Unknown business"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    License {detail.profile?.licenseNumber ?? "—"} ·{" "}
                    {detail.profile?.trade ?? "trade pending"}
                    {detail.profile?.city ? ` · ${detail.profile.city}` : ""}
                  </p>
                </div>
                <Badge
                  variant={
                    detail.trace.status === "completed"
                      ? "default"
                      : detail.trace.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {detail.trace.status}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>Intent: {detail.trace.intentType ?? "chat"}</span>
                <span>Tool calls: {detail.trace.toolCallCount}</span>
                <span>Rounds: {detail.trace.roundCount}</span>
                <span>Website: {detail.website.status}</span>
                {detail.website.liveUrl ? (
                  <a
                    href={detail.website.liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {detail.website.liveUrl}
                  </a>
                ) : (
                  <span>No live site developed yet</span>
                )}
              </div>
              {detail.trace.errorMessage && (
                <p className="mt-2 text-xs text-destructive">{detail.trace.errorMessage}</p>
              )}
            </div>

            {detail.trace.status === "running" && (
              <section
                aria-labelledby="trace-recovery-heading"
                className="space-y-3 rounded-lg border border-destructive/40 p-4"
              >
                <div>
                  <h3 id="trace-recovery-heading" className="text-sm font-semibold">
                    Explicit agent recovery
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Trace <span className="font-mono">{detail.trace.id}</span> · owner{" "}
                    <span className="font-mono">{detail.trace.ownerToken ?? "null"}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Heartbeat {detail.trace.heartbeatAt ?? "—"} · lease expires{" "}
                    {detail.trace.leaseExpiresAt ?? "—"}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium">
                    External operations ({detail.externalOperations.length})
                  </p>
                  {detail.externalOperations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No external operations recorded.
                    </p>
                  ) : (
                    detail.externalOperations.map((operation) => (
                      <div
                        key={operation.operationKey}
                        className="rounded-md border border-border p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono break-all">{operation.operationKey}</span>
                          <Badge
                            variant={operation.status === "running" ? "destructive" : "secondary"}
                          >
                            {operation.status}
                          </Badge>
                        </div>
                        <dl className="mt-2 grid gap-1 text-muted-foreground">
                          <div>
                            <dt className="inline font-medium text-foreground">Type: </dt>
                            <dd className="inline">{operation.operationType}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-foreground">Owner: </dt>
                            <dd className="inline font-mono break-all">{operation.ownerToken}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-foreground">Started: </dt>
                            <dd className="inline">{operation.startedAt}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-foreground">Terminal: </dt>
                            <dd className="inline">{operation.terminalAt ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-foreground">Abandoned by: </dt>
                            <dd className="inline font-mono break-all">
                              {operation.abandonedBy ?? "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-foreground">Abandon reason: </dt>
                            <dd className="inline">{operation.abandonReason ?? "—"}</dd>
                          </div>
                        </dl>
                        {operation.status === "running" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="mt-3"
                                disabled={busy || !hasReason}
                              >
                                Abandon operation
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Abandon external operation?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This asserts that provider work for{" "}
                                  <span className="font-mono break-all">
                                    {operation.operationKey}
                                  </span>{" "}
                                  has stopped. Abandonment is terminal and may allow the work to be
                                  retried. Verify the provider state before continuing.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  disabled={busy || !hasReason}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => void abandonOperation(operation)}
                                >
                                  {busy ? "Abandoning…" : "Confirm abandonment"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="recovery-reason">Operator reason</Label>
                  <Textarea
                    id="recovery-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Required: explain the verified recovery action"
                    maxLength={500}
                    disabled={busy}
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for abandonment and recovery. Recovery is unavailable while any
                    external operation remains running.
                  </p>
                </div>

                {actionError && (
                  <p role="alert" className="text-xs text-destructive">
                    {actionError}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {(["error", "cancelled"] as const).map((status) => (
                    <AlertDialog key={status}>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant={status === "error" ? "destructive" : "outline"}
                          size="sm"
                          disabled={busy || !hasReason || runningOperations.length > 0}
                        >
                          Recover as {status}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Recover trace as {status}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This terminally marks trace{" "}
                            <span className="font-mono break-all">{detail.trace.id}</span> as{" "}
                            {status} using the exact owner shown above. It does not stop provider
                            work. Confirm no external work is still running.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={busy || !hasReason || runningOperations.length > 0}
                            className={
                              status === "error"
                                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                : undefined
                            }
                            onClick={() => void recoverTrace(status)}
                          >
                            {busy ? "Recovering…" : `Confirm ${status} recovery`}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ))}
                </div>
              </section>
            )}

            {(detail.trace.recoveredAt || detail.trace.recoveryReason) && (
              <section className="rounded-lg border border-border p-3 text-xs">
                <p className="font-semibold">Recovery metadata</p>
                <p className="mt-1 text-muted-foreground">
                  Recovered {detail.trace.recoveredAt ?? "—"} by{" "}
                  <span className="font-mono">{detail.trace.recoveredBy ?? "—"}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap">{detail.trace.recoveryReason ?? "—"}</p>
              </section>
            )}

            <Tabs defaultValue="conversation">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="conversation">Conversation</TabsTrigger>
                <TabsTrigger value="firecrawl">Firecrawl</TabsTrigger>
                <TabsTrigger value="versions">Versions</TabsTrigger>
                <TabsTrigger value="revisions">Revisions</TabsTrigger>
              </TabsList>

              <TabsContent value="conversation" className="space-y-3">
                {detail.messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages on this trace.</p>
                ) : (
                  detail.messages.map((m) => (
                    <div key={m.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold capitalize">{m.role}</span>
                        <span className="text-xs text-muted-foreground">{m.createdAt}</span>
                      </div>
                      <ExpandableCell
                        value={m.content}
                        title={`${m.role} message`}
                        className="mt-1 max-w-full whitespace-pre-wrap"
                      />
                      {m.toolCalls.length > 0 && (
                        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
                          {m.toolCalls.map((tc) => (
                            <div key={tc.id} className="text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-semibold">{tc.name}</span>
                                <span className="text-muted-foreground">
                                  {formatDurationMs(tc.durationMs)}
                                </span>
                              </div>
                              <ExpandableCell
                                value={tc.arguments}
                                title={`${tc.name} arguments`}
                                className="mt-1 max-w-full"
                              />
                              <ExpandableCell
                                value={tc.result}
                                title={`${tc.name} result`}
                                className="mt-1 max-w-full"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="firecrawl" className="space-y-3">
                {!detail.enrichment.ranInTrace ? (
                  <p className="text-sm text-muted-foreground">No firecrawl run in this trace.</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Research status: {detail.enrichment.researchStatus ?? "not started"} —
                      enrichment retrieved for this website after firecrawl_scrape in this turn.
                    </p>
                    {Object.keys(detail.enrichment.platforms).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Crawl ran, no usable platform data stored yet.
                      </p>
                    ) : (
                      Object.entries(detail.enrichment.platforms).map(([platform, value]) => (
                        <div key={platform} className="rounded-lg border border-border p-3">
                          <p className="text-xs font-semibold">{platform}</p>
                          <ExpandableCell
                            value={value}
                            title={`${platform} research`}
                            className="mt-1 max-w-full"
                          />
                        </div>
                      ))
                    )}
                    {detail.enrichment.images.length > 0 && (
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs font-semibold">
                          Images ({detail.enrichment.images.length})
                        </p>
                        <ExpandableCell
                          value={detail.enrichment.images}
                          title="Enrichment images"
                          className="mt-1 max-w-full"
                        />
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="versions">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      {["Version", "Variant", "Status", "Created", "Config"].map((h) => (
                        <th key={h} className="px-2 py-1 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.versions.length === 0 ? (
                      <tr>
                        <td className="p-2 text-muted-foreground" colSpan={5}>
                          No versions yet.
                        </td>
                      </tr>
                    ) : (
                      detail.versions.map((v) => (
                        <tr key={v.id} className="border-b border-border last:border-0 align-top">
                          <td className="px-2 py-1">{v.version_number}</td>
                          <td className="px-2 py-1">{v.variant_key}</td>
                          <td className="px-2 py-1">{v.status}</td>
                          <td className="px-2 py-1">
                            <ExpandableCell value={v.created_at} />
                          </td>
                          <td className="px-2 py-1">
                            <ExpandableCell value={v.config_json} title="config_json" />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="revisions">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      {["Category", "Version", "Created", "Patch"].map((h) => (
                        <th key={h} className="px-2 py-1 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.revisions.length === 0 ? (
                      <tr>
                        <td className="p-2 text-muted-foreground" colSpan={4}>
                          No revisions yet.
                        </td>
                      </tr>
                    ) : (
                      detail.revisions.map((r) => (
                        <tr key={r.id} className="border-b border-border last:border-0 align-top">
                          <td className="px-2 py-1">{r.category}</td>
                          <td className="px-2 py-1">
                            <ExpandableCell value={r.version_id} />
                          </td>
                          <td className="px-2 py-1">
                            <ExpandableCell value={r.created_at} />
                          </td>
                          <td className="px-2 py-1">
                            <ExpandableCell value={r.patch_json} title="patch_json" />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TabsContent>
            </Tabs>

            {detail.jobs.length > 0 && (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold">
                  Background jobs triggered by this trace ({detail.jobs.length})
                </p>
                <div className="mt-2 space-y-1">
                  {detail.jobs.map((job) => (
                    <div key={job.id} className="flex items-center justify-between text-xs">
                      <span className="font-mono">
                        {job.job_type}
                        {job.platform ? ` · ${job.platform}` : ""}
                      </span>
                      <Badge variant={job.status === "completed" ? "default" : "secondary"}>
                        {job.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
