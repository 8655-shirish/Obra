import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterFourteenTemplatePage } from "@/components/templates/PainterFourteenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterFourteenTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      showDisclaimer={false}
      templateId="tpl_painter14"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterFourteenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter14")({
  head: () => ({
    meta: [
      { title: "True Coat - Juice Bar Renovation Painter Template" },
      {
        name: "description",
        content:
          "An image-first painter template inspired by tropical 1980s interiors, glossy tile, chrome, bright finishes, and carefully planned residential painting.",
      },
      { property: "og:title", content: "True Coat - Juice Bar Renovation Painter Template" },
      {
        property: "og:description",
        content:
          "Explore a vibrant residential painter template with glossy finish studies, saturated architectural color, and preparation-led scope.",
      },
      { name: "twitter:title", content: "True Coat - Juice Bar Renovation Painter Template" },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter14" }],
  }),
  component: PainterFourteenTemplateRoute,
});
