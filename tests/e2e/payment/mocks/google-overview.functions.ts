import type { ComponentProps } from "react";
import type { PurchaserOverview as OverviewComponent } from "../../../../src/components/purchaser/PurchaserOverview";
import type { PurchaserOverview as Overview } from "../../../../src/lib/template-purchase.functions";
import type { loadGoogleCalendarConfiguration as loadConfig } from "../../../../src/lib/booking-provider.functions";
import { deriveBucketOneReadiness } from "../../../../src/lib/booking-readiness";
import {
  projectGoogleCalendarReadiness,
  type GoogleCalendarConnection,
} from "../../../../src/lib/google-calendar-readiness";
import { availabilityFixture } from "./booking-setup.functions";

export const GOOGLE_WEBSITE_ID = "11111111-1111-4111-8111-111111111111";
export const GOOGLE_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
export type GoogleOverviewProps = ComponentProps<typeof OverviewComponent>;
type Config = Awaited<ReturnType<typeof loadConfig>>;
type Outcome = "success" | "pending" | "error";
type Action =
  | "overview"
  | "configuration"
  | "check"
  | "connect"
  | "complete"
  | "discover"
  | "save"
  | "availability";
type WebsiteInput = { websiteId: string; returnPath?: string };
type Selection = Parameters<typeof projectGoogleCalendarReadiness>[0]["selections"][number];

export type GoogleOverviewOptions = {
  mode?: Overview["mode"];
  plan?: Overview["plan"];
  orderConfirmed?: boolean;
  hasPro?: boolean;
  connection?: Partial<GoogleCalendarConnection>;
  accountId?: string | null;
  accountEmail?: string | null;
  selections?: Selection[];
  availabilityConfigured?: boolean;
  payments?: Overview["readiness"]["payments"];
  outcomes?: Partial<Record<Action, Outcome>>;
};

type GoogleOverviewFixture = {
  overview: Overview;
  configuration: Config;
  requests: { action: Action; data: WebsiteInput & Record<string, unknown> }[];
  outcomes: Partial<Record<Action, Outcome>>;
  pending: { action: Action; websiteId: string; resolve: () => void; reject: () => void }[];
  updateProps: ((next: Partial<GoogleOverviewProps>) => void) | null;
  unmount: (() => void) | null;
};

declare global {
  interface Window {
    __googleOverviewOptions?: GoogleOverviewOptions;
    __googleOverviewFixture: GoogleOverviewFixture;
  }
}

const options = window.__googleOverviewOptions ?? {};
const now = new Date().toISOString();
const accountId = options.accountId === undefined ? "apn_saved_owner" : options.accountId;
const accountEmail =
  options.accountEmail === undefined ? "owner@example.test" : options.accountEmail;
const selections = options.selections ?? [
  {
    active: true,
    blocks_availability: true,
    receives_bookings: true,
    access_role: "owner",
    permission_verified_at: now,
  },
];
const projection = projectGoogleCalendarReadiness({
  healthState: accountId ? (options.connection?.healthState ?? "healthy") : "not_connected",
  reason: options.connection?.reason,
  reconnectReason: options.connection?.reconnectReason,
  lastVerifiedAt:
    options.connection?.lastVerifiedAt === undefined ? now : options.connection.lastVerifiedAt,
  selections,
  triggerState:
    options.connection?.triggerState === undefined ? "active" : options.connection.triggerState,
  triggerLastHealthAt:
    options.connection?.lastHealthAt === undefined ? now : options.connection.lastHealthAt,
});
const connection: GoogleCalendarConnection = {
  connectionRevision: accountId ? 4 : null,
  accountId,
  pendingSetup: null,
  healthState: accountId ? "healthy" : "not_connected",
  reason: null,
  reconnectReason: null,
  lastVerifiedAt: now,
  nextRetryAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  triggerState: "active",
  lastHealthAt: now,
  ...options.connection,
  configured: Boolean(accountId) && projection.selectionsConfigured,
};
const plan = options.plan ?? "pro";
const orderConfirmed = options.orderConfirmed ?? true;
const readiness = deriveBucketOneReadiness({
  websiteId: GOOGLE_WEBSITE_ID,
  profileId: GOOGLE_PROFILE_ID,
  environment: "test",
  entitlement: {
    plan,
    state: options.hasPro === false ? "expired" : "active",
    order_confirmed_at: orderConfirmed ? now : null,
    quote_admission: true,
    booking_admission: true,
  },
  isPublished: true,
  isActiveVersion: true,
  serviceActive: options.availabilityConfigured ?? true,
  scheduleActive: options.availabilityConfigured ?? true,
  intervalCount: options.availabilityConfigured === false ? 0 : 5,
  calendarState: projection.state,
  paymentsState: options.payments ?? "ready",
});

export const googleOverviewFixture: GoogleOverviewFixture = {
  overview: {
    mode: options.mode ?? "contractor",
    profile: {
      id: GOOGLE_PROFILE_ID,
      businessName: "Calendar Fixture Business",
      licenseNumber: "MOCK",
      city: "Oakland",
    },
    website: {
      id: GOOGLE_WEBSITE_ID,
      status: "live",
      templateId: "tpl_painter1",
      templateSlug: "painter1",
    },
    plan,
    orderConfirmed,
    readiness: {
      ...readiness,
      calendarConnection: connection,
      providerRefreshEligible: readiness.bookingAdmission,
      calendarAccountEmail: accountEmail,
      paymentDashboardAvailable: true,
      reasonCodes: [...readiness.reasonCodes, ...projection.reasons],
    },
    draft: { exists: false, id: null },
    liveUrl: `/lp/${GOOGLE_WEBSITE_ID}`,
  },
  configuration: {
    connectionRevision: connection.connectionRevision,
    pendingSetup: null,
    accountId,
    accountEmail,
    accountDisplayName: "Saved owner",
    healthState: connection.healthState,
    reconnectReason: connection.reconnectReason,
    verificationReason: connection.reason,
    lastVerifiedAt: connection.lastVerifiedAt,
    triggerState: connection.triggerState,
    triggerLastHealthAt: connection.lastHealthAt,
    reconciliationDueAt: connection.nextRetryAt,
    reconciliationAttempts: 0,
    blockingCalendarIds: selections
      .filter((selection) => selection.blocks_availability)
      .map((_, index) => `calendar-${index}`),
    destinationCalendarId: selections.some((selection) => selection.receives_bookings)
      ? "calendar-0"
      : null,
    canConfigure: options.hasPro !== false && plan === "pro" && orderConfirmed,
    canDisconnectSharedProvider: false,
  },
  requests: [],
  outcomes: options.outcomes ?? {},
  pending: [],
  updateProps: null,
  unmount: null,
};

async function boundary(action: Action, data: WebsiteInput & Record<string, unknown>) {
  const fixture = window.__googleOverviewFixture;
  if (!fixture || !fixture.updateProps)
    throw new Error("Google loaders are only for the Google overview fixture");
  fixture.requests.push({ action, data: structuredClone(data) });
  if (fixture.outcomes[action] === "error") throw new Error(`Fixture ${action} failed`);
  if (fixture.outcomes[action] === "pending") {
    await new Promise<void>((resolve, reject) =>
      fixture.pending.push({
        action,
        websiteId: data.websiteId,
        resolve,
        reject: () => reject(new Error(`Fixture ${action} failed`)),
      }),
    );
  }
}

// Only server-function boundaries are mocked. No OAuth, provider, DB, cron, or real site delivery.
export async function getPurchaserOverview({ data }: { data: WebsiteInput }) {
  const response = structuredClone(window.__googleOverviewFixture.overview);
  await boundary("overview", data);
  return response;
}

export async function loadGoogleCalendarConfiguration({ data }: { data: WebsiteInput }) {
  const response = structuredClone(window.__googleOverviewFixture.configuration);
  await boundary("configuration", data);
  return response;
}

export async function refreshGoogleCalendarConnection({ data }: { data: WebsiteInput }) {
  await boundary("check", data);
}

export async function completeGoogleCalendarConnection({ data }: { data: WebsiteInput }) {
  await boundary("complete", data);
}

export async function startGoogleCalendarConnect({ data }: { data: WebsiteInput }) {
  await boundary("connect", data);
  return { url: new URL("#mock-google-connect", window.location.href).href };
}

export async function discoverGoogleCalendars({
  data,
}: {
  data: WebsiteInput & {
    accountId: string;
    expectedRevision: number;
    expectedSetupKey?: string | null;
  };
}) {
  await boundary("discover", data);
  const { configuration } = window.__googleOverviewFixture;
  if (
    data.accountId !== configuration.accountId ||
    data.expectedRevision !== configuration.connectionRevision
  )
    throw new Error("Google Calendar configuration changed");
  return {
    calendars: [
      { id: "calendar-0", summary: "Work calendar", accessRole: "owner" },
      { id: "calendar-1", summary: "Team calendar", accessRole: "reader" },
    ],
  };
}

export async function saveGoogleCalendarSelection({
  data,
}: {
  data: WebsiteInput & {
    accountId: string;
    expectedRevision: number;
    expectedSetupKey?: string | null;
    blockingCalendarIds: string[];
    destinationCalendarId: string;
  };
}) {
  await boundary("save", data);
  const { configuration, overview } = window.__googleOverviewFixture;
  if (
    data.accountId !== configuration.accountId ||
    data.expectedRevision !== configuration.connectionRevision
  )
    throw new Error("Google Calendar configuration changed");
  configuration.blockingCalendarIds = [...data.blockingCalendarIds];
  configuration.destinationCalendarId = data.destinationCalendarId;
  configuration.connectionRevision = data.expectedRevision + 1;
  overview.readiness.calendarConnection.connectionRevision = configuration.connectionRevision;
}

export async function getBookingSetup({ data }: { data: WebsiteInput }) {
  await boundary("availability", data);
  return {
    configuration: {
      ...structuredClone(availabilityFixture.initial),
      serviceRevision: 2,
      scheduleRevision: 3,
      service: {
        ...availabilityFixture.initial.service,
        name: "Saved consultation",
        amountMinor: 12550,
      },
      intervals: [{ weekday: 1, localStart: "09:00", localEnd: "17:00", sortOrder: 0 }],
    },
  };
}

export async function getLeadsPage() {
  return { leads: [] };
}
export async function getBookingsPage() {
  return { rows: [] };
}
export async function runTemplatePersonalization() {
  throw new Error("Personalization is outside this fixture");
}
export async function getActiveTemplatePersonalization() {
  throw new Error("Personalization lookup is outside this fixture");
}
export async function fetchAgentMessage() {
  throw new Error("Agent messages are outside this fixture");
}
export async function discoverGoogleCalendarAccounts() {
  throw new Error("Account discovery is outside this fixture");
}
export async function getJobProgress() {
  throw new Error("Jobs are outside this fixture");
}
export async function acknowledgeBookingOrder() {
  throw new Error("Order confirmation is outside this fixture");
}
export const supabaseBrowser = {
  auth: {
    signOut: async () => {
      throw new Error("Authentication is outside this fixture");
    },
  },
};
