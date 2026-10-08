import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterFourTemplatePage } from "@/components/templates/PainterFourTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterFourTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter4"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterFourTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter4")({
  head: () => ({
    meta: [
      { title: "True Coat — Craftsman’s Colorbook Painter Website Template" },
      {
        name: "description",
        content:
          "An elegant, imagery-heavy True Coat residential painter template inspired by a professional color-swatch book and well-used contractor toolbox.",
      },
      { property: "og:title", content: "True Coat — Craftsman’s Colorbook Painter Template" },
      {
        property: "og:description",
        content:
          "A tactile painter template led by physical swatches, refined craft imagery, matched-room proof, preparation stories, and simulated site-visit booking.",
      },
      { name: "twitter:title", content: "True Coat — Craftsman’s Colorbook Painter Template" },
      {
        name: "twitter:description",
        content:
          "A tactile, image-led painter template built around physical swatches, trusted tools, preparation, and simulated site-visit booking.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter4" }],
  }),
  component: PainterFourTemplateRoute,
});
