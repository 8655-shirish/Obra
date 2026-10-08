import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/painter4")({
  beforeLoad: () => {
    throw redirect({ to: "/templates/painter4", statusCode: 308 });
  },
});
