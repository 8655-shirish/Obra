import { createFileRoute } from "@tanstack/react-router";

import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/setup/$websiteId/")({
  head: () => ({ meta: [{ title: "Booking setup | Obra" }, ...NOINDEX_META] }),
  component: () => null,
});
