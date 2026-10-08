import type { ComponentProps } from "react";
import type { AvailabilityEditor } from "../../../../src/components/booking/AvailabilityEditor";

type Configuration = ComponentProps<typeof AvailabilityEditor>["initial"];
type SavePayload = Configuration & { websiteId: string };

type AvailabilityFixture = {
  initial: Configuration;
  requests: SavePayload[];
  outcome: "success" | "pending" | "error";
  error: string;
  response: Partial<Configuration>;
  resolveSave: (() => void) | null;
  onSavedCalls: number;
  onSavedError: string | null;
};

declare global {
  interface Window {
    __availabilityFixture: AvailabilityFixture;
  }
}

export const availabilityFixture: AvailabilityFixture = {
  initial: {
    serviceRevision: null,
    scheduleRevision: null,
    service: {
      name: "Appointment",
      description: "",
      durationMinutes: 60,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      minimumNoticeMinutes: 1440,
      bookingHorizonDays: 60,
      locationType: "customer_address",
      locationInstructions: "",
      amountMinor: 0,
      currency: "USD",
      paymentPolicy: "full_amount",
    },
    timeZone: "America/Los_Angeles",
    intervals: [],
    overrides: [],
  },
  requests: [],
  outcome: "success",
  error: "Unable to save availability. Please try again. If this continues, contact support.",
  response: {},
  resolveSave: null,
  onSavedCalls: 0,
  onSavedError: null,
};

export async function saveBookingAvailability({ data }: { data: SavePayload }) {
  const fixture = window.__availabilityFixture;
  const payload = structuredClone(data);
  fixture.requests.push(payload);
  if (fixture.outcome === "pending") {
    await new Promise<void>((resolve) => {
      fixture.resolveSave = resolve;
    });
    fixture.resolveSave = null;
  }
  if (fixture.outcome === "error") throw new Error(fixture.error);

  const { websiteId, ...configuration } = structuredClone(payload);
  return {
    configuration: {
      ...configuration,
      serviceRevision: (payload.serviceRevision ?? 0) + 1,
      scheduleRevision: (payload.scheduleRevision ?? 0) + 1,
      ...structuredClone(fixture.response),
    },
  };
}
