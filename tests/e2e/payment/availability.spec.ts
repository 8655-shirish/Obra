import { expect, test, type Page } from "@playwright/test";

import type {} from "./mocks/booking-setup.functions";

const PRICE_LABEL = "Price per booking (USD)";
const PRICE_ERROR = "Enter a price greater than $0 with at most two decimal places.";
const EDITED_FIELDS = [
  ["Service name", "Repair visit"],
  ["Duration (minutes)", "90"],
  ["Start-time interval (minutes)", "15"],
  ["Minimum notice (hours)", "2"],
  ["Booking horizon (days)", "90"],
  [PRICE_LABEL, "010.29"],
  ["Time zone", "America/New_York"],
  ["Monday start", "10:00"],
  ["Monday end", "16:30"],
  ["Override date", "2030-01-03"],
  ["Override reason", "Team training"],
] as const;

async function editAllFields(page: Page) {
  await page.getByRole("button", { name: "Add date override" }).click();
  for (const [label, value] of EDITED_FIELDS)
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Location", { exact: true }).selectOption("remote");
  await page.getByRole("switch", { name: "Enable Sunday", exact: true }).click();
}

test.describe("AvailabilityEditor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?scenario=availability");
    await expect(page.getByRole("group", { name: "Booking availability" })).toBeVisible();
  });

  test("starts with an empty decimal textbox, no price spinner, and no save", async ({ page }) => {
    const price = page.getByRole("textbox", { name: PRICE_LABEL });
    await expect(price).toHaveValue("");
    await expect(price).toHaveAttribute("type", "text");
    await expect(price).toHaveAttribute("inputmode", "decimal");
    await expect(price).toHaveAttribute("placeholder", "0.00");
    await expect(price).toHaveAttribute("aria-invalid", "false");
    await expect(price).toHaveAccessibleDescription(
      "Customers pay this full amount for every slot.",
    );
    await expect(page.getByRole("spinbutton", { name: PRICE_LABEL })).toHaveCount(0);
    await expect(page.getByLabel("Buffer before (minutes)")).toHaveCount(0);
    await expect(page.getByLabel("Buffer after (minutes)")).toHaveCount(0);
    await expect(page.getByLabel("Minimum notice (minutes)", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Minimum notice (hours)", { exact: true })).toHaveValue("24");
    await expect(page.getByRole("button", { name: "About Service name" })).toBeVisible();
    await expect(
      page.getByText(
        "These changes will show on your live website for your customers. You can come back and change them here anytime.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save and continue" })).toBeDisabled();
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    await expect(page.getByRole("complementary").getByText("Enter a price")).toBeVisible();
    expect(await page.evaluate(() => window.__availabilityFixture.requests)).toEqual([]);
  });

  for (const [raw, formatted, amountMinor] of [
    ["100", "100.00", 10000],
    ["125.50", "125.50", 12550],
  ] as const) {
    test(`preserves clearing and sequential entry of ${raw} until save`, async ({ page }) => {
      const price = page.getByLabel(PRICE_LABEL, { exact: true });
      const save = page.getByRole("button", { name: "Save and continue" });
      await price.fill("9.99");
      await price.clear();
      await expect(price).toHaveValue("");
      await expect(price).toHaveAttribute("aria-invalid", "false");
      await expect(save).toBeDisabled();

      let typed = "";
      for (const character of raw) {
        await price.pressSequentially(character);
        typed += character;
        await expect(price).toHaveValue(typed);
      }
      await page.getByLabel("Service name", { exact: true }).focus();
      await expect(price).toHaveValue(raw);
      await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("complementary").getByText(`$${formatted}`, { exact: true }),
      ).toBeVisible();
      await expect(save).toBeEnabled();
      await save.click();

      await expect(page.getByRole("alert").getByRole("heading")).toHaveText("Saved");
      await expect(price).toHaveValue(formatted);
      await expect(save).toBeDisabled();
      await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
      const requests = await page.evaluate(() => window.__availabilityFixture.requests);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        websiteId: "11111111-1111-4111-8111-111111111111",
        serviceRevision: null,
        scheduleRevision: null,
        service: { amountMinor, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      });
      expect(Number.isSafeInteger(requests[0].service.amountMinor)).toBe(true);

      await price.press("ControlOrMeta+A");
      await price.press("Backspace");
      await expect(price).toHaveValue("");
      await expect(price).toHaveAttribute("aria-invalid", "false");
      await expect(save).toBeDisabled();
      await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.__availabilityFixture.requests.length)).toBe(1);
    });
  }

  test("preserves decimal interim states and compares raw edits with saved formatting", async ({
    page,
  }) => {
    const price = page.getByLabel(PRICE_LABEL, { exact: true });
    const save = page.getByRole("button", { name: "Save and continue" });
    for (const [text, invalidPrefixes] of [
      [".50", ["."]],
      ["0.50", ["0", "0."]],
      ["100.", []],
    ] as const) {
      await price.clear();
      let typed = "";
      for (const character of text) {
        typed += character;
        await price.pressSequentially(character);
        const invalid = (invalidPrefixes as readonly string[]).includes(typed);
        await expect(price).toHaveValue(typed);
        await expect(price).toHaveAttribute("aria-invalid", String(invalid));
        if (invalid) await expect(save).toBeDisabled();
        else await expect(save).toBeEnabled();
      }
      await page.getByLabel("Service name", { exact: true }).focus();
      await expect(price).toHaveValue(text);
    }
    expect(await page.evaluate(() => window.__availabilityFixture.requests)).toEqual([]);
    await save.click();
    await expect(price).toHaveValue("100.00");
    await expect(save).toBeDisabled();
    expect(
      await page.evaluate(() => window.__availabilityFixture.requests[0].service.amountMinor),
    ).toBe(10000);

    await price.fill("100.0");
    await expect(save).toBeEnabled();
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
    await price.fill("100.00");
    await expect(save).toBeDisabled();
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  });

  for (const [raw, amountMinor] of [
    ["1.01", 101],
    ["10.29", 1029],
  ] as const) {
    test(`select-all replacement saves exactly ${amountMinor} cents for ${raw}, not the previous price`, async ({
      page,
    }) => {
      const price = page.getByLabel(PRICE_LABEL, { exact: true });
      const save = page.getByRole("button", { name: "Save and continue" });
      await price.fill("125.50");
      await save.click();
      await expect(save).toBeDisabled();

      await price.press("ControlOrMeta+A");
      let typed = "";
      for (const character of raw) {
        typed += character;
        await price.pressSequentially(character);
        await expect(price).toHaveValue(typed);
      }
      await save.click();
      await expect(save).toBeDisabled();
      await expect(price).toHaveValue(raw);
      const requests = await page.evaluate(() => window.__availabilityFixture.requests);
      expect(requests.map((request) => request.service.amountMinor)).toEqual([12550, amountMinor]);
      expect(requests.every((request) => Number.isSafeInteger(request.service.amountMinor))).toBe(
        true,
      );
    });
  }

  test("pastes a replacement decimal price and saves its exact cents", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const price = page.getByLabel(PRICE_LABEL, { exact: true });
    await price.fill("100.00");
    await price.press("ControlOrMeta+A");
    await page.evaluate(() => navigator.clipboard.writeText("10.29"));
    await price.press("ControlOrMeta+V");
    await expect(price).toHaveValue("10.29");
    await expect(price).toHaveAttribute("aria-invalid", "false");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.__availabilityFixture.requests.map((request) => request.service.amountMinor),
      ),
    ).toEqual([1029]);
  });

  for (const [name, value] of [
    ["zero", "0"],
    ["decimal zero", "0.00"],
    ["negative", "-1.00"],
    ["exponent", "1e2"],
    ["more than two decimal places", "1.001"],
    ["NaN", "NaN"],
    ["positive infinity", "Infinity"],
    ["negative infinity", "-Infinity"],
    ["unsafe integer cents", "90071992547409.92"],
    ["overflowing digits", "9".repeat(309)],
  ]) {
    test(`blocks ${name} with an associated price error and no save request`, async ({ page }) => {
      const price = page.getByLabel(PRICE_LABEL, { exact: true });
      await page.getByLabel("Service name", { exact: true }).fill("Dirty appointment");
      await price.fill(value);
      await expect(price).toHaveValue(value);
      await expect(price).toHaveAttribute("aria-invalid", "true");
      await expect(price).toHaveAccessibleDescription(PRICE_ERROR);
      await expect(page.locator("#price-help")).toHaveText(PRICE_ERROR);
      await expect(page.getByRole("button", { name: "Save and continue" })).toBeDisabled();
      await expect(page.getByRole("complementary").getByText("Enter a price")).toBeVisible();
      await price.press("Enter");
      expect(await page.evaluate(() => window.__availabilityFixture.requests)).toEqual([]);
    });
  }

  test("uses returned price and revisions as the saved snapshot for subsequent saves", async ({
    page,
  }) => {
    const price = page.getByLabel(PRICE_LABEL, { exact: true });
    const save = page.getByRole("button", { name: "Save and continue" });
    await page.evaluate(() => {
      const fixture = window.__availabilityFixture;
      fixture.response = {
        serviceRevision: 7,
        scheduleRevision: 19,
        service: {
          ...fixture.initial.service,
          name: "Server-normalized visit",
          amountMinor: 12550,
        },
      };
    });
    await price.fill("100");
    await save.click();
    await expect(price).toHaveValue("125.50");
    await expect(page.getByLabel("Service name", { exact: true })).toHaveValue(
      "Server-normalized visit",
    );
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    await page.evaluate(() => {
      window.__availabilityFixture.response = {};
    });

    for (const value of ["1.01", "10.29"]) {
      await price.fill(value);
      await save.click();
      await expect(save).toBeDisabled();
      await expect(price).toHaveValue(value);
      await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    }
    const requests = await page.evaluate(() => window.__availabilityFixture.requests);
    expect(
      requests.map(({ serviceRevision, scheduleRevision, service }) => ({
        serviceRevision,
        scheduleRevision,
        amountMinor: service.amountMinor,
      })),
    ).toEqual([
      { serviceRevision: null, scheduleRevision: null, amountMinor: 10000 },
      { serviceRevision: 7, scheduleRevision: 19, amountMinor: 101 },
      { serviceRevision: 8, scheduleRevision: 20, amountMinor: 1029 },
    ]);
    expect(requests[2].service.name).toBe("Server-normalized visit");
    expect(await page.evaluate(() => window.__availabilityFixture.onSavedCalls)).toBe(3);
  });

  test("requires at least one weekly interval even with a valid dirty price", async ({ page }) => {
    await page.getByLabel(PRICE_LABEL, { exact: true }).fill("100");
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      await page.getByRole("switch", { name: `Enable ${day}`, exact: true }).click();
    }
    const save = page.getByRole("button", { name: "Save and continue" });
    await expect(save).toBeDisabled();
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__availabilityFixture.requests)).toEqual([]);
    await page.getByRole("switch", { name: "Enable Monday", exact: true }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeDisabled();
    expect(await page.evaluate(() => window.__availabilityFixture.requests[0].intervals)).toEqual([
      { weekday: 1, localStart: "09:00", localEnd: "17:00", sortOrder: 0 },
    ]);
  });

  test("locks every edit while a save is pending so completion cannot overwrite newer edits", async ({
    page,
  }) => {
    await editAllFields(page);
    await page.evaluate(() => {
      window.__availabilityFixture.outcome = "pending";
    });
    await page.getByRole("button", { name: "Save and continue" }).click();
    const fieldset = page.getByRole("group", { name: "Booking availability" });
    await expect(fieldset).toHaveAttribute("disabled", "");
    await expect(page.getByRole("button", { name: /^Saving/ })).toBeDisabled();
    for (const control of await fieldset.locator("input, select, button").all()) {
      await expect(control).toBeDisabled();
    }
    await expect(page.getByLabel(PRICE_LABEL, { exact: true })).not.toBeEditable();
    // Day labels have click handlers outside the native disabled controls.
    await fieldset.getByText("Monday", { exact: true }).click();
    await fieldset.getByText("Saturday", { exact: true }).click();
    await expect(page.getByRole("switch", { name: "Enable Monday", exact: true })).toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Enable Saturday", exact: true }),
    ).not.toBeChecked();
    for (const [label, value] of EDITED_FIELDS)
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    expect(await page.evaluate(() => window.__availabilityFixture.requests.length)).toBe(1);
    expect(await page.evaluate(() => window.__availabilityFixture.onSavedCalls)).toBe(0);

    await page.evaluate(() => {
      const fixture = window.__availabilityFixture;
      fixture.outcome = "success";
      fixture.resolveSave!();
    });
    await expect(fieldset).not.toHaveAttribute("disabled");
    await expect(page.getByRole("alert").getByRole("heading")).toHaveText("Saved");
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save and continue" })).toBeDisabled();
    for (const [label, value] of EDITED_FIELDS) {
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(
        label === PRICE_LABEL ? "10.29" : value,
      );
    }
    await expect(page.getByLabel("Location", { exact: true })).toHaveValue("remote");
    await expect(page.getByRole("switch", { name: "Enable Sunday", exact: true })).toBeChecked();
    expect(
      await page.evaluate(() => window.__availabilityFixture.requests[0].service.amountMinor),
    ).toBe(1029);
    expect(await page.evaluate(() => window.__availabilityFixture.onSavedCalls)).toBe(1);
    await page.getByLabel(PRICE_LABEL, { exact: true }).fill("12.50");
    await expect(page.getByRole("button", { name: "Save and continue" })).toBeEnabled();
  });

  for (const [name, error, title, text] of [
    [
      "validation",
      "INVALID_AVAILABILITY: Availability windows overlap. Adjust your hours or date overrides.",
      "Check your settings",
      "Availability windows overlap. Adjust your hours or date overrides.",
    ],
    [
      "internal failure",
      "Unable to save availability. Please try again. If this continues, contact support.",
      "Unable to save",
      "Unable to save availability. Please try again. If this continues, contact support.",
    ],
    [
      "revision conflict",
      "REVISION_CONFLICT",
      "Settings changed",
      "These settings changed elsewhere. Your edits are still here; reload in another tab to compare before saving again.",
    ],
  ]) {
    test(`reports ${name} distinctly and retains every dirty field for retry`, async ({ page }) => {
      await editAllFields(page);
      await page.evaluate((message) => {
        window.__availabilityFixture.outcome = "error";
        window.__availabilityFixture.error = message;
      }, error);
      const save = page.getByRole("button", { name: "Save and continue" });
      await save.click();
      const alert = page.getByRole("alert");
      await expect(alert.getByRole("heading")).toHaveText(title);
      await expect(alert.getByText(text, { exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Booking availability" })).not.toHaveAttribute(
        "disabled",
      );
      await expect(save).toBeEnabled();
      await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
      for (const [label, value] of EDITED_FIELDS)
        await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
      await expect(page.getByLabel("Location", { exact: true })).toHaveValue("remote");
      await expect(page.getByRole("switch", { name: "Enable Sunday", exact: true })).toBeChecked();
      const failedRequests = await page.evaluate(() => window.__availabilityFixture.requests);
      expect(failedRequests).toHaveLength(1);
      expect(failedRequests[0]).toMatchObject({
        serviceRevision: null,
        scheduleRevision: null,
        service: {
          name: "Repair visit",
          durationMinutes: 90,
          slotIntervalMinutes: 15,
          minimumNoticeMinutes: 120,
          bookingHorizonDays: 90,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          locationType: "remote",
          amountMinor: 1029,
        },
        timeZone: "America/New_York",
        overrides: [
          { localDate: "2030-01-03", type: "unavailable", reason: "Team training", intervals: [] },
        ],
      });
      expect(failedRequests[0].intervals).toHaveLength(6);
      expect(failedRequests[0].intervals).toEqual(
        expect.arrayContaining([
          { weekday: 1, localStart: "10:00", localEnd: "16:30", sortOrder: 0 },
          { weekday: 0, localStart: "09:00", localEnd: "17:00", sortOrder: 0 },
        ]),
      );
      expect(await page.evaluate(() => window.__availabilityFixture.onSavedCalls)).toBe(0);

      await page.evaluate(() => {
        window.__availabilityFixture.outcome = "success";
      });
      await save.click();
      await expect(alert.getByRole("heading")).toHaveText("Saved");
      await expect(page.getByLabel(PRICE_LABEL, { exact: true })).toHaveValue("10.29");
      await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
      await expect(save).toBeDisabled();
      expect(await page.evaluate(() => window.__availabilityFixture.requests)).toEqual([
        failedRequests[0],
        failedRequests[0],
      ]);
      expect(await page.evaluate(() => window.__availabilityFixture.onSavedCalls)).toBe(1);
    });
  }

  test("AVAILABILITY_SAVED_RELOAD_REQUIRED locks editing and prevents a second save", async ({
    page,
  }) => {
    await editAllFields(page);
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);
    await page.evaluate(() => {
      window.__availabilityFixture.outcome = "error";
      window.__availabilityFixture.error = "AVAILABILITY_SAVED_RELOAD_REQUIRED";
    });
    const save = page.getByRole("button", { name: "Save and continue" });
    await save.click();
    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading")).toHaveText("Saved; reload required");
    await expect(alert).toContainText(
      "Availability was saved, but the updated settings could not be loaded. Reload the page before editing again.",
    );
    await expect(page.getByText("Reload to view saved settings", { exact: true })).toBeVisible();
    const fieldset = page.getByRole("group", { name: "Booking availability" });
    await expect(fieldset).toHaveAttribute("disabled", "");
    for (const control of await fieldset.locator("input, select, button").all())
      await expect(control).toBeDisabled();
    await page.evaluate(() => {
      window.__availabilityFixture.outcome = "success";
    });
    await save.evaluate((button: HTMLButtonElement) => button.click());
    await fieldset.getByText("Monday", { exact: true }).click();
    await expect(page.getByRole("switch", { name: "Enable Monday", exact: true })).toBeChecked();
    await expect(save).toBeDisabled();
    await expect(page.getByLabel(PRICE_LABEL, { exact: true })).toHaveValue("010.29");
    expect(await page.evaluate(() => window.__availabilityFixture.requests.length)).toBe(1);
    expect(await page.evaluate(() => window.__availabilityFixture.onSavedCalls)).toBe(0);
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
  });

  test("onSaved refresh failure still reports Saved with reload advice and a clean snapshot", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__availabilityFixture.onSavedError = "Fixture setup refresh failed";
    });
    const price = page.getByLabel(PRICE_LABEL, { exact: true });
    await price.fill("001.01");
    const save = page.getByRole("button", { name: "Save and continue" });
    await save.click();
    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading")).toHaveText("Saved");
    await expect(alert).toContainText(
      "Availability was saved, but setup status could not refresh. Reload the page to continue.",
    );
    await expect(alert).not.toContainText("Unable to save");
    await expect(alert).not.toContainText("Fixture setup refresh failed");
    await expect(price).toHaveValue("1.01");
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    expect(
      await page.evaluate(() =>
        window.__availabilityFixture.requests.map((request) => request.service.amountMinor),
      ),
    ).toEqual([101]);
    expect(await page.evaluate(() => window.__availabilityFixture.onSavedCalls)).toBe(1);
  });
});
