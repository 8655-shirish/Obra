import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterTwoTemplatePage } from "@/components/templates/PainterTwoTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterTwoTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter2"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterTwoTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/painter2")({
  head: () => ({
    meta: [
      { title: "True Coat — Dark Residential Painter Website Template" },
      {
        name: "description",
        content:
          "A dark, imagery-led True Coat painter template for residential interiors, eligible exteriors, and cabinet refinishing, built around preparation and precise surfaces.",
      },
      { property: "og:title", content: "True Coat — Dark Painter Website Template" },
      {
        property: "og:description",
        content:
          "A cinematic dark True Coat template with distinct local imagery, craft video, service scope, preparation, matched-frame proof, and simulated site-visit booking.",
      },
      { name: "twitter:title", content: "True Coat — Dark Painter Website Template" },
      {
        name: "twitter:description",
        content:
          "A cinematic dark True Coat template with distinct local imagery, craft video, preparation, service scope, and simulated site-visit booking.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/painter2" }],
  }),
  component: PainterTwoTemplateRoute,
});
