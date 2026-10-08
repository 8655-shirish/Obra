import { expect, test } from "@playwright/test";

import { RECEIPT_REFERENCES } from "./test-data";

function receiptUrl(reference: string) {
  return "/booking/confirmation?reference=" + reference;
}

test("safe default presents no live booking affordance", async ({ page }) => {
  await page.goto("/?scenario=disabled");
  await expect(page.getByRole("button", { name: "Book & pay" })).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Online booking is temporarily unavailable.");
  await expect(page.getByRole("dialog", { name: "Book an appointment" })).toHaveCount(0);
});

test("LiveBookingDialog is keyboard-labelled and collects required checkout identity", async ({
  page,
}) => {
  await page.goto("/?scenario=booking");
  const trigger = page.getByRole("button", { name: "Book an appointment" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Book an appointment" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-labelledby", /.+/);
  await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
  await expect(dialog.getByText(/pay securely on Stripe/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await dialog.getByRole("button", { name: /Wed, Jan 2/ }).click();

  for (const label of [
    "Full name",
    "Email",
    "Phone",
    "Service address",
    "City",
    "State",
    "ZIP code",
  ]) {
    await expect(dialog.getByLabel(label)).toBeVisible();
    await expect(dialog.getByLabel(label)).toHaveAttribute("required", "");
  }
  const consent = dialog.getByRole("checkbox", {
    name: /explicitly agree to the booking data and payment consent/i,
  });
  await expect(consent).toBeVisible();
  await expect(consent).toHaveAttribute("aria-required", "true");
  await expect(consent).not.toBeChecked();
  await expect(dialog.getByText(/contractor may use the contact details/)).toBeVisible();
  await expect(dialog.getByText(/Document obra-booking-data-and-payment-consent/)).toContainText(
    "Version 2026-08-29.1",
  );
  await expect(dialog.getByText(/899ffc003957450d/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue to secure payment" })).toBeVisible();
  await expect(dialog.getByText(/held for 15 minutes/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("exported receipt route renders lifecycle projections and manual refresh", async ({
  page,
}) => {
  const receipt = page.getByText(/^Reference /);
  const status = page.getByRole("status");

  await page.goto(receiptUrl(RECEIPT_REFERENCES.pending));
  await expect(status).toContainText("being confirmed");
  await expect(receipt).toHaveText("Reference " + RECEIPT_REFERENCES.pending);

  await page.goto(receiptUrl(RECEIPT_REFERENCES.confirmed));
  await expect(page.getByRole("heading", { name: "Your appointment is confirmed" })).toBeVisible();
  await expect(status).toContainText("calendar invitation was created");

  await page.goto(receiptUrl(RECEIPT_REFERENCES.refund));
  await expect(status).toContainText("full automatic refund is in progress");

  await page.goto(receiptUrl(RECEIPT_REFERENCES.calendar));
  await expect(status).toContainText("Calendar delivery needs repair");

  await page.goto(receiptUrl(RECEIPT_REFERENCES.refresh));
  await expect(status).toContainText("being confirmed");
  const refresh = page.getByRole("button", { name: "Refresh status" });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(status).toContainText("calendar invitation was created");
  await expect(page.getByRole("button", { name: "Refresh status" })).toBeEnabled();
});
