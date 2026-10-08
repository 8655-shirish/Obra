import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterThreeTemplatePage } from "@/components/templates/PainterThreeTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterThreeTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter3"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterThreeTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/painter3")({
  head: () => ({
    meta: [
      { title: "True Coat — Color-Led Residential Painter Website Template" },
      {
        name: "description",
        content:
          "A splash-forward, imagery-first True Coat painter template for residential interiors, eligible exteriors, and cabinet refinishing, built around color, light, surface preparation, and truthful project guidance.",
      },
      { property: "og:title", content: "True Coat — Chromatic Frame Painter Template" },
      {
        property: "og:description",
        content:
          "A vivid residential painter template led by moving lacquer pigment, oversized project imagery, generated concept studies, surface guidance, and simulated site-visit booking.",
      },
      { name: "twitter:title", content: "True Coat — Chromatic Frame Painter Template" },
      {
        name: "twitter:description",
        content:
          "A splash-forward painter template with moving pigment, image-led services, clearly labeled generated studies, project planning, and simulated site-visit booking.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/painter3" }],
  }),
  component: PainterThreeTemplateRoute,
});
