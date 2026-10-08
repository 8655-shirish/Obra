import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterSixteenTemplatePage } from "@/components/templates/PainterSixteenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterSixteenTemplateRoute() {
  return (
    <DemoLpChrome showBuyCta={true} showDisclaimer={false} templateId="tpl_painter16">
      <PainterSixteenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter16")({
  head: () => ({
    meta: [
      { title: "True Coat - Ink Wash Painter Template" },
      {
        name: "description",
        content:
          "A quiet, Japanese-inspired residential painter template with natural timber, washi light, indigo finishes, practical field notes and a local project planner.",
      },
      { property: "og:title", content: "True Coat - Ink Wash Painter Template" },
      {
        property: "og:description",
        content:
          "Explore considered colour for walls and woodwork, a photographic One Stroke study and useful painting guidance.",
      },
      { name: "twitter:title", content: "True Coat - Ink Wash Painter Template" },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter16" }],
  }),
  component: PainterSixteenTemplateRoute,
});
