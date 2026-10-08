import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/setup/$websiteId/payments")({
  validateSearch: z.object({ connect: z.enum(["return", "refresh"]).optional() }),
  component: () => null,
});
