import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const root = process.cwd();
const operationState = { calls: [], result: { data: true, error: null }, hash: "a".repeat(64) };
globalThis.__calendarRepairOperationState = operationState;
const operationBundle = await importWithMocks(
  path.join(root, "src/lib/booking-calendar-repair.server.ts"),
  {
    "@/integrations/supabase/client.server": `
    export const supabaseAdmin = { rpc: async (name, args) => {
      globalThis.__calendarRepairOperationState.calls.push({ name, args });
      return globalThis.__calendarRepairOperationState.result;
    }};`,
    "@/lib/auth/admin-session.server": `
    export async function requireAdminSessionTokenHash() {
      const value = globalThis.__calendarRepairOperationState.hash;
      if (!value) throw new Error("unauthorized");
      return value;
    }`,
  },
);
try {
  const request = new Request("https://admin.example/api/admin/calendar-repair", {
    method: "POST",
  });
  const input = {
    linkId: "3e329005-c96c-4f11-a7b9-8afdfddf21f5",
    expectedGeneration: 7,
    reason: "operator verified provider state",
  };
  await operationBundle.subject.requeueBookingCalendarManualRepair(request, input);
  assert.deepEqual(operationState.calls, [
    {
      name: "requeue_booking_calendar_manual_repair",
      args: {
        p_link_id: input.linkId,
        p_expected_generation: 7,
        p_actor_token_hash: "a".repeat(64),
        p_reason: input.reason,
      },
    },
  ]);
  assert.equal(JSON.stringify(operationState.calls).includes("obra_admin_session"), false);
  const resolution = {
    requestId: "bf21718c-d637-47a9-9c18-8185e79a5cdf",
    appointmentId: "a37c6c08-8100-4ca0-a1b3-bdaf0631e031",
    profileId: "f56c07ec-5be4-4f50-a92a-87f9a9a006ff",
    environment: "test",
    expectedVersion: 4,
    destinationEpochId: "d421fdd0-3b31-4a97-82fc-ec19e6f5ff18",
    googleEventId: "obra12345",
    source: { kind: "retained_outbox", id: "b2cb917c-4e75-4b46-a151-029f96a605f3" },
  };
  await operationBundle.subject.requeueBookingCalendarManualRepair(request, {
    expectedGeneration: 1,
    reason: "original destination evidence reviewed",
    resolution,
  });
  assert.deepEqual(operationState.calls.at(-1).args.p_resolution, resolution);
  assert.equal(operationState.calls.at(-1).args.p_link_id, null);
  operationState.hash = null;
  await assert.rejects(
    operationBundle.subject.requeueBookingCalendarManualRepair(request, input),
    (error) => error.status === 401,
  );
  assert.equal(operationState.calls.length, 2);
  operationState.hash = "a".repeat(64);
  for (const [code, status] of [
    ["42501", 401],
    ["22023", 400],
    ["P0002", 409],
    ["40001", 409],
    ["23505", 409],
    ["XX000", 500],
  ]) {
    operationState.result = { data: null, error: { code } };
    await assert.rejects(
      operationBundle.subject.requeueBookingCalendarManualRepair(request, input),
      (error) => error.status === status,
    );
  }
  operationState.result = { data: { appointmentId: resolution.appointmentId }, error: null };
  assert.deepEqual(
    await operationBundle.subject.getBookingCalendarRepairContext(
      request,
      resolution.appointmentId,
    ),
    operationState.result.data,
  );
  assert.equal(operationState.calls.at(-1).name, "get_booking_calendar_repair_context");
} finally {
  await operationBundle.cleanup();
  delete globalThis.__calendarRepairOperationState;
}

const routeState = { sameOrigin: true, calls: [], errorStatus: 0 };
globalThis.__calendarRepairRouteState = routeState;
const routeBundle = await importWithMocks(
  path.join(root, "src/routes/api/admin/calendar-repair.ts"),
  {
    "@tanstack/react-router": `
    export function createFileRoute(path) { return (definition) => {
      globalThis.__calendarRepairRouteState.path = path;
      globalThis.__calendarRepairRouteState.handler = definition.server.handlers.POST;
      globalThis.__calendarRepairRouteState.get = definition.server.handlers.GET;
      return definition;
    }}`,
    "@/lib/auth/admin-session.server": `
    export function assertAdminSameOriginMutation() {
      if (!globalThis.__calendarRepairRouteState.sameOrigin) throw new Error("forbidden");
    }`,
    "@/lib/booking-calendar-repair.server": `
    export class BookingCalendarRepairError extends Error {
      constructor(status, message) { super(message); this.status = status; }
    }
    export async function requeueBookingCalendarManualRepair(request, input) {
      globalThis.__calendarRepairRouteState.calls.push({ request, input });
      const status = globalThis.__calendarRepairRouteState.errorStatus;
      if (status) throw new BookingCalendarRepairError(status, status === 409 ? "Calendar repair state changed" : "Unauthorized");
    }
    export async function getBookingCalendarRepairContext(request, appointmentId) {
      const status=globalThis.__calendarRepairRouteState.errorStatus;
      if(status)throw new BookingCalendarRepairError(status,"Unauthorized");
      return {appointmentId};
    }`,
  },
);
try {
  const invoke = (body) =>
    routeState.handler({
      request: new Request("https://admin.example/api/admin/calendar-repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  routeState.sameOrigin = false;
  let response = await invoke({});
  assert.equal(response.status, 403);
  assert.equal(routeState.calls.length, 0);
  assert.equal(response.headers.get("cache-control"), "no-store");
  routeState.sameOrigin = true;
  response = await invoke({
    linkId: "3e329005-c96c-4f11-a7b9-8afdfddf21f5",
    expectedGeneration: 7,
    reason: "valid reason",
    actorTokenHash: "caller-controlled",
  });
  assert.equal(response.status, 400);
  assert.equal(routeState.calls.length, 0);
  response = await invoke({
    linkId: "3e329005-c96c-4f11-a7b9-8afdfddf21f5",
    expectedGeneration: 7,
    reason: "  operator verified provider state  ",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { requeued: true });
  assert.equal(routeState.calls[0].input.reason, "operator verified provider state");
  const unresolved = {
    expectedGeneration: 1,
    reason: "original reservation recovered",
    resolution: {
      requestId: "bf21718c-d637-47a9-9c18-8185e79a5cdf",
      appointmentId: "a37c6c08-8100-4ca0-a1b3-bdaf0631e031",
      profileId: "f56c07ec-5be4-4f50-a92a-87f9a9a006ff",
      environment: "test",
      expectedVersion: 4,
      destinationEpochId: "d421fdd0-3b31-4a97-82fc-ec19e6f5ff18",
      googleEventId: "obra12345",
      source: {
        kind: "original_reservation_record",
        reference: "support-case-original-reservation",
        sha256: "c".repeat(64),
        recordedAt: "2026-09-10T12:00:00Z",
        appointmentId: "a37c6c08-8100-4ca0-a1b3-bdaf0631e031",
        accountId: "apn_original",
        calendarId: "original@example.test",
      },
    },
  };
  assert.equal(
    (await invoke(unresolved)).status,
    200,
    "unresolved appointment has a reachable application mutation",
  );
  assert.deepEqual(routeState.calls.at(-1).input.resolution, unresolved.resolution);
  for (const invalid of [
    { ...unresolved, linkId: "3e329005-c96c-4f11-a7b9-8afdfddf21f5" },
    {
      ...unresolved,
      resolution: { ...unresolved.resolution, source: { kind: "current_selection" } },
    },
    { ...unresolved, resolution: { ...unresolved.resolution, expectedVersion: 0 } },
    { ...unresolved, resolution: { ...unresolved.resolution, actorTokenHash: "supplied" } },
  ])
    assert.equal((await invoke(invalid)).status, 400);
  routeState.errorStatus = 409;
  response = await invoke({
    linkId: "3e329005-c96c-4f11-a7b9-8afdfddf21f5",
    expectedGeneration: 7,
    reason: "valid reason",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Calendar repair state changed" });
  routeState.errorStatus = 401;
  const contextRequest = new Request(
    "https://admin.example/api/admin/calendar-repair?appointmentId=" +
      unresolved.resolution.appointmentId,
  );
  assert.equal((await routeState.get({ request: contextRequest })).status, 401);
  routeState.errorStatus = 0;
  response = await routeState.get({ request: contextRequest });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { appointmentId: unresolved.resolution.appointmentId });
} finally {
  await routeBundle.cleanup();
  delete globalThis.__calendarRepairRouteState;
}

// The operator action is mounted on the real admin route; exercise its component
// in Chrome with inert HTTP responses, not only a helper that has no caller.
assert.match(
  await readFile(path.join(root, "src/routes/admin.tsx"), "utf8"),
  /<AdminCalendarRepair\s*\/>/,
);
// The core API test remains runnable without a browser installation; this opt-in
// uses the same locally installed Chrome channel as the payment browser suite.
if (process.env.BOOKING_REPAIR_BROWSER_TEST === "1") {
  const browserBundle = await build({
    stdin: {
      contents:
        'import React from "react";import {createRoot} from "react-dom/client";import {AdminCalendarRepair} from "@/components/admin/AdminCalendarRepair";createRoot(document.getElementById("root")).render(<AdminCalendarRepair/>);',
      resolveDir: root,
      loader: "tsx",
    },
    write: false,
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
  });
  const browser = await chromium.launch({
    headless: true,
    channel:
      process.env.PLAYWRIGHT_CHANNEL || (process.platform === "darwin" ? "chrome" : undefined),
  });
  try {
    const page = await browser.newPage();
    const appointmentId = "a37c6c08-8100-4ca0-a1b3-bdaf0631e031";
    const posts = [];
    await page.route("https://admin.example/**", async (route) => {
      if (route.request().url().includes("/api/admin/calendar-repair")) {
        if (route.request().method() === "POST") {
          posts.push(route.request().postDataJSON());
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"requeued":true}',
          });
        } else
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              appointmentId,
              profileId: "f56c07ec-5be4-4f50-a92a-87f9a9a006ff",
              environment: "test",
              reference: "booking-reference",
              expectedVersion: 4,
              expectedGeneration: 1,
              appointmentState: "confirmed",
              calendarState: "create_failed",
              reviewState: "unresolved_destination",
              linkId: null,
              reconcileStatus: null,
              cutoverEnabled: true,
              googleEventId: "obraoriginal123",
            }),
          });
      } else
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: '<div id="root"></div>',
        });
    });
    await page.goto("https://admin.example/admin");
    await page.addScriptTag({ content: browserBundle.outputFiles[0].text });
    await page.getByLabel("Appointment ID").fill(appointmentId);
    await page.getByRole("button", { name: "Inspect booking" }).click();
    await page.getByLabel("Original destination evidence (JSON)").fill(
      JSON.stringify({
        destinationEpochId: "d421fdd0-3b31-4a97-82fc-ec19e6f5ff18",
        googleEventId: "obraoriginal123",
        source: { kind: "retained_outbox", id: "b2cb917c-4e75-4b46-a151-029f96a605f3" },
      }),
    );
    await page.getByLabel("Audit reason").fill("Original provider intent reviewed");
    await page.getByRole("button", { name: "Queue audited repair" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Repair queued for exact calendar readback" })
      .waitFor();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].resolution.appointmentId, appointmentId);
    assert.equal(posts[0].resolution.expectedVersion, 4);
    assert.equal(posts[0].expectedGeneration, 1);
    assert.match(posts[0].resolution.requestId, /^[0-9a-f-]{36}$/);
  } finally {
    await browser.close();
  }
}
console.log("test-admin-calendar-repair: passed");
