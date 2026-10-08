import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/template/plumber")({
  beforeLoad: () => {
    throw redirect({ to: "/templates/plumber", statusCode: 308 });
  },
});
