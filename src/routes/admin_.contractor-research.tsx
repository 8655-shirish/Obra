import { createFileRoute } from "@tanstack/react-router";

import { AdminGate } from "@/components/admin/AdminGate";
import { AdminShell } from "@/components/admin/AdminShell";
import { ContractorResearchWorkspace } from "@/components/admin/ContractorResearchWorkspace";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/admin_/contractor-research")({
  head: () => ({
    meta: [{ title: "Contractor Research | Obra Admin" }, ...NOINDEX_META],
  }),
  component: AdminContractorResearchPage,
});

function AdminContractorResearchPage() {
  return (
    <AdminGate>
      {({ onLogout }) => (
        <AdminShell onLogout={onLogout}>
          <div className="mx-auto flex max-w-[96rem] flex-col gap-6 px-4 py-8">
            <header>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Contractor Research
              </h1>
              <p className="text-sm text-muted-foreground">
                Upload a contractor CSV, then Start research for a row. View opens the same
                Firecrawl dossier Get my information already produces.
              </p>
            </header>
            <ContractorResearchWorkspace />
          </div>
        </AdminShell>
      )}
    </AdminGate>
  );
}
