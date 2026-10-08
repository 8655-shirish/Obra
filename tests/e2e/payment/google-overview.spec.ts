import { expect, test, type Page } from "@playwright/test";
import type { GoogleOverviewOptions } from "./mocks/google-overview.functions";

const WEBSITE_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_WEBSITE_ID = "33333333-3333-4333-8333-333333333333";
const NEXT_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const OVERVIEW_URL = `/user/${PROFILE_ID}?websiteId=${WEBSITE_ID}`;
const READY_STRIPE = {
  connected: true,
  onboardingState: "ready" as const,
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  cardPaymentsActive: true,
  snapshotFresh: true,
};

async function openOverview(
  page: Page,
  options: GoogleOverviewOptions = {},
  marker?: "success" | "error",
) {
  await page.addInitScript(
    ({ options, stripe }) => {
      window.__googleOverviewOptions = options;
      window.__stripeConnectOptions = { status: stripe };
    },
    { options, stripe: READY_STRIPE },
  );
  await page.goto(`${OVERVIEW_URL}${marker ? `&connect=${marker}` : ""}`);
}

async function expectSavedSetup(page: Page) {
  await expect(page.getByLabel("Service name", { exact: true })).toHaveValue("Saved consultation");
  await expect(page.getByLabel("Price per booking (USD)", { exact: true })).toHaveValue("125.50");
  await expect(page.locator("#step-3")).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#step-4")).not.toHaveAttribute("aria-disabled", "true");
  await expect(
    page.locator("#step-4").getByRole("button", { name: "My Payments", exact: true }),
  ).toBeEnabled();
}

async function actions(page: Page) {
  return page.evaluate(() => window.__googleOverviewFixture.requests.map(({ action }) => action));
}

async function switchWorkspace(page: Page, profile = PROFILE_ID) {
  await page.evaluate(
    ({ websiteId, profileId }) => {
      const fixture = window.__googleOverviewFixture;
      fixture.overview.website.id = websiteId;
      fixture.overview.profile!.id = profileId;
      fixture.overview.profile!.businessName = "Next Fixture Business";
      fixture.overview.readiness.websiteId = websiteId;
      fixture.overview.readiness.profileId = profileId;
      fixture.overview.readiness.environment = "live";
      fixture.overview.readiness.calendarAccountEmail = "next@example.test";
      fixture.configuration.accountEmail = "next@example.test";
      fixture.outcomes.overview = "success";
      fixture.outcomes.configuration = "success";
      fixture.updateProps!({ websiteId, userId: profileId, connect: undefined });
    },
    { websiteId: NEXT_WEBSITE_ID, profileId: profile },
  );
  await expect(page.getByRole("heading", { name: "Next Fixture Business" })).toBeVisible();
  await expect(
    page.locator("#step-2").getByText("next@example.test", { exact: true }),
  ).toBeVisible();
}

test.describe("Google purchaser overview (mocked server boundaries, not live E2E)", () => {
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
    expect(externalRequests, "This fixture must never call a provider, database or cron").toEqual(
      [],
    );
    expect(pageErrors).toEqual([]);
  });

  test("fresh reload shows the saved identity without starting or completing OAuth", async ({
    page,
  }) => {
    await openOverview(page);
    for (let attempt = 0; attempt < 2; attempt++) {
      const card = page.locator("#step-2");
      await expect(card.getByText("Connected", { exact: true })).toBeVisible();
      await expect(card.getByText("Calendar checks current", { exact: true })).toBeVisible();
      await expect(card.getByText("owner@example.test", { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Reconnect Google", exact: true })).toHaveCount(
        0,
      );
      await expectSavedSetup(page);
      expect(await actions(page)).toEqual(["overview", "configuration", "availability"]);
      if (attempt === 0) await page.reload();
    }
  });

  test("fresh saved identity does not require an account email to remain configured", async ({
    page,
  }) => {
    await openOverview(page, { accountEmail: null });
    await expect(page.locator("#step-2").getByText("Connected", { exact: true })).toBeVisible();
    await expect(
      page.locator("#step-2").getByText("Calendar checks current", { exact: true }),
    ).toBeVisible();
    await expectSavedSetup(page);
    await expect(
      page.locator("#step-2").getByRole("button", { name: "Connect Google Calendar", exact: true }),
    ).toHaveCount(0);
  });

  for (const [name, connection, label] of [
    [
      "stale evidence",
      { lastVerifiedAt: "2000-01-01T00:00:00Z", lastHealthAt: "2000-01-01T00:00:00Z" },
      "Checking connection",
    ],
    ["degraded trigger", { triggerState: "degraded" }, "Monitoring repair"],
    ["missing trigger", { triggerState: null }, "Monitoring repair"],
    [
      "temporary failure",
      { healthState: "degraded", reason: "provider_temporary_failure" },
      "Temporarily unavailable",
    ],
    [
      "legacy unhealthy account",
      {
        healthState: "disconnected",
        reason: "provider_account_unhealthy",
        reconnectReason: "provider_account_unhealthy",
      },
      "Temporarily unavailable",
    ],
    [
      "platform configuration failure",
      { healthState: "degraded", reason: "provider_configuration_error" },
      "Calendar service issue",
    ],
    [
      "calendar permissions changed",
      { healthState: "degraded", reason: "calendar_permissions_changed" },
      "Calendar access needs attention",
    ],
    [
      "booking writes blocked",
      { healthState: "degraded", reason: "calendar_write_blocked" },
      "Calendar access needs attention",
    ],
  ] as const) {
    test(`${name} preserves setup and offers the correct remedy, not revoked consent`, async ({
      page,
    }) => {
      await openOverview(page, { connection });
      const card = page.locator("#step-2");
      await expect(card.getByText(label, { exact: true })).toBeVisible();
      await expect(card.getByText("Connected", { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Check status", exact: true })).toBeEnabled();
      await expect(card.getByRole("button", { name: "Reconnect Google", exact: true })).toHaveCount(
        0,
      );
      await expect(card.getByText(/last successful|last verified/i)).toHaveCount(0);
      await expectSavedSetup(page);
      expect(
        await page.evaluate(
          () => window.__googleOverviewFixture.overview.readiness.bookingAdmission,
        ),
      ).toBe(false);
      expect(
        (await actions(page)).filter((action) =>
          ["connect", "complete", "check", "discover", "save"].includes(action),
        ),
      ).toEqual([]);
    });
  }

  test("explicit reauthorization is the only saved-account reconnect remedy", async ({ page }) => {
    await openOverview(page, {
      connection: { healthState: "disconnected", reason: "provider_reauthorization_required" },
    });
    const card = page.locator("#step-2");
    await expect(card.getByText("Reconnect required", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Reconnect Google", exact: true })).toBeEnabled();
    await expectSavedSetup(page);
    expect(await actions(page)).not.toContain("connect");
    await card.getByRole("button", { name: "Reconnect Google", exact: true }).click();
    await expect(page).toHaveURL(/#mock-google-connect$/);
    expect(
      await page.evaluate(
        () =>
          window.__googleOverviewFixture.requests.find(({ action }) => action === "connect")?.data,
      ),
    ).toEqual({
      websiteId: WEBSITE_ID,
      returnPath: OVERVIEW_URL,
    });
  });

  test("explicit disconnect is respected even if a saved identity remains", async ({ page }) => {
    await openOverview(page, {
      connection: {
        healthState: "disconnected",
        reason: "provider_temporary_failure",
        reconnectReason: "contractor_disconnected",
      },
    });
    const card = page.locator("#step-2");
    await expect(card.getByText("Disconnected", { exact: true })).toBeVisible();
    await expect(card.getByText(/Automatic checks will not reconnect/)).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Connect Google Calendar", exact: true }),
    ).toBeEnabled();
    await expect(
      card.getByRole("button", { name: /Check status|Reconnect Google|Review calendars/ }),
    ).toHaveCount(0);
    await expect(card.getByText("Next check due", { exact: true })).toHaveCount(0);
    await expectSavedSetup(page);
    expect(await actions(page)).not.toContain("complete");
  });

  test("missing selection does not unlock an unsaved availability or Stripe step", async ({
    page,
  }) => {
    await openOverview(page, {
      selections: [],
      availabilityConfigured: false,
      payments: "not_configured",
    });
    await expect(
      page.locator("#step-2").getByText("Choose calendars", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("#step-2").getByRole("button", { name: "Review calendars", exact: true }),
    ).toBeEnabled();
    await expect(
      page.locator("#step-2").getByRole("button", { name: "Reconnect Google", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("#step-3")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("#step-4")).toHaveAttribute("aria-disabled", "true");
    expect(await actions(page)).toEqual(["overview", "configuration"]);
  });

  test("missing identity asks for connection, not assumed completion from email", async ({
    page,
  }) => {
    await openOverview(page, {
      accountId: null,
      selections: [],
      availabilityConfigured: false,
      payments: "not_configured",
    });
    await expect(page.locator("#step-2").getByText("Not connected", { exact: true })).toBeVisible();
    await expect(
      page.locator("#step-2").getByRole("button", { name: "Connect Google Calendar", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("#step-3")).toHaveAttribute("aria-disabled", "true");
    expect(await actions(page)).not.toContain("connect");
  });

  test("configured stale permissions stay configured and do not erase forms", async ({ page }) => {
    await openOverview(page, {
      selections: [
        {
          active: true,
          blocks_availability: true,
          receives_bookings: true,
          access_role: "owner",
          permission_verified_at: "2000-01-01T00:00:00Z",
        },
      ],
    });
    await expect(
      page.locator("#step-2").getByText("Checking connection", { exact: true }),
    ).toBeVisible();
    await expectSavedSetup(page);
    expect(
      await page.evaluate(() => window.__googleOverviewFixture.overview.readiness.reasonCodes),
    ).toContain("google_selection_permissions_stale");
  });

  test("owner review retains the full selected set and only saves after explicit action", async ({
    page,
  }) => {
    await openOverview(page, {
      connection: { reason: "calendar_permissions_changed", healthState: "degraded" },
    });
    const card = page.locator("#step-2");
    await card.getByRole("button", { name: "Review calendars", exact: true }).click();
    await expect(card.getByRole("checkbox", { name: "Work calendar", exact: true })).toBeChecked();
    await expect(
      card.getByRole("checkbox", { name: "Team calendar", exact: true }),
    ).not.toBeChecked();
    await expect(
      card.getByRole("combobox", { name: "Booking destination", exact: true }),
    ).toHaveValue("calendar-0");
    expect(await actions(page)).not.toContain("save");
    await card.getByRole("checkbox", { name: "Team calendar", exact: true }).check();
    await card.getByRole("button", { name: "Save calendars", exact: true }).click();
    await expect(card.getByRole("group", { name: "Selected calendars" })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.__googleOverviewFixture.requests.find(({ action }) => action === "save")?.data,
      ),
    ).toEqual({
      websiteId: WEBSITE_ID,
      accountId: "apn_saved_owner",
      expectedRevision: 4,
      blockingCalendarIds: ["calendar-0", "calendar-1"],
      destinationCalendarId: "calendar-0",
    });
    expect(await actions(page)).not.toContain("complete");
  });

  test("status check uses the refresh action then reloads facts without OAuth or form loss", async ({
    page,
  }) => {
    await openOverview(page, {
      connection: { healthState: "degraded", reason: "provider_temporary_failure" },
      outcomes: { check: "pending" },
    });
    await expectSavedSetup(page);
    await page.getByLabel("Service name", { exact: true }).fill("Unsaved consultation edit");
    await page
      .locator("#step-2")
      .getByRole("button", { name: "Check status", exact: true })
      .click();
    await expect(
      page.locator("#step-2").getByRole("button", { name: "Checking...", exact: true }),
    ).toBeDisabled();
    expect((await actions(page)).filter((action) => action === "overview")).toHaveLength(1);
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.overview.readiness.calendar = "ready";
      fixture.overview.readiness.calendarConnection = {
        ...fixture.overview.readiness.calendarConnection,
        healthState: "healthy",
        reason: null,
        reconnectReason: null,
      };
      fixture.pending.find(({ action }) => action === "check")!.resolve();
    });
    await expect(
      page.locator("#step-2").getByText("Calendar checks current", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Service name", { exact: true })).toHaveValue(
      "Unsaved consultation edit",
    );
    expect(await actions(page)).toEqual([
      "overview",
      "configuration",
      "availability",
      "check",
      "overview",
      "configuration",
    ]);
  });

  for (const sameAccount of [false, true]) {
    test(`${sameAccount ? "same-account reselection" : "account B polling"} conflicts with editor A without losing unsaved edits`, async ({
      page,
    }) => {
      await openOverview(page);
      const card = page.locator("#step-2");
      await card.getByRole("button", { name: "Review calendars", exact: true }).click();
      await card.getByRole("checkbox", { name: "Team calendar", exact: true }).check();
      await page.getByLabel("Service name", { exact: true }).fill("Keep my availability edit");
      await page.evaluate((sameAccount) => {
        const fixture = window.__googleOverviewFixture;
        const accountId = sameAccount ? "apn_saved_owner" : "apn_B";
        fixture.overview.readiness.calendarConnection.accountId = accountId;
        fixture.overview.readiness.calendarConnection.connectionRevision = 5;
        fixture.overview.readiness.calendarAccountEmail = sameAccount
          ? "owner@example.test"
          : "account-b@example.test";
        fixture.configuration.accountId = accountId;
        fixture.configuration.accountEmail = fixture.overview.readiness.calendarAccountEmail;
        fixture.configuration.connectionRevision = 5;
        fixture.configuration.blockingCalendarIds = ["calendar-0"];
        fixture.outcomes.configuration = "pending";
        window.dispatchEvent(new Event("focus"));
      }, sameAccount);
      await expect(card.getByRole("alert")).toContainText("Your unsaved choices");
      await expect(
        card.getByRole("button", { name: "Save calendars", exact: true }),
      ).toBeDisabled();
      await expect(
        card.getByRole("button", { name: "Review calendars", exact: true }),
      ).toBeDisabled();
      if (!sameAccount)
        await expect(card.getByText("account-b@example.test", { exact: true })).toBeVisible();
      await expect(
        card.getByRole("checkbox", { name: "Team calendar", exact: true }),
      ).toBeChecked();
      expect((await actions(page)).filter((action) => action === "discover")).toHaveLength(1);
      expect(await actions(page)).not.toContain("save");
      await expect
        .poll(() => page.evaluate(() => window.__googleOverviewFixture.pending.length))
        .toBe(1);
      await page.evaluate(() => {
        const fixture = window.__googleOverviewFixture;
        fixture.outcomes.configuration = "success";
        fixture.pending.find(({ action }) => action === "configuration")!.resolve();
      });
      await expect(
        card.getByRole("button", { name: "Review calendars", exact: true }),
      ).toBeEnabled();
      await expect(
        card.getByRole("button", { name: "Save calendars", exact: true }),
      ).toBeDisabled();
      await expect(
        card.getByRole("checkbox", { name: "Team calendar", exact: true }),
      ).toBeChecked();
      await expect(page.getByLabel("Service name", { exact: true })).toHaveValue(
        "Keep my availability edit",
      );
      page.once("dialog", (dialog) => dialog.dismiss());
      await card.getByRole("button", { name: "Review calendars", exact: true }).click();
      await expect(
        card.getByRole("checkbox", { name: "Team calendar", exact: true }),
      ).toBeChecked();
      expect((await actions(page)).filter((action) => action === "discover")).toHaveLength(1);
      page.once("dialog", (dialog) => dialog.accept());
      await card.getByRole("button", { name: "Review calendars", exact: true }).click();
      await expect(card.getByRole("alert")).toHaveCount(0);
      await expect(
        card.getByRole("checkbox", { name: "Team calendar", exact: true }),
      ).not.toBeChecked();
      await card.getByRole("button", { name: "Save calendars", exact: true }).click();
      await expect(card.getByRole("group", { name: "Selected calendars" })).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          window.__googleOverviewFixture.requests
            .filter(({ action }) => action === "discover" || action === "save")
            .map(({ action, data }) => ({
              action,
              accountId: data.accountId,
              expectedRevision: data.expectedRevision,
            })),
        ),
      ).toEqual([
        { action: "discover", accountId: "apn_saved_owner", expectedRevision: 4 },
        {
          action: "discover",
          accountId: sameAccount ? "apn_saved_owner" : "apn_B",
          expectedRevision: 5,
        },
        {
          action: "save",
          accountId: sameAccount ? "apn_saved_owner" : "apn_B",
          expectedRevision: 5,
        },
      ]);
    });
  }

  test("account identity changes reload and guard selectors even with the same revision", async ({
    page,
  }) => {
    await openOverview(page);
    const card = page.locator("#step-2");
    await expect(card.getByRole("button", { name: "Review calendars", exact: true })).toBeEnabled();
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.overview.readiness.calendarConnection.accountId = "apn_B";
      fixture.overview.readiness.calendarAccountEmail = "account-b@example.test";
      fixture.configuration.accountId = "apn_B";
      fixture.configuration.accountEmail = "account-b@example.test";
      fixture.outcomes.configuration = "pending";
      window.dispatchEvent(new Event("focus"));
    });
    await expect(card.getByText("account-b@example.test", { exact: true })).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Review calendars", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => window.__googleOverviewFixture.pending.length))
      .toBe(1);
    await page.evaluate(() => window.__googleOverviewFixture.pending[0].resolve());
    await card.getByRole("button", { name: "Review calendars", exact: true }).click();
    expect(
      await page.evaluate(
        () =>
          window.__googleOverviewFixture.requests.find(({ action }) => action === "discover")?.data,
      ),
    ).toEqual({ websiteId: WEBSITE_ID, accountId: "apn_B", expectedRevision: 4 });
  });

  test("a stale view submits its own revision and a rejected save preserves the form", async ({
    page,
  }) => {
    await openOverview(page);
    const card = page.locator("#step-2");
    await card.getByRole("button", { name: "Review calendars", exact: true }).click();
    await card.getByRole("checkbox", { name: "Team calendar", exact: true }).check();
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.configuration.accountId = "apn_B";
      fixture.configuration.connectionRevision = 5;
      fixture.configuration.accountEmail = "account-b@example.test";
      fixture.overview.readiness.calendarConnection.accountId = "apn_B";
      fixture.overview.readiness.calendarConnection.connectionRevision = 5;
      fixture.overview.readiness.calendarAccountEmail = "account-b@example.test";
      // No overview read: this tab has not observed the concurrent save yet.
    });
    await card.getByRole("button", { name: "Save calendars", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("Your unsaved choices");
    await expect(card.getByText(/Unable to save these calendars/)).toBeVisible();
    await expect(card.getByText("account-b@example.test", { exact: true })).toBeVisible();
    await expect(card.getByRole("checkbox", { name: "Team calendar", exact: true })).toBeChecked();
    await expect(card.getByRole("button", { name: "Save calendars", exact: true })).toBeDisabled();
    expect(
      await page.evaluate(
        () => window.__googleOverviewFixture.requests.find(({ action }) => action === "save")?.data,
      ),
    ).toEqual({
      websiteId: WEBSITE_ID,
      accountId: "apn_saved_owner",
      expectedRevision: 4,
      blockingCalendarIds: ["calendar-0", "calendar-1"],
      destinationCalendarId: "calendar-0",
    });
    expect(await page.evaluate(() => window.__googleOverviewFixture.configuration.accountId)).toBe(
      "apn_B",
    );
  });

  test("late configuration A cannot replace B after a newer revision has rendered", async ({
    page,
  }) => {
    await openOverview(page, { outcomes: { configuration: "pending" } });
    const card = page.locator("#step-2");
    await expect
      .poll(() => page.evaluate(() => window.__googleOverviewFixture.pending.length))
      .toBe(1);
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.configuration.accountId = "apn_B";
      fixture.configuration.connectionRevision = 5;
      fixture.configuration.accountEmail = "account-b@example.test";
      fixture.overview.readiness.calendarConnection.accountId = "apn_B";
      fixture.overview.readiness.calendarConnection.connectionRevision = 5;
      fixture.overview.readiness.calendarAccountEmail = "account-b@example.test";
      fixture.outcomes.configuration = "success";
      window.dispatchEvent(new Event("focus"));
    });
    await expect(card.getByText("account-b@example.test", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Review calendars", exact: true })).toBeEnabled();
    await page.evaluate(() => window.__googleOverviewFixture.pending[0].resolve());
    await card.getByRole("button", { name: "Review calendars", exact: true }).click();
    expect(
      await page.evaluate(
        () =>
          window.__googleOverviewFixture.requests.find(({ action }) => action === "discover")?.data,
      ),
    ).toEqual({ websiteId: WEBSITE_ID, accountId: "apn_B", expectedRevision: 5 });
  });

  test("a successful but late discovery cannot open selectors for the superseded revision", async ({
    page,
  }) => {
    await openOverview(page, { outcomes: { discover: "pending" } });
    const card = page.locator("#step-2");
    await card.getByRole("button", { name: "Review calendars", exact: true }).click();
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.overview.readiness.calendarConnection.connectionRevision = 5;
      window.dispatchEvent(new Event("focus"));
    });
    await expect(card.getByText(/Calendar configuration changed/)).toBeVisible();
    // The held server response still has A's successful discovery; the view fence must reject it.
    await page.evaluate(() => window.__googleOverviewFixture.pending[0].resolve());
    await expect(card.getByText(/Review the current calendars again/)).toBeVisible();
    await expect(card.getByRole("group", { name: "Selected calendars" })).toHaveCount(0);
    expect(await actions(page)).not.toContain("save");
  });

  test("loss of Pro authorization leaves unsaved calendar choices visible but unwriteable", async ({
    page,
  }) => {
    await openOverview(page);
    const card = page.locator("#step-2");
    await card.getByRole("button", { name: "Review calendars", exact: true }).click();
    await card.getByRole("checkbox", { name: "Team calendar", exact: true }).check();
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.overview.readiness.entitlementUnavailable = true;
      fixture.overview.readiness.bookingAdmission = false;
      fixture.configuration.canConfigure = false;
      window.dispatchEvent(new Event("focus"));
    });
    await expect(card.getByText(/active confirmed Pro order is required/)).toBeVisible();
    await expect(card.getByRole("checkbox", { name: "Team calendar", exact: true })).toBeChecked();
    await expect(card.getByRole("button", { name: "Save calendars", exact: true })).toBeDisabled();
    await expect(card.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
    expect(await actions(page)).not.toContain("save");
  });

  for (const action of ["check", "complete"] as const) {
    for (const failedRead of [false, true]) {
      test(`failed ${action} after healthy shows ${failedRead ? "unknown when facts cannot be read" : "persisted revoked consent"} and keeps both unsaved forms`, async ({
        page,
      }) => {
        await page.clock.install();
        await openOverview(page);
        const card = page.locator("#step-2");
        await expectSavedSetup(page);
        await card.getByRole("button", { name: "Review calendars", exact: true }).click();
        await card.getByRole("checkbox", { name: "Team calendar", exact: true }).check();
        await page
          .getByLabel("Service name", { exact: true })
          .fill("Preserve after failed verification");
        await page.evaluate((action) => {
          const fixture = window.__googleOverviewFixture;
          fixture.outcomes[action] = "pending";
          if (action === "complete") fixture.updateProps!({ connect: "success" });
        }, action);
        if (action === "check")
          await card.getByRole("button", { name: "Check status", exact: true }).click();
        await expect
          .poll(() =>
            page.evaluate(
              (action) =>
                window.__googleOverviewFixture.pending.some((entry) => entry.action === action),
              action,
            ),
          )
          .toBe(true);
        await page.evaluate(
          ({ action, failedRead }) => {
            const fixture = window.__googleOverviewFixture;
            fixture.overview.readiness.calendar = "restricted";
            fixture.overview.readiness.bookingAdmission = false;
            fixture.overview.readiness.calendarConnection.healthState = "disconnected";
            fixture.overview.readiness.calendarConnection.reason =
              "provider_reauthorization_required";
            fixture.overview.readiness.calendarConnection.reconnectReason =
              "provider_reauthorization_required";
            if (failedRead) {
              fixture.outcomes.overview = "error";
              fixture.outcomes.configuration = "error";
            }
            fixture.pending.find((entry) => entry.action === action)!.reject();
          },
          { action, failedRead },
        );
        await expect(card).toHaveAttribute("aria-busy", "false");
        await expect(card.getByText("Calendar checks current", { exact: true })).toHaveCount(0);
        await expect(
          card.getByText(failedRead ? "Status unknown" : "Reconnect required", { exact: true }),
        ).toBeVisible();
        await expect(
          card.getByRole("checkbox", { name: "Team calendar", exact: true }),
        ).toBeChecked();
        await expect(
          card.getByRole("button", { name: "Save calendars", exact: true }),
        ).toBeDisabled();
        await expect(page.getByLabel("Service name", { exact: true })).toHaveValue(
          "Preserve after failed verification",
        );
        await expect(
          page.locator("#step-4").getByRole("button", { name: "My Payments", exact: true }),
        ).toBeEnabled();
        expect((await actions(page)).filter((entry) => entry === "overview")).toHaveLength(2);
        expect((await actions(page)).filter((entry) => entry === "configuration")).toHaveLength(2);
        if (failedRead) {
          await expect(card.getByText("Connected", { exact: true })).toHaveCount(0);
          await page.evaluate(() => {
            window.__googleOverviewFixture.outcomes.overview = "success";
            window.__googleOverviewFixture.outcomes.configuration = "success";
          });
          await page.clock.fastForward(10_010);
          await expect(card.getByText("Reconnect required", { exact: true })).toBeVisible();
          expect((await actions(page)).filter((entry) => entry === "overview")).toHaveLength(3);
        } else {
          await expect(
            card.getByRole("button", { name: "Reconnect Google", exact: true }),
          ).toBeEnabled();
        }
        expect((await actions(page)).filter((entry) => entry === action)).toHaveLength(1);
        expect(await actions(page)).not.toContain("connect");
        expect(await actions(page)).not.toContain("save");
      });
    }
  }

  test("failed display and check refreshes retain the saved setup and can retry", async ({
    page,
  }) => {
    await openOverview(page, {
      connection: { reason: "provider_temporary_failure", healthState: "degraded" },
      outcomes: { check: "error" },
    });
    await expectSavedSetup(page);
    await page
      .locator("#step-2")
      .getByRole("button", { name: "Check status", exact: true })
      .click();
    await expect(
      page.locator("#step-2").getByText(/Unable to check Google Calendar right now/),
    ).toBeVisible();
    await page.evaluate(() => {
      window.__googleOverviewFixture.outcomes.overview = "error";
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByText(/Your saved settings are still shown/)).toBeVisible();
    await expectSavedSetup(page);
    await expect(
      page.locator("#step-2").getByRole("button", { name: "Check status", exact: true }),
    ).toBeEnabled();
    expect(await actions(page)).not.toContain("connect");
  });

  test("configuration read failure retains overview truth without enabling Google actions", async ({
    page,
  }) => {
    await openOverview(page, { outcomes: { configuration: "error" } });
    const card = page.locator("#step-2");
    await expect(card.getByText("Calendar checks current", { exact: true })).toBeVisible();
    await expect(card.getByText(/Unable to load saved calendar details/)).toBeVisible();
    await expect(card.getByRole("button")).toHaveText(["Reload calendar details"]);
    await expectSavedSetup(page);
    await page.evaluate(() => {
      window.__googleOverviewFixture.outcomes.configuration = "success";
    });
    await card.getByRole("button", { name: "Reload calendar details", exact: true }).click();
    await expect(card.getByRole("button", { name: "Check status", exact: true })).toBeEnabled();
    expect(await actions(page)).not.toContain("connect");
    expect(await actions(page)).not.toContain("complete");
  });

  test("a late display read cannot replace a newer status-check result", async ({ page }) => {
    await openOverview(page, {
      connection: { reason: "provider_temporary_failure", healthState: "degraded" },
    });
    await expectSavedSetup(page);
    await page.evaluate(() => {
      window.__googleOverviewFixture.outcomes.overview = "pending";
      window.dispatchEvent(new Event("focus"));
    });
    await expect
      .poll(() => page.evaluate(() => window.__googleOverviewFixture.pending.length))
      .toBe(1);
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.outcomes.overview = "success";
      fixture.overview.readiness.calendar = "ready";
      fixture.overview.readiness.calendarConnection.healthState = "healthy";
      fixture.overview.readiness.calendarConnection.reason = null;
    });
    await page
      .locator("#step-2")
      .getByRole("button", { name: "Check status", exact: true })
      .click();
    await expect(
      page.locator("#step-2").getByText("Calendar checks current", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.__googleOverviewFixture.pending[0].resolve());
    await expect(
      page.locator("#step-2").getByText("Calendar checks current", { exact: true }),
    ).toBeVisible();
  });

  test("impersonation cannot load owner selectors, check status, or consume success as OAuth", async ({
    page,
  }) => {
    await openOverview(page, { mode: "admin" }, "success");
    await expect(page.locator("#step-2").getByText(/Only the business owner/)).toBeVisible();
    await expect(page.locator("#step-2 button")).toHaveCount(0);
    await expect(page).toHaveURL(OVERVIEW_URL);
    expect(
      (await actions(page)).filter((action) => action !== "overview" && action !== "availability"),
    ).toEqual([]);
  });

  test("expired Pro retains saved details but cannot authorize check, connection or reselection", async ({
    page,
  }) => {
    await openOverview(
      page,
      {
        hasPro: false,
        connection: { reason: "provider_reauthorization_required", healthState: "disconnected" },
      },
      "success",
    );
    const card = page.locator("#step-2");
    await expect(card.getByText(/active confirmed Pro order is required/)).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(page).toHaveURL(OVERVIEW_URL);
    expect(await actions(page)).not.toContain("complete");
    expect(await actions(page)).not.toContain("check");
  });

  test("an explicit success marker completes once, consumes after settlement, then reload is read-only", async ({
    page,
  }) => {
    await openOverview(page, { outcomes: { complete: "pending" } }, "success");
    await expect(
      page.locator("#step-2").getByText("Finishing Google setup", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.__googleOverviewFixture.updateProps!({}));
    expect((await actions(page)).filter((action) => action === "complete")).toHaveLength(1);
    await page.evaluate(() =>
      window.__googleOverviewFixture.pending.find(({ action }) => action === "complete")!.resolve(),
    );
    await expect(page).toHaveURL(OVERVIEW_URL);
    await page.reload();
    await expect(
      page.locator("#step-2").getByText("Calendar checks current", { exact: true }),
    ).toBeVisible();
    expect(await actions(page)).not.toContain("complete");
    expect(await actions(page)).not.toContain("connect");
  });

  test("an outage cannot relock edited availability or permit a stale Stripe refresh marker", async ({
    page,
  }) => {
    await openOverview(page);
    await expectSavedSetup(page);
    await page.getByLabel("Service name", { exact: true }).fill("Keep my unsaved form");
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.overview.readiness.calendar = "restricted";
      fixture.overview.readiness.calendarConnection.reason = "provider_temporary_failure";
      fixture.overview.readiness.calendarConnection.healthState = "degraded";
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      page.locator("#step-2").getByText("Temporarily unavailable", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.__googleOverviewFixture.updateProps!({ connect: "refresh" }));
    await expect(page.getByLabel("Service name", { exact: true })).toHaveValue(
      "Keep my unsaved form",
    );
    await expect(page.locator("#step-3")).not.toHaveAttribute("aria-disabled", "true");
    await expect(
      page.locator("#step-4").getByRole("button", { name: "My Payments", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => window.__stripeConnectFixture.requests.map(({ action }) => action)),
    ).toEqual(["status"]);
  });

  test("freshness never bypasses Stripe environment compatibility", async ({ page }) => {
    await openOverview(page, {
      connection: { reason: "provider_temporary_failure", healthState: "degraded" },
    });
    await page.evaluate(() => {
      window.__stripeConnectFixture.status.environmentError = "Fixture Stripe environment mismatch";
      window.__stripeConnectFixture.status.stripeEnvironment = "live";
    });
    await switchWorkspace(page);
    await expect(page.locator("#step-4").getByRole("alert")).toContainText(
      "Fixture Stripe environment mismatch",
    );
    await expect(page.locator("#step-4 button")).toHaveCount(0);
  });

  test("unknown Google facts cannot resume Stripe onboarding from a retained healthy snapshot", async ({
    page,
  }) => {
    await openOverview(page);
    await expectSavedSetup(page);
    const stripe = page.locator("#step-4");
    await page.evaluate(() => {
      window.__stripeConnectFixture.status.onboardingState = "pending";
      window.__stripeConnectFixture.status.chargesEnabled = false;
    });
    await stripe.getByRole("button", { name: "Check status", exact: true }).click();
    await expect(
      stripe.getByRole("button", { name: "Continue in Stripe", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => {
      window.__googleOverviewFixture.outcomes.overview = "error";
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      page.locator("#step-2").getByText("Status unknown", { exact: true }),
    ).toBeVisible();
    await expect(
      stripe.getByRole("button", { name: "Continue in Stripe", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => window.__googleOverviewFixture.updateProps!({ connect: "refresh" }));
    await expect(stripe.getByRole("button", { name: "My Payments", exact: true })).toBeEnabled();
    expect(
      await page.evaluate(() => window.__stripeConnectFixture.requests.map(({ action }) => action)),
    ).toEqual(["status", "verify"]);
  });

  for (const action of [
    "configuration",
    "overview",
    "connect",
    "check",
    "complete",
    "discover",
    "save",
  ] as const) {
    test(`late ${action} results cannot update or redirect a switched profile/website`, async ({
      page,
    }) => {
      await openOverview(
        page,
        { outcomes: { [action]: "pending" } },
        action === "complete" ? "success" : undefined,
      );
      if (action === "connect") {
        page.once("dialog", (dialog) => dialog.accept());
        await page
          .locator("#step-2")
          .getByRole("button", { name: "Connect to different account", exact: true })
          .click();
      } else if (action === "check") {
        await page
          .locator("#step-2")
          .getByRole("button", { name: "Check status", exact: true })
          .click();
      } else if (action === "discover" || action === "save") {
        await page
          .locator("#step-2")
          .getByRole("button", { name: "Review calendars", exact: true })
          .click();
        if (action === "save")
          await page
            .locator("#step-2")
            .getByRole("button", { name: "Save calendars", exact: true })
            .click();
      }
      await expect
        .poll(() =>
          page.evaluate(
            (action) =>
              window.__googleOverviewFixture.pending.some((pending) => pending.action === action),
            action,
          ),
        )
        .toBe(true);
      await switchWorkspace(page, NEXT_PROFILE_ID);
      const before = await actions(page);
      await page.evaluate(
        (action) =>
          window.__googleOverviewFixture.pending
            .find((pending) => pending.action === action)!
            .resolve(),
        action,
      );
      await expect(page.getByRole("heading", { name: "Next Fixture Business" })).toBeVisible();
      await expect(
        page.locator("#step-2").getByText("owner@example.test", { exact: true }),
      ).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe("");
      expect(await actions(page)).toEqual(before);
    });
  }

  test("focus and visibility refresh only facts; pending polling is bounded and cleans up on unmount", async ({
    page,
  }) => {
    await page.clock.install();
    await openOverview(page, {
      connection: { reason: "provider_temporary_failure", healthState: "degraded" },
    });
    await expectSavedSetup(page);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect
      .poll(async () => (await actions(page)).filter((action) => action === "overview").length)
      .toBe(2);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect
      .poll(async () => (await actions(page)).filter((action) => action === "overview").length)
      .toBe(3);
    for (let poll = 0; poll < 12; poll++) await page.clock.fastForward(10_010);
    await expect
      .poll(async () => (await actions(page)).filter((action) => action === "overview").length)
      .toBe(15);
    await page.clock.fastForward(60_000);
    expect((await actions(page)).filter((action) => action === "overview")).toHaveLength(15);
    expect(
      (await actions(page)).filter((action) => ["connect", "complete", "check"].includes(action)),
    ).toEqual([]);
    await page.evaluate(() => window.__googleOverviewFixture.unmount!());
    await expect(page.getByText("Overview unmounted", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(60_000);
    expect((await actions(page)).filter((action) => action === "overview")).toHaveLength(15);
  });

  test("in-flight poll settlement cannot revive polling after unmount", async ({ page }) => {
    await page.clock.install();
    await openOverview(page, { connection: { triggerState: "degraded" } });
    await expectSavedSetup(page);
    await page.evaluate(() => {
      window.__googleOverviewFixture.outcomes.overview = "pending";
    });
    await page.clock.fastForward(10_010);
    await expect
      .poll(() => page.evaluate(() => window.__googleOverviewFixture.pending.length))
      .toBe(1);
    await page.evaluate(() => window.__googleOverviewFixture.unmount!());
    await expect(page.getByText("Overview unmounted", { exact: true })).toBeVisible();
    await page.evaluate(() => window.__googleOverviewFixture.pending[0].resolve());
    await page.clock.fastForward(120_000);
    expect((await actions(page)).filter((action) => action === "overview")).toHaveLength(2);
  });

  test("hidden tabs skip display polls and a scoped recovery stops them", async ({ page }) => {
    await page.clock.install();
    await openOverview(page, { connection: { triggerState: "degraded" } });
    await expectSavedSetup(page);
    await page.evaluate(() =>
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }),
    );
    await page.clock.fastForward(10_010);
    expect((await actions(page)).filter((action) => action === "overview")).toHaveLength(1);
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      fixture.overview.readiness.calendar = "ready";
      fixture.overview.readiness.calendarConnection.triggerState = "active";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(
      page.locator("#step-2").getByText("Calendar checks current", { exact: true }),
    ).toBeVisible();
    await page.clock.fastForward(60_000);
    expect((await actions(page)).filter((action) => action === "overview")).toHaveLength(2);
  });

  test("switching websites cancels the previous display polling loop", async ({ page }) => {
    await page.clock.install();
    await openOverview(page, { connection: { triggerState: "degraded" } });
    await expectSavedSetup(page);
    await page.clock.fastForward(10_010);
    await page.evaluate(() => {
      const fixture = window.__googleOverviewFixture;
      fixture.overview.readiness.calendar = "ready";
      fixture.overview.readiness.calendarConnection.triggerState = "active";
    });
    await switchWorkspace(page);
    const before = await actions(page);
    await page.clock.fastForward(60_000);
    expect(await actions(page)).toEqual(before);
  });

  test("mobile keeps operational status, owner actions, and saved configuration readable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOverview(page, { connection: { triggerState: "degraded" } });
    await expect(
      page.locator("#step-2").getByText("Monitoring repair", { exact: true }),
    ).toBeVisible();
    await expectSavedSetup(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
