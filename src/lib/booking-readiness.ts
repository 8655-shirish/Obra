export type SetupStep =
  "order_confirmation" | "calendar" | "availability" | "payments" | "complete" | null;
export type ProviderSetupState = "not_configured" | "pending" | "ready" | "restricted";

export type BookingReadinessProjection = {
  websiteId: string;
  profileId: string;
  environment: "test" | "live";
  plan: "starter" | "pro" | null;
  orderConfirmed: boolean;
  firstIncompleteStep: SetupStep;
  nextRoute: "overview" | "calendar" | "availability" | "payments" | "workspace";
  firstIncompleteLabel: string | null;
  nextPath: string;
  calendar: ProviderSetupState;
  availability: "not_configured" | "configured";
  payments: ProviderSetupState;
  publicMode: "demo" | "starter_leads" | "live_booking" | "configuration_pending" | "unavailable";
  showDemo: boolean;
  showLeadForm: boolean;
  entitlementUnavailable: boolean;
  bookingAdmission: boolean;
  reasonCodes: string[];
};

export function deriveBucketOneReadiness(input: {
  websiteId: string;
  profileId: string;
  environment: "test" | "live";
  entitlement: {
    plan: "starter" | "pro";
    state?: string;
    quote_admission?: boolean;
    booking_admission?: boolean;
    order_confirmed_at: string | null;
  } | null;
  isPublished?: boolean;
  isActiveVersion?: boolean;
  entitlementTemporallyEligible?: boolean;
  serviceActive: boolean;
  scheduleActive: boolean;
  intervalCount: number;
  calendarState?: ProviderSetupState;
  paymentsState?: ProviderSetupState;
}): BookingReadinessProjection {
  const availabilityConfigured =
    input.serviceActive && input.scheduleActive && input.intervalCount > 0;
  const orderConfirmed = Boolean(input.entitlement?.order_confirmed_at);
  const plan = input.entitlement?.plan ?? null;
  const calendar = input.calendarState ?? "not_configured";
  const payments = input.paymentsState ?? "not_configured";
  const entitlementEligible =
    input.entitlementTemporallyEligible !== false &&
    (input.entitlement?.state === undefined ||
      input.entitlement.state === "active" ||
      input.entitlement.state === "grace");
  const entitlementUnavailable = Boolean(input.entitlement) && !entitlementEligible;
  const showDemo = !input.entitlement;
  const showLeadForm = Boolean(
    input.isPublished &&
    input.isActiveVersion &&
    entitlementEligible &&
    (plan === "starter" || plan === "pro") &&
    input.entitlement?.quote_admission,
  );
  const bookingAdmission = Boolean(
    entitlementEligible &&
    input.entitlement?.booking_admission === true &&
    plan === "pro" &&
    orderConfirmed &&
    availabilityConfigured &&
    calendar === "ready" &&
    payments === "ready" &&
    input.isPublished &&
    input.isActiveVersion,
  );
  const publicMode = showDemo
    ? "demo"
    : entitlementUnavailable
      ? "unavailable"
      : bookingAdmission
        ? "live_booking"
        : showLeadForm
          ? "starter_leads"
          : "configuration_pending";
  const firstIncompleteStep: SetupStep =
    plan !== "pro"
      ? null
      : !orderConfirmed
        ? "order_confirmation"
        : calendar !== "ready"
          ? "calendar"
          : !availabilityConfigured
            ? "availability"
            : payments !== "ready"
              ? "payments"
              : "complete";
  const nextRoute =
    firstIncompleteStep === "order_confirmation"
      ? "overview"
      : firstIncompleteStep === "calendar"
        ? "calendar"
        : firstIncompleteStep === "availability"
          ? "availability"
          : firstIncompleteStep === "payments"
            ? "payments"
            : "workspace";
  const firstIncompleteLabel =
    firstIncompleteStep === "order_confirmation"
      ? "Confirm Pro order"
      : firstIncompleteStep === "calendar"
        ? calendar === "restricted"
          ? "Repair Google Calendar"
          : "Connect Google Calendar"
        : firstIncompleteStep === "availability"
          ? "Set availability and price"
          : firstIncompleteStep === "payments"
            ? payments === "restricted"
              ? "Repair Stripe payments"
              : "Connect Stripe payments"
            : null;
  const overviewPath = `/user/${input.profileId}?websiteId=${input.websiteId}`;
  const nextPath =
    nextRoute === "workspace"
      ? overviewPath
      : nextRoute === "overview"
        ? `${overviewPath}#top`
        : nextRoute === "calendar"
          ? `${overviewPath}#step-2`
          : nextRoute === "availability"
            ? `${overviewPath}#step-3`
            : `${overviewPath}#step-4`;
  const reasonCodes: string[] = [];
  if (calendar !== "ready") reasonCodes.push("calendar_provider_not_ready");
  if (!availabilityConfigured) reasonCodes.push("availability_not_configured");
  if (payments !== "ready") reasonCodes.push("payments_provider_not_ready");
  if (plan !== "pro") reasonCodes.unshift("pro_entitlement_required");
  return {
    websiteId: input.websiteId,
    profileId: input.profileId,
    environment: input.environment,
    plan,
    orderConfirmed,
    firstIncompleteStep,
    nextRoute,
    firstIncompleteLabel,
    nextPath,
    calendar,
    availability: availabilityConfigured ? "configured" : "not_configured",
    payments,
    publicMode,
    showDemo,
    showLeadForm,
    entitlementUnavailable,
    bookingAdmission,
    reasonCodes,
  };
}
