import { createFileRoute, Outlet, redirect, useMatches } from "@tanstack/react-router";
import { z } from "zod";

import { PurchaserOverview } from "@/components/purchaser/PurchaserOverview";
import { contractorLoginRedirect } from "@/lib/auth/contractor-return-path";
import { getWorkspaceBootstrap } from "@/lib/jobs.functions";
import { isTemplateId } from "@/lib/template-content/overlay";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/user/$userId")({
  validateSearch: z.object({
    websiteId: z.string().uuid().optional(),
    // Just-verified purchase intent (verify-otp / checkout-success): Step 1
    // heals the row or surfaces a coded support state. Data loaders still
    // assert workspace access, so a forged value only reaches an error state.
    templateId: z.string().optional(),
    connect: z.enum(["success", "error", "return", "refresh"]).optional(),
  }),
  head: () => ({
    meta: [{ title: "Workspace | Obra" }, ...NOINDEX_META],
  }),
  beforeLoad: async ({ params, search, location }) => {
    try {
      const bootstrap = await getWorkspaceBootstrap({
        data: { userId: params.userId, websiteId: search.websiteId },
      });
      return { bootstrap };
    } catch (error) {
      if (error instanceof Error && error.message === "Unauthorized") {
        const query = new URLSearchParams();
        if (search.websiteId) query.set("websiteId", search.websiteId);
        if (search.templateId) query.set("templateId", search.templateId);
        if (search.connect) query.set("connect", search.connect);
        const qs = query.toString();
        const hash = location.hash.replace(/^#/, "");
        throw redirect(
          contractorLoginRedirect(
            `/user/${params.userId}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`,
          ),
        );
      }
      throw error;
    }
  },
  loader: ({ context }) => context.bootstrap,
  component: UserWorkspacePage,
});

function UserWorkspacePage() {
  const bootstrap = Route.useLoaderData();
  const search = Route.useSearch();
  const editActive = useMatches().some((match) => match.routeId === "/user/$userId/edit-mode");
  const intendedTemplateId =
    search.templateId && isTemplateId(search.templateId) ? search.templateId : null;

  return (
    <div className="min-h-screen bg-background">
      {!editActive ? (
        <PurchaserOverview
          key={bootstrap.profile.id}
          userId={bootstrap.profile.id}
          websiteId={bootstrap.websiteId}
          intendedTemplateId={intendedTemplateId}
          connect={search.connect}
        />
      ) : null}
      <Outlet />
    </div>
  );
}
