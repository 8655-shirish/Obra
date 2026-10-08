import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterFiveTemplatePage } from "@/components/templates/PainterFiveTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterFiveTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter5"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterFiveTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter5")({
  head: () => ({
    meta: [
      { title: "True Coat — California Contractor Painter Website Template" },
      {
        name: "description",
        content:
          "A premium, imagery-led California residential painter template shaped like a sunlit architecture magazine.",
      },
      { property: "og:title", content: "True Coat — California Contractor Painter Template" },
      {
        property: "og:description",
        content:
          "A sunny architectural painter template with material-board projects, paint-only transformation proof, and simulated site-visit booking.",
      },
      { name: "twitter:title", content: "True Coat — California Contractor Painter Template" },
      {
        name: "twitter:description",
        content:
          "A premium California residential painter template with architectural imagery and an interactive facade palette.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter5" }],
  }),
  component: PainterFiveTemplateRoute,
});
