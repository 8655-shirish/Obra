import type {
  getLiveBookingSlots as getSlots,
  createLiveBookingCheckout as createCheckout,
} from "../../../../src/lib/booking-live.functions";

type SlotsInput = NonNullable<Parameters<typeof getSlots>[0]>;
type CheckoutInput = NonNullable<Parameters<typeof createCheckout>[0]>;

declare global {
  interface Window {
    __liveBookingFixture: {
      requests: (
        | { action: "slots"; data: SlotsInput["data"] }
        | { action: "checkout"; data: CheckoutInput["data"] }
      )[];
      slotsError: boolean;
      checkoutError: boolean;
      checkoutNotAttempted: boolean;
    };
  }
}

export const liveBookingFixture: Window["__liveBookingFixture"] = {
  requests: [],
  slotsError: false,
  checkoutError: false,
  checkoutNotAttempted: false,
};

const SLOT = {
  startAt: "2030-01-02T17:00:00.000Z",
  endAt: "2030-01-02T18:00:00.000Z",
  localDate: "2030-01-02",
  localStart: "09:00",
};

export async function getLiveBookingSlots({ data }: SlotsInput) {
  liveBookingFixture.requests.push({ action: "slots", data: structuredClone(data) });
  if (liveBookingFixture.slotsError) throw new Error("Fixture slots unavailable");
  return {
    slots: [SLOT],
    observedAt: "2030-01-01T12:00:00.000Z",
    availabilityGeneration: 7,
    calendarSetHash: "a".repeat(64),
    timeZone: "America/Los_Angeles",
    service: { name: "Repair service", amountMinor: 12500, currency: "USD" },
  };
}

export async function createLiveBookingCheckout({
  data,
}: CheckoutInput): Promise<Awaited<ReturnType<typeof createCheckout>>> {
  liveBookingFixture.requests.push({ action: "checkout", data: structuredClone(data) });
  if (liveBookingFixture.checkoutError) throw new Error("Fixture response unavailable");
  if (liveBookingFixture.checkoutNotAttempted)
    return { status: "not_attempted", code: "slot_unavailable" };
  return {
    status: "checkout_ready",
    checkoutUrl: new URL("#mock-booking-checkout", window.location.href).href,
    expiresAt: "2030-01-02T17:30:00.000Z",
  };
}
