import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterTenTemplatePage } from "@/components/templates/PainterTenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterTenTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter10"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterTenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter10")({
  head: () => ({
    meta: [
      { title: "True Coat - Midnight Lacquer Painter Template" },
      {
        name: "description",
        content:
          "A dark-luxury residential painter template shaped by lacquer, showroom light, edge precision, and preparation-led scope.",
      },
      { property: "og:title", content: "True Coat - Midnight Lacquer Painter Template" },
      {
        property: "og:description",
        content:
          "Midnight Lacquer pairs obsidian, oxblood, champagne metal, moving finish inspection, and honest residential painting guidance.",
      },
      { name: "twitter:title", content: "True Coat - Midnight Lacquer Painter Template" },
      {
        name: "twitter:description",
        content:
          "A precision-led residential painter template inspired by automotive lacquer and luxury showroom lighting.",
      },
      ...NOINDEX_META,
    ],
    links: [
      { rel: "canonical", href: "/templates/painter10" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wdth,wght@75..100,400..700&family=Italiana&display=swap",
      },
    ],
  }),
  component: PainterTenTemplateRoute,
});
