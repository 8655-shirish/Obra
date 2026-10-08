import { createFileRoute } from "@tanstack/react-router";

import { runApprovedLeadRetention } from "@/lib/lead-governance.functions";

export const Route = createFileRoute("/api/cron/lead-retention")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization");
        const secret = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
        try {
          return Response.json(await runApprovedLeadRetention({ secret }));
        } catch (error) {
          const unauthorized = error instanceof Error && error.message === "Unauthorized";
          return Response.json(
            { error: unauthorized ? "Unauthorized" : "Retention run failed" },
            { status: unauthorized ? 401 : 500 },
          );
        }
      },
    },
  },
});
