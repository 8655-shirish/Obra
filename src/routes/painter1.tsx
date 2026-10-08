import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/painter1")({
  beforeLoad: () => {
    throw redirect({ to: "/templates/painter1", statusCode: 308 });
  },
});
