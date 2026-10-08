import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AdminGate } from "@/components/admin/AdminGate";
import { AdminShell } from "@/components/admin/AdminShell";
import { TracesTable } from "@/components/admin/TracesTable";
import { TraceDetailSheet } from "@/components/admin/TraceDetailSheet";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/admin_/traces")({
  head: () => ({
    meta: [{ title: "Agent traces | Obra Admin" }, ...NOINDEX_META],
  }),
  component: AdminTracesPage,
});

function AdminTracesPage() {
  return <AdminGate>{({ onLogout }) => <AdminTracesDashboard onLogout={onLogout} />}</AdminGate>;
}

function AdminTracesDashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const [openTraceId, setOpenTraceId] = useState<string | null>(null);

  return (
    <AdminShell onLogout={onLogout}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agent traces</h1>
          <p className="text-sm text-muted-foreground">
            Every agent turn — thinking, tool calls, and firecrawl research — inspectable per
            customer.
          </p>
        </header>
        <TracesTable onOpenTrace={setOpenTraceId} />
      </div>
      <TraceDetailSheet traceId={openTraceId} onClose={() => setOpenTraceId(null)} />
    </AdminShell>
  );
}
