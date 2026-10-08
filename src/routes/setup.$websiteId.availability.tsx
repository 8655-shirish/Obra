import { createFileRoute } from "@tanstack/react-router";

import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/setup/$websiteId/availability")({
  head: () => ({ meta: [{ title: "Availability setup | Obra" }, ...NOINDEX_META] }),
  component: () => null,
});
