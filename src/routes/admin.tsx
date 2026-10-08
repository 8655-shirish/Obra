import { createFileRoute } from "@tanstack/react-router";

import { AdminAuthSettings } from "@/components/admin/AdminAuthSettings";
import { AdminCalendarRepair } from "@/components/admin/AdminCalendarRepair";
import { AdminGate } from "@/components/admin/AdminGate";
import { AdminRecordsPanel } from "@/components/admin/AdminRecordsPanel";
import { AdminShell } from "@/components/admin/AdminShell";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin | Obra" }, ...NOINDEX_META],
  }),
  component: AdminPage,
});

function AdminPage() {
  return <AdminGate>{({ onLogout }) => <AdminDashboard onLogout={onLogout} />}</AdminGate>;
}

function AdminDashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  return (
    <AdminShell onLogout={onLogout}>
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin</h1>
          <p className="text-sm text-muted-foreground">Records and admin authentication.</p>
        </header>
        <AdminRecordsPanel />
        <AdminAuthSettings onSessionEnded={onLogout} />
        <AdminCalendarRepair />
      </div>
    </AdminShell>
  );
}
