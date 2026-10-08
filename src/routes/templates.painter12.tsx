import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterTwelveTemplatePage } from "@/components/templates/PainterTwelveTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterTwelveTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      showDisclaimer={false}
      templateId="tpl_painter12"
      prefill={{ businessName: "True Coat" }}
    >
      <PainterTwelveTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter12")({
  head: () => ({
    meta: [
      { title: "True Coat - Lemonade Stand Painter Template" },
      {
        name: "description",
        content:
          "A sunny neighborhood painter template shaped by hand-painted signs, colorful porches, local project postcards, and preparation-led residential scope.",
      },
      { property: "og:title", content: "True Coat - Lemonade Stand Painter Template" },
      {
        property: "og:description",
        content:
          "Explore a friendly, image-first residential painter template inspired by summer afternoons and the nicest crew on the block.",
      },
      { name: "twitter:title", content: "True Coat - Lemonade Stand Painter Template" },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/painter12" }],
  }),
  component: PainterTwelveTemplateRoute,
});
