import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterSixTemplatePage } from "@/components/templates/PainterSixTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterSixTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_painter6"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterSixTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter6")({
  head: () => ({
    meta: [
      { title: "True Coat — Eggshell Painter Website Template" },
      {
        name: "description",
        content:
          "A quiet-luxury, imagery-led residential painter template built around immaculate surfaces, raking light, and preparation-led workmanship.",
      },
      { property: "og:title", content: "True Coat — Eggshell Painter Website Template" },
      {
        property: "og:description",
        content:
          "A calm surface-study painter template with light-led finish exploration, paint-only proof, and simulated site-visit booking.",
      },
      { name: "twitter:title", content: "True Coat — Eggshell Painter Template" },
      {
        name: "twitter:description",
        content:
          "A quiet-luxury residential painter template where flawless painted surfaces, restrained craft, and clear next steps lead the experience.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter6" }],
  }),
  component: PainterSixTemplateRoute,
});
