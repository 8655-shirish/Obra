import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterOneTemplatePage } from "@/components/templates/PainterOneTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterOneTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter1"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterOneTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter1")({
  head: () => ({
    meta: [
      { title: "True Coat — Painter Website Template" },
      {
        name: "description",
        content:
          "An imagery-first True Coat painter template shaped by warm primer, graphite, masking-tape blue, precise preparation, and vivid finish stories.",
      },
      { property: "og:title", content: "True Coat — Painter Website Template" },
      {
        property: "og:description",
        content:
          "An imagery-first True Coat painter template with craft video, tactile preparation stories, image-sampled color, and estimate requests.",
      },
      { name: "twitter:title", content: "True Coat — Painter Website Template" },
      {
        name: "twitter:description",
        content:
          "An imagery-first True Coat painter template with craft video, tactile preparation stories, image-sampled color, and estimate requests.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter1" }],
  }),
  component: PainterOneTemplateRoute,
});
