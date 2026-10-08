import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterEightTemplatePage } from "@/components/templates/PainterEightTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterEightTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter8"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterEightTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter8")({
  head: () => ({
    meta: [
      { title: "True Coat — Candy Capsule Lab Painter Template" },
      {
        name: "description",
        content:
          "A candy-capsule painter template with glossy photographic rooms, pack-sleeve type, finish swatches, and preparation-led residential scope.",
      },
      { property: "og:title", content: "True Coat — Candy Capsule Lab Painter Template" },
      {
        property: "og:description",
        content:
          "Candy-capsule painter template with bubblegum pink, lavender, aqua, and lemon finishes; pop-to-recolor swatches; and simulated site-visit booking.",
      },
      { name: "twitter:title", content: "True Coat — Candy Capsule Lab Painter Template" },
      {
        name: "twitter:description",
        content:
          "Playful glossy residential painting template built around photographic rooms, pack-sleeve type, and honest scope planning.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter8" }],
  }),
  component: PainterEightTemplateRoute,
});
