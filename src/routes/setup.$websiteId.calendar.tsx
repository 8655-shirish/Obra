import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/setup/$websiteId/calendar")({
  validateSearch: z.object({ connect: z.enum(["success", "error"]).optional() }),
  component: () => null,
});
