import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterSevenTemplatePage } from "@/components/templates/PainterSevenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterSevenTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter7"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterSevenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter7")({
  head: () => ({
    meta: [
      { title: "True Coat — Ultraviolet Workshop Painter Template" },
      {
        name: "description",
        content:
          "An experimental, image-led residential painter template where high-gloss pigment, electric lighting control, and preparation-led scope create a premium workshop experience.",
      },
      { property: "og:title", content: "True Coat — Ultraviolet Workshop Painter Template" },
      {
        property: "og:description",
        content:
          "A high-energy painter template with global purple, lime, and magenta lighting control; paint-only studies; practical planning; and simulated site-visit booking.",
      },
      { name: "twitter:title", content: "True Coat — Ultraviolet Workshop Painter Template" },
      {
        name: "twitter:description",
        content:
          "An experimental premium residential-painting template built around reflective pigment, honest scope, and a responsive lighting console.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter7" }],
  }),
  component: PainterSevenTemplateRoute,
});
