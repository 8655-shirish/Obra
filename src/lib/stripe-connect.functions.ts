import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const websiteInput = z.object({ websiteId: z.string().uuid() });

type Environment = "test" | "live";

async function contractorConnectOwnerContext(websiteId: string) {
  const { providerOwnerContext } = await import("@/lib/provider-authorization.server");
  return providerOwnerContext(websiteId, "Stripe");
}

async function contractorConnectMutationContext(websiteId: string) {
  const { providerMutationContext } = await import("@/lib/provider-authorization.server");
  return providerMutationContext(websiteId, "Stripe");
}

async function loadStatus(websiteId: string) {
  const context = await contractorConnectOwnerContext(websiteId);
  const { profile, website, supabaseAdmin } = context;
  const { data, error } = await supabaseAdmin
    .from("stripe_connected_accounts")
    .select(
      "stripe_account_id,onboarding_state,charges_enabled,payouts_enabled,details_submitted,capabilities,requirements,reconnect_reason,last_verified_at",
    )
    .eq("profile_id", profile.id)
    .eq("environment", website.environment)
    .maybeSingle();
  if (error) throw new Error("Unable to load Stripe account status");
  const requirements =
    data?.requirements && typeof data.requirements === "object" && !Array.isArray(data.requirements)
      ? (data.requirements as Record<string, unknown>)
      : {};
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  const { hasCurrentActiveConfirmedPro } = await import("@/lib/provider-authorization.server");
  const { getStripeConnectEnvironment } = await import("@/lib/stripe-connect.server");
  const environment = getStripeConnectEnvironment(website.environment as Environment);
  const hasPro = await hasCurrentActiveConfirmedPro(context);
  return {
    ...environment,
    connected: Boolean(data?.stripe_account_id),
    onboardingState: (data?.onboarding_state ?? "not_started") as
      "not_started" | "pending" | "ready" | "restricted" | "disabled",
    chargesEnabled: Boolean(data?.charges_enabled),
    payoutsEnabled: Boolean(data?.payouts_enabled),
    detailsSubmitted: Boolean(data?.details_submitted),
    currentlyDueCount: count(requirements.currently_due),
    pastDueCount: count(requirements.past_due),
    pendingVerificationCount: count(requirements.pending_verification),
    cardPaymentsActive: Boolean(
      data?.capabilities &&
      typeof data.capabilities === "object" &&
      !Array.isArray(data.capabilities) &&
      (data.capabilities as Record<string, unknown>).card_payments === "active",
    ),
    snapshotFresh: Boolean(
      data?.last_verified_at &&
      Number.isFinite(Date.parse(data.last_verified_at)) &&
      Date.parse(data.last_verified_at) >= Date.now() - 15 * 60 * 1000 &&
      Date.parse(data.last_verified_at) <= Date.now() + 60_000,
    ),
    reconnectReason: data?.reconnect_reason ?? null,
    lastVerifiedAt: data?.last_verified_at ?? null,
    canOnboard: hasPro && environment.environmentError === null,
  };
}

export const getStripeConnectStatus = createServerFn({ method: "GET" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(({ data }) => loadStatus(data.websiteId));

export const startStripeConnectOnboarding = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    websiteInput.extend({ returnPath: z.string().regex(/^\//).max(200).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const context = await contractorConnectMutationContext(data.websiteId);
    const { assertStripeEnvironment, createOrReuseStripeConnectOnboarding } =
      await import("@/lib/stripe-connect.server");
    assertStripeEnvironment(context.website.environment as Environment);
    const { loadBookingReadinessFacts } = await import("@/lib/booking-readiness.server");
    const readiness = await loadBookingReadinessFacts({
      websiteId: context.website.id,
      profileId: context.profile.id,
      environment: context.website.environment as Environment,
      isPublished: false,
      isActiveVersion: true,
    });
    if (readiness.calendar !== "ready" || readiness.availability !== "configured")
      throw new Error("Complete Google Calendar and availability before connecting Stripe");
    return createOrReuseStripeConnectOnboarding({
      profileId: context.profile.id,
      environment: context.website.environment as Environment,
      authUserId: context.authUserId,
      websiteId: context.website.id,
      email: context.profile.email,
      ...(data.returnPath ? { returnPath: data.returnPath } : {}),
    });
  });

export const reconcileStripeConnect = createServerFn({ method: "POST" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(async ({ data }) => {
    const context = await contractorConnectOwnerContext(data.websiteId);
    const { reconcileStripeConnectAccount } = await import("@/lib/stripe-connect.server");
    await reconcileStripeConnectAccount({
      profileId: context.profile.id,
      environment: context.website.environment as Environment,
    });
    return loadStatus(data.websiteId);
  });

export const openStripeExpressDashboard = createServerFn({ method: "POST" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(async ({ data }) => {
    const context = await contractorConnectOwnerContext(data.websiteId);
    const { createStripeExpressLoginLink } = await import("@/lib/stripe-connect.server");
    return createStripeExpressLoginLink({
      profileId: context.profile.id,
      environment: context.website.environment as Environment,
    });
  });
