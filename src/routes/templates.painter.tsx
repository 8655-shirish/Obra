import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterTemplatePage } from "@/components/templates/PainterTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter")({
  head: () => ({
    meta: [
      { title: "True Coat — Residential Painting & Finishes" },
      {
        name: "description",
        content:
          "A tactile painter website template for interior painting, exterior preparation, cabinet refinishing, illustrative transformations, and customer estimate requests.",
      },
      { property: "og:title", content: "True Coat — Painter Website Template" },
      {
        property: "og:description",
        content:
          "A tactile painter website template for interiors, exterior preparation, cabinet refinishing, and estimate requests.",
      },
      { name: "twitter:title", content: "True Coat — Painter Website Template" },
      {
        name: "twitter:description",
        content:
          "A tactile painter website template for interiors, exterior preparation, cabinet refinishing, and estimate requests.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter" }],
  }),
  component: PainterTemplateRoute,
});
