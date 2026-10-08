import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterSeventeenTemplatePage } from "@/components/templates/PainterSeventeenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterSeventeenTemplateRoute() {
  return (
    <DemoLpChrome showBuyCta={true} showDisclaimer={false} templateId="tpl_painter17">
      <PainterSeventeenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter17")({
  head: () => ({
    meta: [
      { title: "Alpine Enamel - Mountain Cabin Painter Template" },
      {
        name: "description",
        content:
          "Mountain-cabin colour studies, practical timber care and a personal painting planner. A photographic painter template with an enamel-sign character.",
      },
      { property: "og:title", content: "Alpine Enamel - Mountain Cabin Painter Template" },
      {
        property: "og:description",
        content:
          "Explore cranberry and pine cabin photographs, prepare sound timber and gather the details for your next painting project.",
      },
      { name: "twitter:title", content: "Alpine Enamel - Mountain Cabin Painter Template" },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter17" }],
  }),
  component: PainterSeventeenTemplateRoute,
});
