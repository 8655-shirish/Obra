import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterFifteenTemplatePage } from "@/components/templates/PainterFifteenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterFifteenTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      showDisclaimer={false}
      templateId="tpl_painter15"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterFifteenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter15")({
  head: () => ({
    meta: [
      { title: "True Coat - Moroccan Zellige Painter Template" },
      {
        name: "description",
        content:
          "An image-first residential painter template shaped by Moroccan zellige, limewashed courtyards, carved doors, saturated architectural color, and preparation-led scope.",
      },
      { property: "og:title", content: "True Coat - Moroccan Zellige Painter Template" },
      {
        property: "og:description",
        content:
          "Explore an ornamental, image-first painter template with hand-cut tile detail, careful surface planning, and an illustrative matched facade study.",
      },
      { name: "twitter:title", content: "True Coat - Moroccan Zellige Painter Template" },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter15" }],
  }),
  component: PainterFifteenTemplateRoute,
});
