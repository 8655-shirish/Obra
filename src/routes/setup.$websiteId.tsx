import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { contractorLoginRedirect } from "@/lib/auth/contractor-return-path";
import { getSetupRedirectTarget } from "@/lib/template-purchase.functions";
import { NOINDEX_META } from "@/lib/seo";

const connectSearch = z.object({
  connect: z.enum(["success", "error", "return", "refresh"]).optional(),
});

export const Route = createFileRoute("/setup/$websiteId")({
  validateSearch: connectSearch,
  head: () => ({ meta: [{ title: "Booking setup | Obra" }, ...NOINDEX_META] }),
  beforeLoad: async ({ params, search, location }) => {
    try {
      const target = await getSetupRedirectTarget({
        data: { websiteId: params.websiteId },
      });
      if (!target) {
        throw redirect(contractorLoginRedirect(`${location.pathname}${location.search}`));
      }
      const suffix = location.pathname.split("/").filter(Boolean)[2];
      const hash =
        suffix === "calendar"
          ? "step-2"
          : suffix === "availability"
            ? "step-3"
            : suffix === "payments"
              ? "step-4"
              : undefined;
      throw redirect({
        to: "/user/$userId",
        params: { userId: target.userId },
        search: {
          websiteId: params.websiteId,
          ...(search.connect ? { connect: search.connect } : {}),
        },
        ...(hash ? { hash } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Unauthorized") {
        throw redirect(contractorLoginRedirect(`${location.pathname}${location.search}`));
      }
      throw error;
    }
  },
  component: () => <Outlet />,
});
