import type { ComponentProps } from "react";
import type { StepFourCard } from "../../../../src/components/purchaser/SetupStepCards";
import type { getStripeConnectStatus as getStatus } from "../../../../src/lib/stripe-connect.functions";

type StatusResponse = Awaited<ReturnType<typeof getStatus>>;
// Fixtures deliberately combine mismatched environments to exercise the UI guard.
export type StripeStatus = { [Key in keyof StatusResponse]: StatusResponse[Key] };
export type StripeConnectProps = Pick<
  ComponentProps<typeof StepFourCard>,
  "websiteId" | "userId" | "locked" | "connect"
>;
type Outcome = "success" | "pending" | "error";
type WebsiteInput = { websiteId: string; returnPath?: string };

export type StripeConnectOptions = {
  status?: Partial<StripeStatus>;
  hasPro?: boolean;
  locked?: boolean;
  statusOutcome?: Outcome;
};

type StripeConnectFixture = {
  status: StripeStatus;
  statusOutcome: Outcome;
  verifyOutcome: Outcome;
  verifyStatus: StripeStatus | null;
  verifyError: string;
  requests: { action: "status" | "onboarding" | "verify" | "dashboard"; data: WebsiteInput }[];
  resolveStatus: (() => void) | null;
  resolveVerify: (() => void) | null;
  onChangedCalls: number;
  onConnectConsumedCalls: number;
  updateProps: ((next: Partial<StripeConnectProps>) => void) | null;
};

declare global {
  interface Window {
    __stripeConnectOptions?: StripeConnectOptions;
    __stripeConnectFixture: StripeConnectFixture;
  }
}

const options = window.__stripeConnectOptions ?? {};
const status: StripeStatus = {
  workspaceEnvironment: "test",
  stripeEnvironment: "test",
  environmentError: null,
  connected: false,
  onboardingState: "not_started",
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  currentlyDueCount: 0,
  pastDueCount: 0,
  pendingVerificationCount: 0,
  cardPaymentsActive: false,
  snapshotFresh: false,
  reconnectReason: null,
  lastVerifiedAt: null,
  ...options.status,
  canOnboard: false,
};
status.canOnboard =
  (options.hasPro ?? true) &&
  status.environmentError === null &&
  status.workspaceEnvironment === status.stripeEnvironment;

export const stripeConnectFixture: StripeConnectFixture = {
  status,
  statusOutcome: options.statusOutcome ?? "success",
  verifyOutcome: "success",
  verifyStatus: null,
  verifyError: "Unable to verify Stripe status. Please try again.",
  requests: [],
  resolveStatus: null,
  resolveVerify: null,
  onChangedCalls: 0,
  onConnectConsumedCalls: 0,
  updateProps: null,
};

export async function getStripeConnectStatus({ data }: { data: WebsiteInput }) {
  const fixture = window.__stripeConnectFixture;
  fixture.requests.push({ action: "status", data: structuredClone(data) });
  if (fixture.statusOutcome === "pending") {
    await new Promise<void>((resolve) => {
      fixture.resolveStatus = resolve;
    });
    fixture.resolveStatus = null;
  }
  if (fixture.statusOutcome === "error") throw new Error("Fixture Stripe status load failed");
  return structuredClone(fixture.status);
}

export async function reconcileStripeConnect({ data }: { data: WebsiteInput }) {
  const fixture = window.__stripeConnectFixture;
  fixture.requests.push({ action: "verify", data: structuredClone(data) });
  if (fixture.verifyOutcome === "pending") {
    await new Promise<void>((resolve) => {
      fixture.resolveVerify = resolve;
    });
    fixture.resolveVerify = null;
  }
  if (fixture.verifyOutcome === "error") throw new Error(fixture.verifyError);
  fixture.status = structuredClone(fixture.verifyStatus ?? fixture.status);
  return structuredClone(fixture.status);
}

export async function startStripeConnectOnboarding({ data }: { data: WebsiteInput }) {
  window.__stripeConnectFixture.requests.push({
    action: "onboarding",
    data: structuredClone(data),
  });
  return { url: new URL("#stripe-onboarding", window.location.href).href };
}

export async function openStripeExpressDashboard({ data }: { data: WebsiteInput }) {
  window.__stripeConnectFixture.requests.push({ action: "dashboard", data: structuredClone(data) });
  return { url: new URL("#stripe-dashboard", window.location.href).href };
}
