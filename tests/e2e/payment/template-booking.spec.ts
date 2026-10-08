import { expect, test, type Page } from "@playwright/test";
import type { PublicSiteOptions } from "./mocks/public-site.functions";

const WEBSITES = {
  painter11: "11111111-1111-4111-8111-111111111111",
  plumber: "33333333-3333-4333-8333-333333333333",
};

function bookingButtons(page: Page, template: PublicSiteOptions["template"]) {
  return page.getByRole("button", {
    name: template === "painter11" ? /Preview a walkthrough/ : /Request a visit/,
  });
}

async function openSite(page: Page, options: PublicSiteOptions) {
  await page.addInitScript((options) => {
    window.__publicSiteOptions = options;
  }, options);
  await page.goto(`/lp/${WEBSITES[options.template]}`);
  await expect(bookingButtons(page, options.template).first()).toBeVisible();
}

test.describe("Supported purchased LP booking (real route and molds, mocked server boundaries)", () => {
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
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test.afterEach(async ({ page }) => {
    expect(
      externalRequests,
      "No provider, DB, cron or external checkout requests are permitted",
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => window.__publicSiteFixture.forbiddenCalls)).toEqual([]);
  });

  for (const template of ["painter11", "plumber"] as const) {
    for (const mobile of [false, true]) {
      test(`${template} ${mobile ? "mobile" : "desktop"} CTA opens parent live slots and submits checkout for the resolved website`, async ({
        page,
      }) => {
        if (mobile) await page.setViewportSize({ width: 390, height: 844 });
        await openSite(page, { template });
        await expect(page.getByText(/All the contents in this website are for demo/)).toHaveCount(
          0,
        );
        await expect(page.getByRole("button", { name: /Get this website|Buy this/ })).toHaveCount(
          0,
        );
        const trigger = bookingButtons(page, template).first();
        await trigger.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Book an appointment", exact: true });
        await expect(dialog).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await expect(dialog.getByText(/Select a live available time/)).toBeVisible();
        await expect(
          dialog.getByText(/Simulate payment|Demo complete|no appointment or charge/),
        ).toHaveCount(0);
        await dialog.getByRole("button", { name: /Wed, Jan 2/ }).click();
        for (const [label, value] of [
          ["Full name", "Fixture Customer"],
          ["Email", "customer@example.test"],
          ["Phone", "+12025550123"],
          ["Service address", "12 Fixture Street"],
          ["City", "Oakland"],
          ["State", "CA"],
          ["ZIP code", "94612"],
        ])
          await dialog.getByLabel(label, { exact: true }).fill(value);
        await dialog.getByRole("checkbox", { name: /explicitly agree/ }).check();
        await dialog
          .getByRole("button", { name: "Continue to secure payment", exact: true })
          .click();
        await expect(page).toHaveURL(
          new RegExp(`/lp/${WEBSITES[template]}#mock-booking-checkout$`),
        );
        const requests = await page.evaluate(() => window.__liveBookingFixture.requests);
        expect(requests.map(({ action }) => action)).toEqual(["slots", "checkout"]);
        expect(requests[0].data).toEqual({
          websiteId: WEBSITES[template],
          fromDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          dayCount: 14,
        });
        expect(requests[1].data).toMatchObject({
          websiteId: WEBSITES[template],
          startAt: "2030-01-02T17:00:00.000Z",
          localDate: "2030-01-02",
          localStart: "09:00",
          timeZone: "America/Los_Angeles",
          availabilityGeneration: 7,
          calendarSetHash: "a".repeat(64),
          observedAt: "2030-01-01T12:00:00.000Z",
          consent: { accepted: true },
          customer: { fullName: "Fixture Customer", email: "customer@example.test" },
        });
        expect(requests[1].data).not.toHaveProperty("accountId");
        const loaded = await page.evaluate(() => window.__publicSiteFixture.loaded);
        expect(loaded?.websiteId).toBe(WEBSITES[template]);
        expect(loaded).not.toHaveProperty("calendarConnection");
        expect(loaded).not.toHaveProperty("calendarAccountEmail");
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      });
    }

    for (const mode of ["pending", "inactive", "paused"] as const) {
      test(`${template} ${mode} purchased content cannot open demo, slots, or checkout`, async ({
        page,
      }) => {
        await openSite(page, { template, mode });
        const buttons = bookingButtons(page, template);
        const count = await buttons.count();
        expect(count).toBeGreaterThan(5);
        for (let index = 0; index < count; index++) await expect(buttons.nth(index)).toBeDisabled();
        // Programmatic clicks must also be inert; a missing disabled prop must fail this test.
        await buttons.evaluateAll((nodes) =>
          nodes.forEach((node) => (node as HTMLButtonElement).click()),
        );
        if (template === "plumber") {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole("button", { name: "Open menu", exact: true }).click();
          await expect(
            page
              .getByRole("dialog", { name: "Site navigation" })
              .getByRole("button", { name: /Request a visit/ }),
          ).toBeDisabled();
          await page.getByRole("button", { name: "Close menu", exact: true }).click();
        }
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(await page.evaluate(() => window.__liveBookingFixture.requests)).toEqual([]);
        if (mode === "pending")
          await expect(page.getByText(/Online booking is being configured/)).toBeVisible();
        if (mode === "inactive")
          await expect(page.getByText(/subscription is currently inactive/)).toBeVisible();
        expect(await page.locator('a[href="tel:+12025550100"]').count()).toBeGreaterThan(0);
        await expect(page.getByText(/All the contents in this website are for demo/)).toHaveCount(
          0,
        );
      });
    }

    test(`${template} live slot failure never falls back to a demo or charge`, async ({ page }) => {
      await openSite(page, { template });
      await page.evaluate(() => {
        window.__liveBookingFixture.slotsError = true;
      });
      await bookingButtons(page, template).first().click();
      const dialog = page.getByRole("dialog", { name: "Book an appointment", exact: true });
      await expect(dialog.getByRole("alert")).toContainText("Available times could not be loaded");
      await expect(dialog.getByRole("button", { name: /payment/ })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Select a time", exact: true })).toHaveCount(0);
      expect(
        (await page.evaluate(() => window.__liveBookingFixture.requests)).map(
          ({ action }) => action,
        ),
      ).toEqual(["slots"]);
    });

    for (const standalone of [false, true]) {
      test(`${template} ${standalone ? "standalone template" : "demo LP"} preserves the local demo without live calls`, async ({
        page,
      }) => {
        if (standalone) await page.goto(`/?scenario=template&template=${template}`);
        else await openSite(page, { template, mode: "demo" });
        await bookingButtons(page, template).first().click();
        const dialog = page.getByRole("dialog", { name: "Select a time", exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/no appointment or charge will be created/)).toBeVisible();
        await expect(
          page.getByRole("dialog", { name: "Book an appointment", exact: true }),
        ).toHaveCount(0);
        expect(await page.evaluate(() => window.__liveBookingFixture.requests)).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      });
    }

    for (const query of ["content=1", "bookingMode=live"]) {
      test(`${template} standalone ${query} cannot silently default to demo`, async ({ page }) => {
        await page.goto(`/?scenario=template&template=${template}&${query}`);
        await expect(bookingButtons(page, template).first()).toBeDisabled();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(await page.evaluate(() => window.__liveBookingFixture.requests)).toEqual([]);
      });
    }
  }
});
