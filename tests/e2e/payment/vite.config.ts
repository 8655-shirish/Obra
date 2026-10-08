import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(fixtureRoot, "../../..");
const mock = (file: string) => path.join(fixtureRoot, "mocks", file);

const publicLoaderFixture = {
  name: "payment-public-loader-fixture",
  enforce: "pre",
  async load(id: string) {
    if (!id.endsWith("/src/routes/lp/$websiteId.tsx")) return;
    const source = await readFile(id, "utf8");
    const start = source.indexOf("const loadPublicSite = createServerFn(");
    const end = source.indexOf("export const Route =", start);
    if (start < 0 || end < 0) throw new Error("LP loader injection boundary changed");
    return {
      code:
        source
          .slice(0, start)
          .replace('import { createServerFn } from "@tanstack/react-start";', "") +
        `import { loadPublicSite } from ${JSON.stringify(mock("public-site.functions.ts"))};\n` +
        source.slice(end),
      map: null,
    };
  },
} satisfies Plugin;

export default defineConfig({
  root: fixtureRoot,
  cacheDir: path.join(repositoryRoot, "test-results/payment-vite"),
  plugins: [publicLoaderFixture, tailwindcss(), react()],
  publicDir: path.join(repositoryRoot, "public"),
  // Keep dependency discovery on the fixture, not the application's generated router.
  optimizeDeps: {
    entries: [path.join(fixtureRoot, "index.html")],
    rolldownOptions: { plugins: [publicLoaderFixture] },
  },
  resolve: {
    alias: [
      {
        find: "@/lib/booking-setup.functions",
        // The availability save mock is unchanged; Google overview loaders are isolated below.
        replacement: mock("booking-provider.functions.ts"),
      },
      {
        find: "@/lib/booking-provider.functions",
        replacement: mock("google-overview.functions.ts"),
      },
      {
        find: "@/lib/stripe-connect.functions",
        replacement: mock("stripe-connect.functions.ts"),
      },
      {
        find: "@/lib/booking-live.functions",
        replacement: mock("booking-live.functions.ts"),
      },
      {
        find: "@/lib/booking-attachments.functions",
        replacement: mock("booking-attachments.functions.ts"),
      },
      {
        find: "@/lib/booking-confirmation.functions",
        replacement: mock("booking-confirmation.functions.ts"),
      },
      ...[
        "@/lib/template-purchase.functions",
        "@/lib/agent/fetch-agent-message",
        "@/lib/jobs.functions",
        "@/lib/supabase-browser",
        "@/lib/leads.functions",
        "@/lib/bookings.functions",
      ].map((find) => ({ find, replacement: mock("google-overview.functions.ts") })),
      ...[
        "@/components/site-renderer/ContractorSiteView",
        "@/lib/checkout.functions",
        "@/lib/demo-license.functions",
      ].map((find) => ({ find, replacement: mock("public-site.functions.ts") })),
      { find: "@", replacement: path.join(repositoryRoot, "src") },
    ],
  },
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
});
