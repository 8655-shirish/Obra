import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PainterEighteenTemplatePage } from "@/components/templates/PainterEighteenTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PainterEighteenTemplateRoute() {
  return (
    <DemoLpChrome showBuyCta={true} showDisclaimer={false} templateId="tpl_painter18">
      <PainterEighteenTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/painter18")({
  head: () => ({
    meta: [
      { title: "Lavender Estate - Painting and Decorating Template" },
      {
        name: "description",
        content:
          "Country-house colour, painted interiors and fine woodwork. Explore photographic room studies and practical decorating guidance from Lavender Estate.",
      },
      { property: "og:title", content: "Lavender Estate - Painting and Decorating Template" },
      {
        property: "og:description",
        content:
          "Old soul. Fresh colour. An English country-house painting and decorating experience with photographic room studies and a personal project planner.",
      },
      { name: "twitter:title", content: "Lavender Estate - Painting and Decorating Template" },
      ...NOINDEX_META,
    ],
    links: [
      { rel: "canonical", href: "/templates/painter18" },
      {
        rel: "preload",
        href: "/templates/lavender-estate/fonts/cormorant-garamond-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: "/templates/lavender-estate/fonts/source-sans-3-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  component: PainterEighteenTemplateRoute,
});
