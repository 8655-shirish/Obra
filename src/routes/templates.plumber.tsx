import { createFileRoute } from "@tanstack/react-router";

import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { PlumberTemplatePage } from "@/components/templates/PlumberTemplatePage";
import { NOINDEX_META } from "@/lib/seo";

function PlumberTemplateRoute() {
  return (
    <DemoLpChrome
      showBuyCta={true}
      templateId="tpl_plumber"
      prefill={{ businessName: "Leak Geeks - backflow and plumbing" }}
    >
      <PlumberTemplatePage />
    </DemoLpChrome>
  );
}

export const Route = createFileRoute("/templates/plumber")({
  head: () => ({
    meta: [
      { title: "Leak Geeks — Backflow, Leak Detection & Plumbing" },
      {
        name: "description",
        content:
          "An imagery-led plumber landing-page template for leak detection, backflow service, and residential plumbing.",
      },
      { property: "og:title", content: "Leak Geeks — Plumbing Website Template" },
      {
        property: "og:description",
        content:
          "A cinematic plumbing website template with diagnostics, services, project evidence, FAQs, and a booking demo.",
      },
      { name: "twitter:title", content: "Leak Geeks — Plumbing Website Template" },
      {
        name: "twitter:description",
        content:
          "A cinematic plumbing website template with diagnostics, services, project evidence, FAQs, and a booking demo.",
      },
      ...NOINDEX_META,
    ],
    links: [{ rel: "canonical", href: "/templates/plumber" }],
  }),
  component: PlumberTemplateRoute,
});
