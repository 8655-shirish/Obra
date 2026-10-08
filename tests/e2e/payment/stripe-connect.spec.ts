import { expect, test, type Page } from "@playwright/test";

import type { StripeConnectOptions, StripeStatus } from "./mocks/stripe-connect.functions";

const WEBSITE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const STRIPE_ACTIONS = /^(Connect Stripe|Continue in Stripe|Check status|My Payments)$/;
const TEST_MISMATCH =
  "This workspace uses test payments, but this deployment uses live Stripe. Open this workspace in a matching test environment or contact support. Changing Stripe credentials does not convert existing purchases or accounts.";
const LIVE_MISMATCH =
  "This workspace uses live payments, but this deployment uses test Stripe. Open this workspace in a matching live environment or contact support. Changing Stripe credentials does not convert existing purchases or accounts.";
const BAD_CONFIG = "Stripe is not configured correctly for this deployment. Contact support.";
const READY: Partial<StripeStatus> = {
  connected: true,
  onboardingState: "ready",
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  cardPaymentsActive: true,
  snapshotFresh: true,
  lastVerifiedAt: "2030-01-01T12:00:00.000Z",
};

async function openStripe(
  page: Page,
  options: StripeConnectOptions = {},
  connect?: "return" | "refresh",
) {
  await page.addInitScript((seed) => {
    window.__stripeConnectOptions = seed;
  }, options);
  await page.goto(`/?scenario=stripe-connect${connect ? `&connect=${connect}` : ""}`);
  await expect(page.locator("#step-4").getByText(/^Step 4.*Stripe Connect$/)).toBeVisible();
  await expect(page.locator("#step-2, #step-3")).toHaveCount(0);
}

async function expectUnavailable(page: Page, message: string) {
  const card = page.locator("#step-4");
  const alert = card.getByRole("alert");
  await expect(alert.getByRole("heading")).toHaveText("Stripe setup unavailable");
  await expect(alert).toContainText(message);
  await expect(card.getByText(/^(Identity details|Card payments|Payouts):/)).toHaveCount(0);
  await expect(card.getByRole("button", { name: STRIPE_ACTIONS })).toHaveCount(0);
  await expect(card.getByText(/account is verified/)).toHaveCount(0);
  expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
    { action: "status", data: { websiteId: WEBSITE_ID } },
  ]);
  expect(await page.evaluate(() => window.__stripeConnectFixture.onChangedCalls)).toBe(0);
}

test.describe("StripeConnect", () => {
  let externalRequests: string[];
  let pageErrors: string[];

  test.beforeEach(async ({ context, page }) => {
    externalRequests = [];
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === "http://127.0.0.1:4179")
        return route.continue();
      externalRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    });
  });

  test.afterEach(() => {
    expect(externalRequests, "The isolated fixture must never call a provider").toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("waits for initial status without active actions or customer charging", async ({ page }) => {
    await openStripe(page, { statusOutcome: "pending" });
    await expect(page.getByText(/Loading Stripe status/)).toBeVisible();
    await expect(page.locator("#step-4 button:enabled")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /charge|checkout|book.*pay/i })).toHaveCount(0);
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
    ]);
    await page.evaluate(() => {
      window.__stripeConnectFixture.statusOutcome = "success";
      window.__stripeConnectFixture.resolveStatus!();
    });
    await expect(page.getByRole("button", { name: "Connect Stripe", exact: true })).toBeEnabled();
    await expect(page.getByText("Card payments: Not enabled", { exact: true })).toBeVisible();
    await expect(page.getByText("Payouts: Not enabled", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Customer charging is not enabled in this setup step/),
    ).toBeVisible();
  });

  test("reports initial status failure without enabling Stripe actions", async ({ page }) => {
    await openStripe(page, { statusOutcome: "error" });
    await expect(page.getByRole("status")).toContainText("Unable to load Stripe status");
    await expect(
      page.getByRole("button", { name: STRIPE_ACTIONS }).and(page.locator(":enabled")),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
    ]);
  });

  for (const [name, status, message] of [
    [
      "unconnected test workspace on live Stripe",
      { stripeEnvironment: "live", environmentError: TEST_MISMATCH },
      TEST_MISMATCH,
    ],
    [
      "connected live workspace on test Stripe",
      { ...READY, workspaceEnvironment: "live", environmentError: LIVE_MISMATCH },
      LIVE_MISMATCH,
    ],
    [
      "bad deployment configuration despite a previously ready account",
      { ...READY, stripeEnvironment: null, environmentError: BAD_CONFIG },
      BAD_CONFIG,
    ],
  ] as const) {
    test(`hides payment state and all Stripe controls for ${name}`, async ({ page }) => {
      await openStripe(page, { status });
      await expectUnavailable(page, message);
      expect(await page.evaluate(() => window.__stripeConnectFixture.onConnectConsumedCalls)).toBe(
        0,
      );
    });
  }

  for (const [environment, connected, label] of [
    ["test", false, "Connect Stripe"],
    ["live", false, "Connect Stripe"],
    ["test", true, "Continue in Stripe"],
  ] as const) {
    test(`${environment}/${environment} Pro uses ${label} without charging`, async ({ page }) => {
      await openStripe(page, {
        status: {
          workspaceEnvironment: environment,
          stripeEnvironment: environment,
          connected,
          onboardingState: connected ? "pending" : "not_started",
        },
      });
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByText(/Direct charges with no Obra application fee/)).toBeVisible();
      await expect(
        page.getByText(/Customer charging is not enabled in this setup step/),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "My Payments", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(/\?scenario=stripe-connect#stripe-onboarding$/);
      expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
        { action: "status", data: { websiteId: WEBSITE_ID } },
        {
          action: "onboarding",
          data: { websiteId: WEBSITE_ID, returnPath: `/user/${USER_ID}?websiteId=${WEBSITE_ID}` },
        },
      ]);
      expect(await page.evaluate(() => window.__stripeConnectFixture.onChangedCalls)).toBe(0);
    });
  }

  test("a matched ready account exposes verification and My Payments, not onboarding", async ({
    page,
  }) => {
    await openStripe(page, { status: READY });
    await expect(page.getByText(/account is verified for card payments and payouts/)).toBeVisible();
    await expect(page.getByText("Card payments: Enabled", { exact: true })).toBeVisible();
    await expect(page.getByText("Payouts: Enabled", { exact: true })).toBeVisible();
    await expect(page.locator("#step-4 button")).toHaveText(["Check status", "My Payments"]);
    await page.getByRole("button", { name: "My Payments", exact: true }).click();
    await expect(page).toHaveURL(/#stripe-dashboard$/);
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
      { action: "dashboard", data: { websiteId: WEBSITE_ID } },
    ]);
  });

  test("old subscription retains existing-account controls and known status through check failure and retry", async ({
    page,
  }) => {
    await openStripe(page, {
      hasPro: false,
      status: { ...READY, onboardingState: "pending", chargesEnabled: false },
    });
    await expect(page.locator("#step-4 button")).toHaveText(["Check status", "My Payments"]);
    await page.evaluate(() => {
      window.__stripeConnectFixture.verifyOutcome = "pending";
    });
    await page.getByRole("button", { name: "Check status", exact: true }).click();
    await expect(page.locator("#step-4 button:enabled")).toHaveCount(0);
    await page.evaluate(() => window.__stripeConnectFixture.updateProps!({}));
    await expect(page.getByText("Card payments: Not enabled", { exact: true })).toBeVisible();
    await expect(page.getByText("Payouts: Enabled", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.__stripeConnectFixture.verifyOutcome = "error";
      window.__stripeConnectFixture.resolveVerify!();
    });
    await expect(page.getByRole("status")).toHaveText(
      "Unable to verify Stripe status. Please try again.",
    );
    await expect(page.getByText("Payouts: Enabled", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "My Payments", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__stripeConnectFixture.onChangedCalls)).toBe(0);
    await page.evaluate((ready) => {
      const fixture = window.__stripeConnectFixture;
      fixture.verifyOutcome = "success";
      fixture.verifyStatus = { ...fixture.status, ...ready };
    }, READY);
    await page.getByRole("button", { name: "Check status", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Stripe verified. Payments setup is ready.");
    expect(await page.evaluate(() => window.__stripeConnectFixture.onChangedCalls)).toBe(1);
    expect(
      await page.evaluate(() => window.__stripeConnectFixture.requests.map(({ action }) => action)),
    ).toEqual(["status", "verify", "verify"]);
  });

  test("prerequisite locks prevent status loads and actions until unlocked", async ({ page }) => {
    await openStripe(page, { locked: true, statusOutcome: "pending" });
    await expect(page.locator("#step-4")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Connect a calendar and save availability first.")).toBeVisible();
    await expect(page.locator("#step-4 button")).toHaveCount(0);
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([]);
    await page.evaluate(() => window.__stripeConnectFixture.updateProps!({ locked: false }));
    await expect(page.getByText(/Loading Stripe status/)).toBeVisible();
    await expect(page.locator("#step-4 button:enabled")).toHaveCount(0);
    await page.evaluate(() => {
      window.__stripeConnectFixture.statusOutcome = "success";
      window.__stripeConnectFixture.resolveStatus!();
    });
    await expect(page.getByRole("button", { name: "Connect Stripe", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
    ]);
  });

  for (const marker of ["return", "refresh"] as const) {
    test(`${marker} waits for status and is consumed without actions on mismatch`, async ({
      page,
    }) => {
      await openStripe(
        page,
        {
          statusOutcome: "pending",
          status: { ...READY, stripeEnvironment: "live", environmentError: TEST_MISMATCH },
        },
        marker,
      );
      await expect(page.getByText(/Loading Stripe status/)).toBeVisible();
      await expect(page.locator("#step-4 button:enabled")).toHaveCount(0);
      expect(await page.evaluate(() => window.__stripeConnectFixture.onConnectConsumedCalls)).toBe(
        0,
      );
      expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
        { action: "status", data: { websiteId: WEBSITE_ID } },
      ]);
      await page.evaluate(() => {
        window.__stripeConnectFixture.statusOutcome = "success";
        window.__stripeConnectFixture.resolveStatus!();
      });
      await expectUnavailable(page, TEST_MISMATCH);
      await expect(page).toHaveURL(/\?scenario=stripe-connect$/);
      await page.evaluate(() => window.__stripeConnectFixture.updateProps!({}));
      expect(await page.evaluate(() => window.__stripeConnectFixture.onConnectConsumedCalls)).toBe(
        1,
      );
      await expectUnavailable(page, TEST_MISMATCH);
    });
  }

  test("matched return waits for status, verifies exactly once, and consumes after completion", async ({
    page,
  }) => {
    await openStripe(page, { statusOutcome: "pending", status: { connected: true } }, "return");
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
    ]);
    expect(await page.evaluate(() => window.__stripeConnectFixture.onConnectConsumedCalls)).toBe(0);
    await page.evaluate((ready) => {
      const fixture = window.__stripeConnectFixture;
      fixture.verifyOutcome = "pending";
      fixture.verifyStatus = { ...fixture.status, ...ready };
      fixture.statusOutcome = "success";
      fixture.resolveStatus!();
    }, READY);
    await expect(page.getByRole("button", { name: /^Checking/ })).toBeDisabled();
    await expect(page.locator("#step-4 button:enabled")).toHaveCount(0);
    await page.evaluate(() => window.__stripeConnectFixture.updateProps!({}));
    expect(await page.evaluate(() => window.__stripeConnectFixture.onChangedCalls)).toBe(0);
    expect(await page.evaluate(() => window.__stripeConnectFixture.onConnectConsumedCalls)).toBe(0);
    await page.evaluate(() => {
      window.__stripeConnectFixture.verifyOutcome = "success";
      window.__stripeConnectFixture.resolveVerify!();
    });
    await expect(page.getByRole("status")).toHaveText("Stripe verified. Payments setup is ready.");
    await expect(page).toHaveURL(/\?scenario=stripe-connect$/);
    await page.evaluate(() => window.__stripeConnectFixture.updateProps!({}));
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
      { action: "verify", data: { websiteId: WEBSITE_ID } },
    ]);
    expect(await page.evaluate(() => window.__stripeConnectFixture.onChangedCalls)).toBe(1);
    expect(await page.evaluate(() => window.__stripeConnectFixture.onConnectConsumedCalls)).toBe(1);
  });

  test("matched refresh waits for status then starts onboarding exactly once on the fixture URL", async ({
    page,
  }) => {
    await openStripe(page, { statusOutcome: "pending" }, "refresh");
    await expect(page.locator("#step-4 button:enabled")).toHaveCount(0);
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
    ]);
    await page.evaluate(() => {
      window.__stripeConnectFixture.statusOutcome = "success";
      window.__stripeConnectFixture.resolveStatus!();
    });
    await expect(page).toHaveURL(/#stripe-onboarding$/);
    await page.evaluate(() => window.__stripeConnectFixture.updateProps!({}));
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
      {
        action: "onboarding",
        data: { websiteId: WEBSITE_ID, returnPath: `/user/${USER_ID}?websiteId=${WEBSITE_ID}` },
      },
    ]);
    expect(await page.evaluate(() => window.__stripeConnectFixture.onChangedCalls)).toBe(0);
  });

  test("a website switch cannot authorize a return marker using the previous website status", async ({
    page,
  }) => {
    await openStripe(page, { status: READY });
    await expect(page.getByRole("button", { name: "My Payments", exact: true })).toBeEnabled();
    const nextWebsiteId = "33333333-3333-4333-8333-333333333333";
    await page.evaluate(
      ({ websiteId, error }) => {
        const fixture = window.__stripeConnectFixture;
        fixture.status = {
          ...fixture.status,
          workspaceEnvironment: "live",
          environmentError: error,
          canOnboard: false,
        };
        fixture.statusOutcome = "pending";
        fixture.updateProps!({ websiteId, connect: "return" });
      },
      { websiteId: nextWebsiteId, error: LIVE_MISMATCH },
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__stripeConnectFixture.requests.filter(({ action }) => action === "status")
              .length,
        ),
      )
      .toBe(2);
    expect(await page.evaluate(() => window.__stripeConnectFixture.requests)).toEqual([
      { action: "status", data: { websiteId: WEBSITE_ID } },
      { action: "status", data: { websiteId: nextWebsiteId } },
    ]);
    await expect(page.getByText(/Loading Stripe status/)).toBeVisible();
    await expect(page.locator("#step-4 button:enabled")).toHaveCount(0);
    expect(await page.evaluate(() => window.__stripeConnectFixture.onConnectConsumedCalls)).toBe(0);
    await page.evaluate(() => {
      window.__stripeConnectFixture.statusOutcome = "success";
      window.__stripeConnectFixture.resolveStatus!();
    });
    await expect(page.getByRole("alert")).toContainText(LIVE_MISMATCH);
    await expect
      .poll(() => page.evaluate(() => window.__stripeConnectFixture.onConnectConsumedCalls))
      .toBe(1);
    expect(await page.evaluate(() => window.__stripeConnectFixture.onChangedCalls)).toBe(0);
    expect(
      await page.evaluate(() => window.__stripeConnectFixture.requests.map(({ action }) => action)),
    ).toEqual(["status", "status"]);
  });
});
