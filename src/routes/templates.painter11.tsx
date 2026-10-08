import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterElevenTemplatePage } from "@/components/templates/PainterElevenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterElevenTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter11"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterElevenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter11")({
  head: () => ({
    meta: [
      { title: "True Coat — Vaporwave Paint Supply Template" },
      {
        name: "description",
        content:
          "A vaporwave residential painter template inspired by 1990s paint software, direct-flash project photography, and surreal digital showrooms.",
      },
      { property: "og:title", content: "True Coat — Vaporwave Paint Supply Template" },
      {
        property: "og:description",
        content:
          "Explore an image-first residential painter template built like an after-hours vaporwave paint showroom.",
      },
      { name: "twitter:title", content: "True Coat — Vaporwave Paint Supply Template" },
      ...NOINDEX_META,
    ],
    links: [
      { rel: "canonical", href: "/templates/painter11" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  component: PainterElevenTemplateRoute,
});
