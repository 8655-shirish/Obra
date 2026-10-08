import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterThirteenTemplatePage } from "@/components/templates/PainterThirteenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterThirteenTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      showDisclaimer={false}
      templateId="tpl_painter13"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterThirteenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter13")({
  head: () => ({
    meta: [
      { title: "True Coat - Blueberry Gelato Painter Template" },
      {
        name: "description",
        content:
          "An image-first residential painter template inspired by Mediterranean plaster, painted shutters, ceramic tile, and a four-part color recipe.",
      },
      { property: "og:title", content: "True Coat - Blueberry Gelato Painter Template" },
      {
        property: "og:description",
        content:
          "Explore a vivid residential painter template with a hands-on color recipe, preparation-led scope, and an illustrative matched facade study.",
      },
      { name: "twitter:title", content: "True Coat - Blueberry Gelato Painter Template" },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter13" }],
  }),
  component: PainterThirteenTemplateRoute,
});
