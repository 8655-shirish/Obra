import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

// Actual existing dashboard/component tree, browser-local RPC fixtures. No auth,
// provider, database, public route tree, package or payment harness is changed.
const root = process.cwd();
const source = await readFile(path.join(root, "src/styles.css"), "utf8");
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style type="text/tailwindcss">${source.replaceAll(/@import[^;]+;|@source[^;]+;/g, "")}</style>
<script src="/tailwind.js"></script></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>`;
const mocks = {
  "@tanstack/react-router": `import {createElement} from "react";
    export const createFileRoute=()=>config=>config;
    export const Link=({to,children,...props})=>createElement("a",{...props,href:to},children);`,
  "@/lib/admin.functions": `
    export const getAdminStatus=async()=>({authenticated:true});
    export const adminLogout=async()=>{};
    export const adminBootstrap=async()=>({}); export const adminFinishMfaEnrollment=async()=>({});
    export const adminLogin=async()=>({}); export const adminRecover=async()=>({});
    export const adminStartMfaEnrollment=async()=>({}); export const adminVerifyMfa=async()=>({});`,
  "@/lib/admin-observability.functions": `
    export const getGenerationObservability=async()=>{
      if(window.generationError) throw new Error("unavailable");return {observedAt:"2026-09-10T00:00:00Z",alerts:[],projections:[],slos:[],recentFailures:[]};};
    export const getCalendarObservability=async()=>window.calendarFixture;`,
};
const output = await build({
  stdin: {
    contents: `import {createElement} from "react";import {createRoot} from "react-dom/client";
      import {Route} from ${JSON.stringify(path.join(root, "src/routes/admin_.observability.tsx"))};
      createRoot(document.getElementById("root")).render(createElement(Route.component));`,
    resolveDir: root,
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  write: false,
  alias: { "@": path.join(root, "src") },
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [
    {
      name: "calendar-dashboard-fixtures",
      setup(api) {
        api.onResolve({ filter: /.*/ }, ({ path: specifier }) =>
          specifier in mocks ? { path: specifier, namespace: "fixture" } : undefined,
        );
        api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: specifier }) => ({
          contents: mocks[specifier],
          resolveDir: root,
          loader: "js",
        }));
      },
    },
  ],
});
const tailwind = await readFile(
  path.join(root, "node_modules/@tailwindcss/browser/dist/index.global.js"),
);
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/test.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(output.outputFiles[0].contents);
  } else if (pathname === "/tailwind.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(tailwind);
  } else if (pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve, reject) =>
  server.listen(0, "127.0.0.1", resolve).once("error", reject),
);
const origin = `http://127.0.0.1:${server.address().port}`;
const temporary = await mkdtemp(path.join(root, ".calendar-observability-browser-"));
const previousTmpdir = process.env.TMPDIR;
process.env.TMPDIR = temporary;
let browser;
try {
  const chrome =
    process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin) ? route.continue() : route.abort(),
    );
    await page.addInitScript(() => {
      const observedAt = "2026-09-10T00:00:00Z";
      window.calendarFixture = {
        outcome: "available",
        report: {
          environment: "test",
          observedAt,
          schedulerScope: { owner: "fixture_scheduler_owner", visibility: "owner_only" },
          responseRecorder: {
            registered: null,
            active: null,
            last_recorded_response_at: observedAt,
          },
          independentMonitorVerified: false,
          configuration: {
            monitorEnabled: true,
            actionNoticesEnabled: true,
            alertConfigured: true,
            noticeConfigured: true,
          },
          alerts: [
            {
              id: "action-notices:review",
              dedupeKey: "calendar:test:action-notices:review",
              summary: "Contractor action email delivery is unresolved; automatic resend is unsafe",
              status: "firing",
              severity: "critical",
              value: 1,
              threshold: 1,
              unit: "count",
              owner: "Fixture operator",
              channel: "Fixture destination",
            },
          ],
          schedules: ["google", "stripe", "booking-core", "booking-notifications"].map(
            (worker) => ({
              schedule_name: `obra-calendar-test-${worker}`,
              status: "off",
              last_dispatched_at: observedAt,
              last_authenticated_completed_at: observedAt,
              worker_outcome: "off",
            }),
          ),
          obligations: {
            calendar: {
              count: 2,
              oldestPendingAgeSeconds: 305,
              blockedCount: 1,
              unresolvedDestinationCount: 1,
            },
            notifications: { count: 1, oldestPendingAgeSeconds: 125, reviewCount: 1 },
          },
          actionNotices: {
            action_required_count: 1,
            pending_count: 0,
            review_count: 1,
            items_limit: 100,
            items: [
              {
                connection_id: "11111111-1111-4111-8111-111111111111",
                profile_id: "22222222-2222-4222-8222-222222222222",
                notice_id: "33333333-3333-4333-8333-333333333333",
                current_incident: {
                  id: "44444444-4444-4444-8444-444444444444",
                  cause: "permissions",
                  source: "saved",
                  opened_at: observedAt,
                  closed_at: null,
                },
                cause: "permissions",
                source: "saved",
                state: "review",
                opened_at: observedAt,
                closed_at: null,
                next_attempt_at: null,
                review_reason: "idempotency_expired",
              },
            ],
          },
        },
      };
    });
    await page.goto(origin);
    await page.getByText("idempotency_expired", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Calendar monitoring" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Generation alerts" }).count(), 1);
    assert.equal(
      await page.getByText("calendar:test:action-notices:review", { exact: true }).count(),
      1,
    );
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector("section")).minWidth === "0px",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
      `no page-level horizontal overflow at ${viewport.width}px`,
    );
    assert.equal(await page.locator('a[href^="https://api.resend.com"]').count(), 0);
    await page.evaluate(() => {
      window.calendarFixture = {
        outcome: "unavailable",
        error: "Calendar assessment unavailable; previous conditions are unknown.",
      };
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Calendar assessment unavailable" }).waitFor();
    assert.equal(
      await page.getByText("idempotency_expired", { exact: true }).count(),
      0,
      "old successful report is not retained on read failure",
    );
    assert.equal(
      await page
        .getByText("No calendar condition thresholds are firing in this assessment.", {
          exact: true,
        })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("heading", { name: "Generation alerts" }).count(),
      1,
      "calendar read failure does not erase generation",
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS: actual observability dashboard at ${viewport.width}px, review/unknown and independent generation`,
    );
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (previousTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpdir;
  await rm(temporary, { recursive: true, force: true });
}
