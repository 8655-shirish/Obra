import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listAgentTraces } from "@/lib/admin-traces.functions";

import { ExpandableCell } from "./ExpandableCell";

export interface TraceRow {
  id: string;
  websiteId: string;
  profileId: string;
  businessName: string | null;
  licenseNumber: string | null;
  intentType: string | null;
  triggerMessage: string | null;
  status: string;
  errorMessage: string | null;
  toolCallCount: number;
  roundCount: number;
  startedAt: string;
  completedAt: string | null;
  versionCount: number;
  revisionCount: number;
  firecrawlRan: boolean;
  firecrawlInfo: string | null;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "completed") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "running…";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TracesTable({ onOpenTrace }: { onOpenTrace: (traceId: string) => void }) {
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    listAgentTraces({
      data: {
        limit,
        offset,
        search: search || undefined,
        status: status === "all" ? undefined : (status as "running" | "completed" | "error"),
      },
    })
      .then((result) => {
        setRows(result.rows);
        setTotal(result.total);
      })
      .finally(() => setLoading(false));
  }, [offset, search, status]);

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Agent traces</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per agent turn — chat, admin kickoff, or publish. Click a trace id to see the
            full waterfall, firecrawl research, and website history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Search license or business name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="w-56"
          />
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {[
                "Trace",
                "Customer",
                "License",
                "Intent",
                "Status",
                "Started",
                "Duration",
                "Tools",
                "Versions",
                "Revisions",
                "Firecrawl",
                "Message",
              ].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={12}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={12}>
                  No traces yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenTrace(row.id)}
                      className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                    >
                      {row.id.slice(0, 8)}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <ExpandableCell value={row.businessName} title="Customer" />
                  </td>
                  <td className="px-3 py-2">
                    <ExpandableCell value={row.licenseNumber} title="License number" />
                  </td>
                  <td className="px-3 py-2">
                    <ExpandableCell value={row.intentType} title="Intent" />
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <ExpandableCell value={row.startedAt} title="Started at" />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {formatDuration(row.startedAt, row.completedAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{row.toolCallCount}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.versionCount}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.revisionCount}</td>
                  <td className="px-3 py-2">
                    <ExpandableCell
                      value={row.firecrawlInfo}
                      title="Firecrawl research"
                      className="max-w-xs"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <ExpandableCell
                      value={row.errorMessage ?? row.triggerMessage}
                      title="Message"
                      className="max-w-sm"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Showing {Math.min(offset + 1, total)}–{Math.min(offset + limit, total)} of {total}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={offset + limit >= total || loading}
            onClick={() => setOffset((o) => o + limit)}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
