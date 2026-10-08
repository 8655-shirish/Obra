import { createFileRoute } from "@tanstack/react-router";

import { TemplatesCatalogPage } from "@/components/templates/TemplatesCatalogPage";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/templates/")({
  head: () => ({
    meta: [
      { title: "Contractor Website Templates" },
      {
        name: "description",
        content:
          "Explore distinctive contractor website templates for gardeners, plumbers, painters, and more.",
      },
      { property: "og:title", content: "Contractor Website Templates" },
      {
        property: "og:description",
        content:
          "Explore contractor website templates for gardeners, plumbers, painters, and more.",
      },
      { name: "twitter:title", content: "Contractor Website Templates" },
      {
        name: "twitter:description",
        content:
          "Explore contractor website templates for gardeners, plumbers, painters, and more.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates" }],
  }),
  component: TemplatesCatalogPage,
});
