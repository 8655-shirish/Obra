import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { EditModePage } from "@/components/purchaser/EditModePage";
import { contractorLoginRedirect } from "@/lib/auth/contractor-return-path";
import { getTemplateDraft } from "@/lib/template-edit.functions";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/user/$userId/edit-mode")({
  validateSearch: z.object({ websiteId: z.string().uuid() }),
  head: () => ({
    meta: [{ title: "Edit website | Obra" }, ...NOINDEX_META],
  }),
  beforeLoad: async ({ params, search }) => {
    try {
      const draft = await getTemplateDraft({ data: { websiteId: search.websiteId } });
      return { draft, userId: params.userId, websiteId: search.websiteId };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "Unauthorized" || error.message === "Forbidden")
      ) {
        throw redirect(
          contractorLoginRedirect(`/user/${params.userId}/edit-mode?websiteId=${search.websiteId}`),
        );
      }
      throw error;
    }
  },
  loader: ({ context }) => context,
  component: EditModeRoute,
});

function EditModeRoute() {
  const { draft, userId, websiteId } = Route.useLoaderData();
  return <EditModePage userId={userId} websiteId={websiteId} initial={draft} />;
}
