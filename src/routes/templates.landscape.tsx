import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { LandscapeTemplatePage } from "@/components/templates/LandscapeTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function GardenDeliteTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_landscape"
      prefill={{ businessName: "Garden Delite Contractors" }}
    >
      <LandscapeTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/landscape")({
  head: () => ({
    meta: [
      { title: "Garden Delite Contractors — Landscape Design & Garden Care" },
      {
        name: "description",
        content:
          "An imagery-led landscaping and garden design landing page template with services, transformations, testimonials, journal, FAQs, and booking demo.",
      },
      { property: "og:title", content: "Garden Delite — Landscape Website Template" },
      {
        property: "og:description",
        content:
          "An imagery-led landscape website template with services, transformations, journal content, and a booking demo.",
      },
      { name: "twitter:title", content: "Garden Delite — Landscape Website Template" },
      {
        name: "twitter:description",
        content:
          "An imagery-led landscape website template with services, transformations, journal content, and a booking demo.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/landscape" }],
  }),
  component: GardenDeliteTemplateRoute,
});
