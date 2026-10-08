import assert from "node:assert/strict";
import path from "node:path";

import { importWithMocks } from "./lib/import-with-mocks.mjs";

const ownerContext = `
export const calls = [];
export async function providerOwnerContext(websiteId, providerName) {
  calls.push({ kind: "owner", websiteId, providerName });
  return {
    profile: { id: "profile-1", email: "owner@example.test" },
    website: { id: websiteId, environment: "test" },
    authUserId: "auth-1",
    supabaseAdmin: { from() { throw new Error("unexpected database call"); } },
  };
}
export async function providerMutationContext(websiteId, providerName) {
  calls.push({ kind: "mutation", websiteId, providerName });
  throw new Error("An active confirmed Pro order is required");
}
export async function hasCurrentActiveConfirmedPro() { return false; }
export async function assertNoOtherActiveProWebsiteNeedsSharedProviders() {
  throw new Error("unexpected shared-resource check while disconnect is disabled");
}
export function sharedProviderDisconnectEnabled() { return false; }
`;

const startFnMock = `
export function createServerFn() {
  return {
    validator() {
      return { handler(handler) { return ({ data }) => handler({ data }); } };
    },
  };
}
`;
const zodMock = `
const schema = {
  parse(value) { return value; },
  uuid() { return this; },
  regex() { return this; },
  int() { return this; },
  nonnegative() { return this; },
  optional() { return this; },
  nullable() { return this; },
  min() { return this; },
  max() { return this; },
  array() { return this; },
  refine() { return this; },
  extend() { return this; },
};
export const z = {
  number() { return Object.create(schema); },
  string() { return Object.create(schema); },
  object() { return Object.create(schema); },
  array() { return Object.create(schema); },
};
`;

const commonMocks = {
  "@tanstack/react-start": startFnMock,
  zod: zodMock,
  "@/lib/provider-authorization.server": ownerContext,
  "@/lib/stripe-connect.server": `
    export async function createOrReuseStripeConnectOnboarding() {
      throw new Error("unexpected onboarding call");
    }
    export async function reconcileStripeConnectAccount() {
      throw new Error("servicing path reached");
    }
    export async function createStripeExpressLoginLink() {
      throw new Error("servicing path reached");
    }
  `,
};

const stripeBundle = await importWithMocks(
  path.resolve("src/lib/stripe-connect.functions.ts"),
  commonMocks,
);
try {
  const stripe = stripeBundle.subject;
  await assert.rejects(
    stripe.startStripeConnectOnboarding({ data: { websiteId: "website-1" } }),
    /active confirmed Pro/,
  );
  await assert.rejects(
    stripe.reconcileStripeConnect({ data: { websiteId: "website-1" } }),
    /servicing path reached/,
  );
  await assert.rejects(
    stripe.openStripeExpressDashboard({ data: { websiteId: "website-1" } }),
    /servicing path reached/,
  );
} finally {
  await stripeBundle.cleanup();
}

console.log("stripe seam passed");
const googleBundle = await importWithMocks(path.resolve("src/lib/booking-provider.functions.ts"), {
  "@tanstack/react-start": startFnMock,
  "@tanstack/react-start/server": `
    export function getRequest() { throw new Error("unexpected request before authorization"); }
    export function setResponseHeader() { throw new Error("unexpected cookie before authorization"); }
  `,
  zod: zodMock,
  "@/lib/provider-authorization.server": ownerContext,
  "@/lib/pipedream.server": "export {};",
  "@/lib/google-calendar-state.server": `
    import assert from "node:assert/strict";
    export let verificationRequested = false;
    export async function googleCalendarLifetimeRpc(name, args, deadlineAt) {
      assert.equal(name, "request_google_calendar_verification");
      assert.deepEqual(args, {
        p_profile_id: "profile-1",
        p_environment: "test",
        p_actor_auth_user_id: "auth-1",
      });
      assert.ok(deadlineAt > Date.now());
      verificationRequested = true;
      return true;
    }
  `,
  "@/lib/pipedream-trigger-reconciliation.server": `
    import assert from "node:assert/strict";
    import { verificationRequested } from "@/lib/google-calendar-state.server";
    export async function refreshSavedGoogleCalendar(input) {
      assert.equal(verificationRequested, true);
      assert.equal(input.profileId, "profile-1");
      assert.equal(input.environment, "test");
      assert.equal(input.allowRepair, true);
      assert.equal(input.resumeSetup, true);
      assert.ok(input.deadlineAt > Date.now());
      assert.ok(input.deadlineAt <= Date.now() + 25_000);
      throw new Error("servicing path reached");
    }
    export async function resumeGoogleCalendarDisconnect() {
      throw new Error("unexpected disconnect servicing call while disconnect is disabled");
    }
  `,
  "@/integrations/supabase/client.server": "export const supabaseAdmin = {};",
});
try {
  const google = googleBundle.subject;
  for (const mutation of [
    () => google.startGoogleCalendarConnect({ data: { websiteId: "website-1" } }),
    () => google.discoverGoogleCalendarAccounts({ data: { websiteId: "website-1" } }),
    () =>
      google.discoverGoogleCalendars({
        data: { websiteId: "website-1", accountId: "account-1", expectedRevision: 1 },
      }),
    () =>
      google.saveGoogleCalendarSelection({
        data: {
          websiteId: "website-1",
          accountId: "account-1",
          expectedRevision: 1,
          blockingCalendarIds: ["calendar-1"],
          destinationCalendarId: "calendar-1",
        },
      }),
    () => google.configureGoogleCalendarTrigger({ data: { websiteId: "website-1" } }),
    () => google.completeGoogleCalendarConnection({ data: { websiteId: "website-1" } }),
  ]) {
    await assert.rejects(mutation(), /active confirmed Pro/);
  }
  await assert.rejects(
    google.refreshGoogleCalendarConnection({ data: { websiteId: "website-1" } }),
    /servicing path reached/,
  );
  await assert.rejects(
    google.disconnectGoogleCalendar({ data: { websiteId: "website-1" } }),
    /disconnect is disabled/,
  );
} finally {
  await googleBundle.cleanup();
}

console.log("test-provider-authorization-seams: passed");
