import { rpcNullable } from "@/lib/rpc-nullable";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { withSemanticTypes } from "@/integrations/supabase/semantic-client";


import { asOnboardingRecord } from "@/lib/onboarding-state";
import { templateSlugInput, resolveTemplatePurchaseIdentity } from "@/lib/template-content/overlay";
import { PLANS_BY_ID, type PlanId } from "@/lib/plans";
import type { VerifiedPlanOffer } from "@/lib/stripe.server";

/**
 * Server-only dependencies are loaded lazily. A static import pulls the Stripe
 * and profile server modules (and their node: built-ins) into the browser graph,
 * which crashes every page that imports this module.
 */
type CheckoutServerModules = {
  profile: typeof import("@/lib/auth/profile.server");
  stripe: typeof import("@/lib/stripe.server");
};
let serverModules: CheckoutServerModules | null = null;
async function loadCheckoutServerModules(): Promise<CheckoutServerModules> {
  if (!serverModules) {
    const [profile, stripe] = await Promise.all([
      import("@/lib/auth/profile.server"),
      import("@/lib/stripe.server"),
    ]);
    serverModules = { profile, stripe };
  }
  return serverModules;
}
function srv(): CheckoutServerModules {
  if (!serverModules) throw new Error("Checkout server modules are not loaded");
  return serverModules;
}

type ProfileModule = CheckoutServerModules["profile"];
type StripeModule = CheckoutServerModules["stripe"];
const ensureWebsiteForProfile: ProfileModule["ensureWebsiteForProfile"] = (...args) =>
  srv().profile.ensureWebsiteForProfile(...args);
const findProfileByLicense: ProfileModule["findProfileByLicense"] = (...args) =>
  srv().profile.findProfileByLicense(...args);
const normalizeLicenseNumber: ProfileModule["normalizeLicenseNumber"] = (...args) =>
  srv().profile.normalizeLicenseNumber(...args);
const assertSaasCheckoutChargingEnabled: StripeModule["assertSaasCheckoutChargingEnabled"] = (
  ...args
) => srv().stripe.assertSaasCheckoutChargingEnabled(...args);
const expireStripeCheckoutSession: StripeModule["expireStripeCheckoutSession"] = (...args) =>
  srv().stripe.expireStripeCheckoutSession(...args);
const billingEnvironment: StripeModule["billingEnvironment"] = (...args) =>
  srv().stripe.billingEnvironment(...args);
const getStripe: StripeModule["getStripe"] = (...args) => srv().stripe.getStripe(...args);
const publicAppUrl: StripeModule["publicAppUrl"] = (...args) => srv().stripe.publicAppUrl(...args);
const saasCheckoutAvailable: StripeModule["saasCheckoutAvailable"] = (...args) =>
  srv().stripe.saasCheckoutAvailable(...args);
const stripeConfigured: StripeModule["stripeConfigured"] = (...args) =>
  srv().stripe.stripeConfigured(...args);
const verifiedOfferForPlan: StripeModule["verifiedOfferForPlan"] = (...args) =>
  srv().stripe.verifiedOfferForPlan(...args);

type SupabaseAdmin = SupabaseClient<Database>;

async function checkoutLegalDocumentVersions(): Promise<Json> {
  const { checkoutLegalEvidence } = await import("@/lib/legal-documents.server");
  return checkoutLegalEvidence() as unknown as Json;
}

const RESERVATION_SAFE_CODES = new Set([
  "22023",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "42501",
  "55P03",
  "57014",
  "P0001",
  "PGRST003",
  "PGRST202",
  "PGRST203",
]);
const RESERVATION_SAFE_MESSAGES = new Set([
  "invalid checkout reservation",
  "checkout offer is not an active verified new-sales contract",
  "website tenant mismatch",
  "checkout payment finalization is still in progress",
  "paid checkout already awaits verification for different identity",
  "provider checkout already active for different intent",
  "website not found for checkout",
  "account belongs to a different billing environment",
  "authenticated checkout requires an explicit website",
  "authenticated checkout email mismatch",
  "contractor profile is not available for public checkout",
]);

function safeReservationFailureCode(error: { code?: unknown } | null, status?: number): string {
  const code = typeof error?.code === "string" ? error.code : "";
  if (status === 0 && !code) return "transport";
  return RESERVATION_SAFE_CODES.has(code) ? code : "unclassified";
}

function safeReservationFailureMessage(error: { message?: unknown } | null): string {
  const message = typeof error?.message === "string" ? error.message : "";
  return RESERVATION_SAFE_MESSAGES.has(message) ? message : "unclassified";
}

type CheckoutFailureReference =
  | "CHK-V01"
  | "CHK-G01"
  | "CHK-C01"
  | "CHK-C02"
  | "CHK-O01"
  | "CHK-L01"
  | "CHK-L02"
  | "CHK-L03"
  | "CHK-D01"
  | "CHK-D02"
  | "CHK-W01"
  | "CHK-W02"
  | "CHK-P01"
  | "CHK-P02"
  | "CHK-P03"
  | "CHK-P04"
  | "CHK-P05"
  | "CHK-P99"
  | "CHK-R01"
  | "CHK-R02"
  | "CHK-R03"
  | "CHK-R04"
  | "CHK-R05"
  | "CHK-R06"
  | "CHK-R07"
  | "CHK-R08"
  | "CHK-R09"
  | "CHK-R10"
  | "CHK-R11"
  | "CHK-R12"
  | "CHK-R13"
  | "CHK-R14"
  | "CHK-R15"
  | "CHK-R16"
  | "CHK-R17"
  | "CHK-R18"
  | "CHK-R19"
  | "CHK-O02"
  | "CHK-S01"
  | "CHK-T01";

class ReferencedCheckoutError extends Error {
  constructor(
    message: string,
    readonly reference: CheckoutFailureReference,
  ) {
    super(`${message} Support reference: ${reference}.`);
    this.name = "ReferencedCheckoutError";
  }
}

function checkoutValidationFailure(): ReferencedCheckoutError {
  const reference = "CHK-V01" as const;
  console.error("[saas_checkout_failure_reference]", {
    event: "saas_checkout_failure_reference",
    reference,
  });
  return new ReferencedCheckoutError("Unable to validate checkout request", reference);
}

function checkoutFailure(
  message: string,
  reference: CheckoutFailureReference,
  plan: PlanId,
  environment: "test" | "live" | "unknown",
): ReferencedCheckoutError {
  // Only code-owned values are logged or returned. Never add request fields, legal evidence, raw
  // provider/database errors, identifiers, or secrets to this event or browser-safe error.
  console.error("[saas_checkout_failure_reference]", {
    event: "saas_checkout_failure_reference",
    reference,
    environment,
    plan,
  });
  return new ReferencedCheckoutError(message, reference);
}

function reservationFailureReference(code: string, message: string): CheckoutFailureReference {
  if (code === "missing_reservation") return "CHK-R01";
  if (message === "invalid checkout reservation") return "CHK-R02";
  if (message === "checkout offer is not an active verified new-sales contract") return "CHK-R03";
  if (message === "website tenant mismatch") return "CHK-R04";
  if (message === "checkout payment finalization is still in progress") return "CHK-R05";
  if (message === "paid checkout already awaits verification for different identity")
    return "CHK-R06";
  if (message === "provider checkout already active for different intent") return "CHK-R07";
  if (message === "website not found for checkout") return "CHK-L01";
  if (message === "account belongs to a different billing environment") return "CHK-P01";
  if (message === "authenticated checkout requires an explicit website") return "CHK-P04";
  if (message === "authenticated checkout email mismatch") return "CHK-P05";
  if (message === "contractor profile is not available for public checkout") return "CHK-P03";
  if (code === "PGRST202") return "CHK-R08";
  if (code === "PGRST203") return "CHK-R09";
  if (code === "42501") return "CHK-R10";
  if (code === "23505") return "CHK-R11";
  if (code === "22023") return "CHK-R13";
  if (code === "P0001") return "CHK-R14";
  if (code === "PGRST003") return "CHK-R15";
  if (code === "57014" || code === "55P03") return "CHK-R16";
  if (code === "40001" || code === "40P01") return "CHK-R17";
  if (code === "23502" || code === "23503" || code === "23514") return "CHK-R18";
  if (code === "transport") return "CHK-R19";
  return "CHK-R12";
}

function checkoutBrowserMessage(message: string): string {
  switch (message) {
    case "website not found for checkout":
      return "Website not found for checkout";
    case "account belongs to a different billing environment":
      return "This account belongs to a different billing environment.";
    case "authenticated checkout requires an explicit website":
      return "Log in and purchase from the website you want to activate.";
    case "authenticated checkout email mismatch":
      return "This account uses a different email. Log in to continue.";
    case "contractor profile is not available for public checkout":
      return "This contractor profile is not available for public checkout.";
    case "paid checkout already awaits verification for different identity":
      return "A paid checkout is already awaiting verification for another purchase.";
    default:
      return "Unable to reserve checkout";
  }
}

type CheckoutStage =
  "request" | "durable_begin" | "offer_verification" | "stripe_session" | "provider_attachment";

function logCheckoutStage(input: {
  attemptId: string;
  stage: CheckoutStage;
  outcome: "started" | "succeeded" | "failed";
  environment: "test" | "live";
  plan: PlanId;
  startedAt: number;
  classification?: string;
  disposition?: string;
  httpStatus?: number;
}): void {
  // Keep this event correlation-safe and non-identifying. Never add profile, website, checkout,
  // provider object, request, legal-evidence, or customer fields.
  console.info("[saas_checkout_stage]", {
    event: "saas_checkout_stage",
    attemptId: input.attemptId,
    stage: input.stage,
    outcome: input.outcome,
    environment: input.environment,
    plan: input.plan,
    durationMs: Math.max(0, Date.now() - input.startedAt),
    ...(input.classification ? { classification: input.classification } : {}),
    ...(input.disposition ? { disposition: input.disposition } : {}),
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
  });
}

function preparationFailureReference(error: unknown): {
  message: string;
  reference: CheckoutFailureReference;
} {
  const message = error instanceof Error ? error.message : "";
  switch (message) {
    case "Website not found for checkout":
      return { message, reference: "CHK-L01" };
    case "This website is not available for purchase with that license.":
      return { message, reference: "CHK-L02" };
    case "License number does not match this website.":
      return { message, reference: "CHK-L03" };
    case "Unable to look up license":
      return { message, reference: "CHK-D01" };
    case "Unable to create profile for checkout":
      return { message, reference: "CHK-D02" };
    case "Unable to reserve checkout website":
    case "Unable to load website owner environment":
      return { message: "Unable to reserve checkout website", reference: "CHK-W01" };
    case "Unable to create website":
      return { message: "Unable to reserve checkout website", reference: "CHK-W02" };
    case "This account belongs to a different billing environment.":
      return { message, reference: "CHK-P01" };
    case "This account uses a different email. Log in to purchase another website.":
      return { message, reference: "CHK-P02" };
    case "This contractor profile is not available for public checkout.":
      return { message, reference: "CHK-P03" };
    case "Log in and purchase from the website you want to activate.":
      return { message, reference: "CHK-P04" };
    case "This account uses a different email. Log in to continue.":
      return { message, reference: "CHK-P05" };
    default:
      return { message: "Unable to prepare checkout", reference: "CHK-P99" };
  }
}

const planSchema = z.enum(["starter", "pro"]);

const checkoutContextSchema = z.object({
  email: z.string().trim().email(),
  licenseNumber: z.string().trim().min(1).max(50),
  businessName: z.string().trim().min(1).max(200),
  fullName: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(200),
  websiteId: z.string().uuid().optional(),
  templateSlug: templateSlugInput.optional(),
  templateId: z.string().trim().min(1).max(60).optional(),
  plan: planSchema,
  acceptedLegal: z.literal(true),
});

const checkoutRowSchema = checkoutContextSchema.omit({ acceptedLegal: true });

const verifyCheckoutOtpSchema = z.object({
  checkoutSessionId: z.string().uuid(),
  email: z.string().trim().email(),
  token: z.string().trim().min(6).max(8),
});

const resendCheckoutOtpSchema = verifyCheckoutOtpSchema.omit({ token: true });

const begunCheckoutSchema = z.object({
  profile_id: z.string().uuid(),
  website_id: z.string().uuid(),
  checkout_session_id: z.string().uuid(),
  subscription_id: z.string().uuid(),
  checkout_status: z.enum(["pending_payment", "pending_otp"]),
  checkout_email: z.string().email(),
  checkout_plan: planSchema,
  disposition: z.enum(["created", "reused_pending_payment", "reused_pending_otp"]),
  provider_session_id: z.string().min(1).nullable(),
  offer_contract_version: z.literal(1),
  offer_price_id: z.string().min(1),
  offer_product_id: z.string().min(1),
  offer_currency: z.literal("usd"),
  offer_unit_amount_minor: z.number().int().positive(),
  offer_interval: z.literal("month"),
  offer_interval_count: z.literal(1),
});

type BegunCheckout = z.infer<typeof begunCheckoutSchema>;

function frozenOfferFromCheckout(
  row: BegunCheckout,
  environment: "test" | "live",
): VerifiedPlanOffer {
  return {
    contractVersion: 1,
    plan: row.checkout_plan,
    livemode: environment === "live",
    priceId: row.offer_price_id,
    productId: row.offer_product_id,
    currency: "usd",
    unitAmountMinor: row.offer_unit_amount_minor,
    interval: "month",
    intervalCount: 1,
    productName: `Obra ${PLANS_BY_ID[row.checkout_plan].name}`,
    productDescription: PLANS_BY_ID[row.checkout_plan].summary,
  };
}

function offerMismatchFields(frozen: VerifiedPlanOffer, observed: VerifiedPlanOffer): string[] {
  const fields: Array<keyof VerifiedPlanOffer> = [
    "contractVersion",
    "plan",
    "livemode",
    "priceId",
    "productId",
    "currency",
    "unitAmountMinor",
    "interval",
    "intervalCount",
    "productName",
  ];
  return fields.filter((field) => frozen[field] !== observed[field]);
}

async function sendCheckoutOtp(email: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { createSupabaseAuthClient } = await import("@/integrations/supabase/auth-server.server");

  const { assertOtpRateLimit } = await import("@/lib/auth/contractor-session.server");
  await assertOtpRateLimit(supabaseAdmin, email, "checkout");

  const authClient = createSupabaseAuthClient();
  const { error: otpError } = await authClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (otpError) {
    console.error("[sendCheckoutOtp]", otpError);
    throw new Error("Unable to send verification code");
  }
}

async function sendCheckoutOtpOnce(
  supabaseAdmin: SupabaseAdmin,
  checkoutSessionId: string,
  email: string,
): Promise<void> {
  const { data: checkout, error: lookupError } = await supabaseAdmin
    .from("checkout_sessions")
    .select("otp_delivery_claimed_at")
    .eq("id", checkoutSessionId)
    .single();
  if (lookupError || !checkout) throw new Error("Unable to load verification delivery");

  const previousClaim = checkout.otp_delivery_claimed_at;
  const staleBefore = Date.now() - 5 * 60 * 1000;
  if (previousClaim && new Date(previousClaim).getTime() >= staleBefore) return;

  const claimAt = new Date().toISOString();
  let claim = supabaseAdmin
    .from("checkout_sessions")
    .update({ otp_delivery_claimed_at: claimAt })
    .eq("id", checkoutSessionId)
    .eq("status", "pending_otp")
    .or("payment_verified_at.not.is.null,payment_evidence_kind.eq.legacy_post_payment");
  claim = previousClaim
    ? claim.eq("otp_delivery_claimed_at", previousClaim)
    : claim.is("otp_delivery_claimed_at", null);
  const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
  if (claimError) throw new Error("Unable to reserve verification delivery");
  if (!claimed) return;

  try {
    await sendCheckoutOtp(email);
  } catch (error) {
    const { error: releaseError } = await supabaseAdmin
      .from("checkout_sessions")
      .update({ otp_delivery_claimed_at: null })
      .eq("id", checkoutSessionId)
      .eq("otp_delivery_claimed_at", claimAt);
    if (releaseError) console.error("[sendCheckoutOtpOnce] release", releaseError);
    throw error;
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function assertWebsiteMatchesLicense(
  supabaseAdmin: SupabaseAdmin,
  websiteId: string,
  licenseNumber: string,
): Promise<{ userId: string }> {
  const { data: website, error } = await supabaseAdmin
    .from("websites")
    .select("id, user_id")
    .eq("id", websiteId)
    .maybeSingle();

  if (error || !website) {
    throw new Error("Website not found for checkout");
  }

  const owner = await supabaseAdmin
    .from("profiles")
    .select("license_number")
    .eq("id", website.user_id)
    .maybeSingle();

  const ownerLicense = asNonEmptyString(owner.data?.license_number);
  const expected = ownerLicense ? [normalizeLicenseNumber(ownerLicense)] : [];

  if (!expected.length) {
    throw new Error("This website is not available for purchase with that license.");
  }

  if (!expected.includes(licenseNumber)) {
    throw new Error("License number does not match this website.");
  }

  return { userId: website.user_id };
}

async function upsertProfileForCheckout(
  supabaseAdmin: SupabaseAdmin,
  input: {
    licenseNumber: string;
    email: string;
    fullName: string;
    businessName: string;
    city: string;
    environment: "test" | "live";
  },
): Promise<string> {
  const existing = await findProfileByLicense(supabaseAdmin, input.licenseNumber);

  if (existing && existing.environment !== input.environment) {
    throw new Error("This account belongs to a different billing environment.");
  }

  if (existing?.auth_user_id) {
    if (!existing.email || existing.email.toLowerCase() !== input.email.toLowerCase()) {
      throw new Error("This account uses a different email. Log in to purchase another website.");
    }
    return existing.id;
  }

  if (existing) {
    // Admin kickoff and other enrichment paths pre-create unowned contractor
    // profiles. Public checkout must not turn knowledge of a license into a
    // claim. Only a grandfathered post-payment checkout may reuse that row.
    if (
      !existing.checkout_claimable_at ||
      existing.checkout_claim_email !== input.email.trim().toLowerCase()
    ) {
      throw new Error("This contractor profile is not available for public checkout.");
    }
    return existing.id;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .insert({
      license_number: input.licenseNumber,
      full_name: input.fullName,
      business_name: input.businessName,
      city: input.city,
      auth_user_id: null,
      checkout_claimable_at: new Date().toISOString(),
      checkout_claim_email: input.email.trim().toLowerCase(),
      environment: input.environment,
    })
    .select("id")
    .single();

  if (profile) return profile.id;

  // Concurrent first purchases for the same normalized license converge on the
  // unique profile row instead of failing after the other transaction commits.
  if (profileError?.code === "23505") {
    const winner = await findProfileByLicense(supabaseAdmin, input.licenseNumber);
    if (!winner || winner.environment !== input.environment) {
      throw new Error("This account belongs to a different billing environment.");
    }
    if (
      winner.auth_user_id &&
      (!winner.email || winner.email.toLowerCase() !== input.email.toLowerCase())
    ) {
      throw new Error("This account uses a different email. Log in to purchase another website.");
    }
    if (
      !winner.auth_user_id &&
      (!winner.checkout_claimable_at ||
        winner.checkout_claim_email !== input.email.trim().toLowerCase())
    ) {
      throw new Error("This contractor profile is not available for public checkout.");
    }
    return winner.id;
  }

  console.error("[upsertProfileForCheckout] insert", profileError);
  throw new Error("Unable to create profile for checkout");
}

async function ensureCheckoutWebsite(supabaseAdmin: SupabaseAdmin, profileId: string) {
  const { data, error } = await supabaseAdmin.rpc("ensure_checkout_website", {
    p_profile_id: profileId,
  });
  if (error || !data) throw new Error("Unable to reserve checkout website");
  return data;
}

async function createStripeCheckout(opts: {
  attemptId: string;
  startedAt: number;
  environment: "test" | "live";
  checkoutSessionId: string;
  email: string;
  plan: PlanId;
  licenseNumber: string;
  websiteId?: string;
  providerSessionId: string | null;
  offer: VerifiedPlanOffer;
}): Promise<string> {
  if (!stripeConfigured()) {
    throw new Error("Payments are not configured yet. Please try again later.");
  }
  assertSaasCheckoutChargingEnabled();

  const stripe = getStripe();
  if (opts.offer.plan !== opts.plan)
    throw new Error("Checkout offer does not match the reserved plan");
  const priceId = opts.offer.priceId;
  const base = publicAppUrl();
  const cancelUrl = opts.websiteId ? `${base}/lp/${opts.websiteId}` : `${base}/#pricing`;

  logCheckoutStage({
    attemptId: opts.attemptId,
    stage: "stripe_session",
    outcome: "started",
    environment: opts.environment,
    plan: opts.plan,
    startedAt: opts.startedAt,
  });
  let session: Awaited<
    ReturnType<
      ReturnType<typeof getStripe>["checkout"]["sessions"]["create"]
    >
  >;
  try {
    session = opts.providerSessionId
      ? await stripe.checkout.sessions.retrieve(opts.providerSessionId)
      : await stripe.checkout.sessions.create(
          {
            mode: "subscription",
            currency: "usd",
            adaptive_pricing: { enabled: false },
            automatic_tax: { enabled: false },
            allow_promotion_codes: false,
            customer_email: opts.email,
            // Bucket 1 supports immediate card settlement only. This deliberately avoids
            // async completion states until their webhook transitions exist in Bucket 2.
            payment_method_types: ["card"],
            client_reference_id: opts.checkoutSessionId,
            line_items: [{ price: priceId, quantity: 1, tax_rates: [] }],
            success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl,
            metadata: {
              kind: "saas",
              plan: opts.plan,
              websiteId: opts.websiteId ?? "",
              licenseNumber: opts.licenseNumber,
              checkoutSessionId: opts.checkoutSessionId,
              offerContractVersion: String(opts.offer.contractVersion),
              offerPriceId: opts.offer.priceId,
              offerProductId: opts.offer.productId,
              offerAmountMinor: String(opts.offer.unitAmountMinor),
              offerCurrency: opts.offer.currency,
              offerInterval: opts.offer.interval,
              offerIntervalCount: String(opts.offer.intervalCount),
            },
            subscription_data: {
              default_tax_rates: [],
              metadata: {
                kind: "saas",
                plan: opts.plan,
                licenseNumber: opts.licenseNumber,
                checkoutSessionId: opts.checkoutSessionId,
                offerContractVersion: String(opts.offer.contractVersion),
                offerPriceId: opts.offer.priceId,
                offerProductId: opts.offer.productId,
                offerAmountMinor: String(opts.offer.unitAmountMinor),
                offerCurrency: opts.offer.currency,
                offerInterval: opts.offer.interval,
                offerIntervalCount: String(opts.offer.intervalCount),
              },
            },
          },
          { idempotencyKey: `saas-checkout:${opts.checkoutSessionId}` },
        );
  } catch (error) {
    logCheckoutStage({
      attemptId: opts.attemptId,
      stage: "stripe_session",
      outcome: "failed",
      environment: opts.environment,
      plan: opts.plan,
      startedAt: opts.startedAt,
      classification: error instanceof Error ? error.name : "provider_error",
    });
    throw error;
  }
  logCheckoutStage({
    attemptId: opts.attemptId,
    stage: "stripe_session",
    outcome: "succeeded",
    environment: opts.environment,
    plan: opts.plan,
    startedAt: opts.startedAt,
  });

  if (
    !session.url ||
    session.status !== "open" ||
    session.mode !== "subscription" ||
    session.livemode !== (opts.environment === "live") ||
    session.client_reference_id !== opts.checkoutSessionId ||
    session.metadata?.checkoutSessionId !== opts.checkoutSessionId ||
    session.metadata?.offerPriceId !== opts.offer.priceId ||
    session.metadata?.offerProductId !== opts.offer.productId
  ) {
    throw new Error("Unable to start checkout");
  }

  if (opts.providerSessionId) return session.url;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  logCheckoutStage({
    attemptId: opts.attemptId,
    stage: "provider_attachment",
    outcome: "started",
    environment: opts.environment,
    plan: opts.plan,
    startedAt: opts.startedAt,
  });
  const { data: attachment, error } = await supabaseAdmin.rpc(
    "attach_saas_checkout_provider_session",
    {
      p_checkout_session_id: opts.checkoutSessionId,
      p_provider_session_id: session.id,
    },
  );

  if (error) {
    // The write may have committed even if the response was lost. Keep the stable
    // Stripe idempotency result alive so a retry can reconcile the same session.
    logCheckoutStage({
      attemptId: opts.attemptId,
      stage: "provider_attachment",
      outcome: "failed",
      environment: opts.environment,
      plan: opts.plan,
      startedAt: opts.startedAt,
      classification: safeReservationFailureCode(error),
    });
    throw new Error("Unable to confirm checkout; retry to resume the same payment session");
  }
  if (attachment !== "attached" && attachment !== "already_attached") {
    logCheckoutStage({
      attemptId: opts.attemptId,
      stage: "provider_attachment",
      outcome: "failed",
      environment: opts.environment,
      plan: opts.plan,
      startedAt: opts.startedAt,
      classification: "stale_reservation",
    });
    await expireStripeCheckoutSession(session.id);
    throw new Error("Checkout was replaced before payment could start");
  }
  logCheckoutStage({
    attemptId: opts.attemptId,
    stage: "provider_attachment",
    outcome: "succeeded",
    environment: opts.environment,
    plan: opts.plan,
    startedAt: opts.startedAt,
  });

  return session.url;
}

async function beginSaasCheckout(input: {
  attemptId: string;
  environment: "test" | "live";
  checkout: z.infer<typeof checkoutContextSchema>;
  legalEvidence: { ipHash: string; userAgent: string };
}): Promise<BegunCheckout> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const response = await withSemanticTypes(supabaseAdmin).rpc("begin_saas_checkout", {
    p_environment: input.environment,
    p_attempt_id: input.attemptId,
    p_license_number: normalizeLicenseNumber(input.checkout.licenseNumber),
    p_email: input.checkout.email.trim().toLowerCase(),
    p_full_name: input.checkout.fullName,
    p_business_name: input.checkout.businessName,
    p_city: input.checkout.city,
    p_plan: input.checkout.plan,
    p_website_id: input.checkout.websiteId ?? null,
    p_legal_accepted_at: new Date().toISOString(),
    p_legal_acceptance_ip_hash: input.legalEvidence.ipHash,
    p_legal_acceptance_user_agent: input.legalEvidence.userAgent,
    p_legal_document_versions: await checkoutLegalDocumentVersions(),
  });
  const row = response.data?.[0];
  if (response.error || !row) {
    const code = response.error
      ? safeReservationFailureCode(response.error, response.status)
      : "missing_reservation";
    const message = safeReservationFailureMessage(response.error);
    const reference = reservationFailureReference(code, message);
    console.error("[saas_checkout_begin_failed]", {
      event: "saas_checkout_begin_failed",
      attemptId: input.attemptId,
      environment: input.environment,
      plan: input.checkout.plan,
      code,
      message,
      httpStatus: response.status,
      reference,
    });
    throw checkoutFailure(
      checkoutBrowserMessage(message),
      reference,
      input.checkout.plan,
      input.environment,
    );
  }
  const parsed = begunCheckoutSchema.safeParse(row);
  if (!parsed.success) {
    throw checkoutFailure(
      "Unable to reserve checkout",
      "CHK-R12",
      input.checkout.plan,
      input.environment,
    );
  }
  return parsed.data;
}

async function prepareCheckoutRow(
  input: z.infer<typeof checkoutRowSchema>,
  status: "pending_payment" | "pending_otp",
  legalEvidence?: { ipHash: string; userAgent: string },
  offer?: VerifiedPlanOffer,
): Promise<{
  checkoutSessionId: string;
  email: string;
  websiteId: string;
  reusedPendingOtp: boolean;
  plan: PlanId;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const licenseNumber = normalizeLicenseNumber(input.licenseNumber);
  const email = input.email.trim().toLowerCase();
  const environment = billingEnvironment();

  if (input.websiteId) {
    await assertWebsiteMatchesLicense(supabaseAdmin, input.websiteId, licenseNumber);
  }

  const existingProfile = await findProfileByLicense(supabaseAdmin, licenseNumber);
  if (
    existingProfile &&
    !existingProfile.auth_user_id &&
    (!existingProfile.checkout_claimable_at ||
      existingProfile.checkout_claim_email !== input.email.trim().toLowerCase())
  ) {
    throw new Error("This contractor profile is not available for public checkout.");
  }
  let checkoutWebsiteId = input.websiteId;
  if (!checkoutWebsiteId && existingProfile) {
    checkoutWebsiteId = await ensureCheckoutWebsite(supabaseAdmin, existingProfile.id);
  }
  if (existingProfile?.auth_user_id) {
    if (!input.websiteId) {
      throw new Error("Log in and purchase from the website you want to activate.");
    }
    if (!existingProfile.email || existingProfile.email.toLowerCase() !== email) {
      throw new Error("This account uses a different email. Log in to continue.");
    }
  }

  const profileId = await upsertProfileForCheckout(supabaseAdmin, {
    licenseNumber,
    email,
    fullName: input.fullName,
    businessName: input.businessName,
    city: input.city,
    environment,
  });
  checkoutWebsiteId ??= await ensureCheckoutWebsite(supabaseAdmin, profileId);

  const { data: checkoutSession, error: reservationError } = await supabaseAdmin.rpc(
    "reserve_checkout_intent",
    {
      p_profile_id: profileId,
      p_website_id: checkoutWebsiteId,
      p_environment: environment,
      p_license_number: licenseNumber,
      p_email: email,
      p_full_name: input.fullName,
      p_business_name: input.businessName,
      p_city: input.city,
      p_plan: input.plan,
      p_status: status,
      p_legal_accepted_at: rpcNullable(legalEvidence ? new Date().toISOString() : null),
      p_legal_acceptance_ip_hash: rpcNullable(legalEvidence?.ipHash),
      p_legal_acceptance_user_agent: rpcNullable(legalEvidence?.userAgent),
      p_legal_document_versions: legalEvidence ? await checkoutLegalDocumentVersions() : null,
      p_provider_offer_snapshot: offer ? (offer as unknown as Json) : null,
    },
  );
  const reservation = checkoutSession?.[0];
  if (reservationError || !reservation) {
    // Record only stable, non-PII provider/database classification. In particular, do not log
    // the request payload, identity fields, legal-acceptance evidence, raw error details/hints,
    // or an unrecognized provider/database error message.
    const code = reservationError
      ? safeReservationFailureCode(reservationError)
      : "missing_reservation";
    const message = safeReservationFailureMessage(reservationError);
    console.error("[saas_checkout_reservation_failed]", {
      event: "saas_checkout_reservation_failed",
      environment,
      plan: input.plan,
      code,
      message,
    });
    const reference = reservationFailureReference(code, message);
    const browserMessage = reservationError?.message.includes("paid checkout")
      ? "A paid checkout is already awaiting verification for another purchase."
      : "Unable to reserve checkout";
    throw checkoutFailure(browserMessage, reference, input.plan, environment);
  }

  const templateIdentity = resolveTemplatePurchaseIdentity(input.templateSlug, input.templateId);
  // Closed-world ids fail closed (unknown id = client bug, loud 400); legacy
  // slugs fail open (unknown slug = unified path, today's behavior — unwired
  // in-flight templates keep working exactly as before).
  if (input.templateId && !templateIdentity) {
    throw checkoutFailure(
      "This template is not available for purchase right now.",
      "CHK-T01",
      input.plan,
      environment,
    );
  }

  if (templateIdentity) {
    // Template intent is purchase-critical metadata, not decoration: selling a
    // template whose identity cannot persist would strand the buyer in the
    // unified flow with no error anywhere. Fail fast here — no charge has been
    // created yet, the reservation is retry-safe, and genuine persistence
    // failures are now loud instead of silent.
    const { recordCheckoutTemplateSlug } = await import("@/lib/template-purchase.server");
    await recordCheckoutTemplateSlug(
      supabaseAdmin,
      reservation.checkout_session_id,
      templateIdentity,
    );
  }

  return {
    checkoutSessionId: reservation.checkout_session_id,
    email: reservation.checkout_email,
    websiteId: checkoutWebsiteId,
    reusedPendingOtp: reservation.disposition === "reused_pending_otp",
    plan: reservation.checkout_plan === "pro" ? "pro" : "starter",
  };
}

export async function expireSaasCheckout(stripeSessionId: string): Promise<void> {
  await loadCheckoutServerModules();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: checkout, error: lookupError } = await supabaseAdmin
    .from("checkout_sessions")
    .select("id")
    .eq("stripe_checkout_session_id", stripeSessionId)
    .maybeSingle();
  if (lookupError) throw new Error("Unable to load expired checkout");
  if (!checkout) return;
  const { error } = await supabaseAdmin.rpc("expire_checkout_intent", {
    p_checkout_session_id: checkout.id,
    p_stripe_checkout_session_id: stripeSessionId,
  });
  if (error) throw new Error("Unable to expire checkout intent");
}

/**
 * Checkout payment authority is the signed Stripe inbox reducer. Browser redirects only
 * observe that reducer; they must never manufacture completion evidence from an URL.
 */
// Paid completion and lifecycle state are exclusively reduced from claimed, signed Stripe inbox events.

async function seedOnboardingFromProfile(
  supabaseAdmin: SupabaseAdmin,
  profileId: string,
  websiteId: string,
): Promise<void> {
  const { data: profileRow } = await supabaseAdmin
    .from("profiles")
    .select("license_number, business_name, trade, city")
    .eq("id", profileId)
    .single();

  const { data: websiteRow } = await supabaseAdmin
    .from("websites")
    .select("onboarding_state")
    .eq("id", websiteId)
    .single();

  const currentOnboarding = asOnboardingRecord(websiteRow?.onboarding_state);

  const seededOnboarding = {
    ...currentOnboarding,
    businessName: currentOnboarding.businessName ?? profileRow?.business_name ?? undefined,
    licenseNumber: currentOnboarding.licenseNumber ?? profileRow?.license_number ?? undefined,
    trade: currentOnboarding.trade ?? profileRow?.trade ?? undefined,
    city: currentOnboarding.city ?? profileRow?.city ?? undefined,
  };

  const { error: seedError } = await supabaseAdmin
    .from("websites")
    .update({ onboarding_state: seededOnboarding as unknown as Json })
    .eq("id", websiteId);

  if (seedError) {
    console.error("[seedOnboardingFromProfile]", seedError);
    throw new Error("Unable to seed onboarding state");
  }
}

export const getSaasCheckoutAvailability = createServerFn({ method: "GET" }).handler(async () => {
  await loadCheckoutServerModules();
  return { checkoutEnabled: saasCheckoutAvailable() };
});

export const createSaasCheckout = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = checkoutContextSchema.safeParse(data);
    if (!parsed.success) throw checkoutValidationFailure();
    return parsed.data;
  })
  .handler(async ({ data }) => {
    await loadCheckoutServerModules();
    const attemptId = crypto.randomUUID();
    const startedAt = Date.now();
    const configuredEnvironment = process.env["SAAS_BILLING_ENVIRONMENT"]?.trim();
    const diagnosticEnvironment =
      configuredEnvironment === "test" || configuredEnvironment === "live"
        ? configuredEnvironment
        : "unknown";
    let environment: "test" | "live";

    // This complete deployment/provider gate intentionally runs before every database read or write.
    // A disabled or mismatched deployment therefore cannot reserve licenses, profiles, or websites.
    try {
      environment = assertSaasCheckoutChargingEnabled();
    } catch {
      throw checkoutFailure(
        "Payments are not configured yet. Please try again later.",
        "CHK-G01",
        data.plan,
        diagnosticEnvironment,
      );
    }
    if (!stripeConfigured()) {
      throw checkoutFailure(
        "Payments are not configured yet. Please try again later.",
        "CHK-C01",
        data.plan,
        environment,
      );
    }

    logCheckoutStage({
      attemptId,
      stage: "request",
      outcome: "started",
      environment,
      plan: data.plan,
      startedAt,
    });
    try {
      const base = publicAppUrl();
      void base;
    } catch {
      throw checkoutFailure(
        "Payments are not configured yet. Please try again later.",
        "CHK-C01",
        data.plan,
        environment,
      );
    }

    let request: Request | undefined;
    let createHmac: typeof import("node:crypto").createHmac;
    try {
      const requestModule = await import("@tanstack/react-start/server");
      request = requestModule.getRequest();
      ({ createHmac } = await import("node:crypto"));
    } catch {
      throw checkoutFailure("Unable to record legal acceptance", "CHK-C02", data.plan, environment);
    }
    const address = request?.headers.get("cf-connecting-ip")?.trim();
    const secret = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
    if (!address || !secret) {
      throw checkoutFailure("Unable to record legal acceptance", "CHK-C02", data.plan, environment);
    }

    let begun: BegunCheckout;
    logCheckoutStage({
      attemptId,
      stage: "durable_begin",
      outcome: "started",
      environment,
      plan: data.plan,
      startedAt,
    });
    try {
      begun = await beginSaasCheckout({
        attemptId,
        environment,
        checkout: data,
        legalEvidence: {
          ipHash: createHmac("sha256", secret).update(address).digest("hex"),
          userAgent: request?.headers.get("user-agent")?.slice(0, 512) ?? "unknown",
        },
      });
    } catch (error) {
      logCheckoutStage({
        attemptId,
        stage: "durable_begin",
        outcome: "failed",
        environment,
        plan: data.plan,
        startedAt,
        classification:
          error instanceof ReferencedCheckoutError ? error.reference : "unhandled_error",
      });
      if (error instanceof ReferencedCheckoutError) throw error;
      throw checkoutFailure("Unable to reserve checkout", "CHK-R12", data.plan, environment);
    }
    logCheckoutStage({
      attemptId,
      stage: "durable_begin",
      outcome: "succeeded",
      environment,
      plan: data.plan,
      startedAt,
      disposition: begun.disposition,
    });

    if (begun.disposition === "reused_pending_otp") {
      let processCheckoutOtpOutbox: typeof import("@/lib/checkout-otp-outbox-worker.server").processCheckoutOtpOutbox;
      try {
        ({ processCheckoutOtpOutbox } = await import("@/lib/checkout-otp-outbox-worker.server"));
      } catch {
        throw checkoutFailure("Unable to continue checkout", "CHK-P99", data.plan, environment);
      }
      void processCheckoutOtpOutbox(1).catch((error) => {
        console.error("[createSaasCheckout] fulfillment nudge failed", error);
      });
      return {
        kind: "otp" as const,
        checkoutSessionId: begun.checkout_session_id,
        email: begun.checkout_email,
      };
    }

    const frozenOffer = frozenOfferFromCheckout(begun, environment);
    let offer = frozenOffer;
    if (!begun.provider_session_id) {
      logCheckoutStage({
        attemptId,
        stage: "offer_verification",
        outcome: "started",
        environment,
        plan: data.plan,
        startedAt,
      });
      try {
        offer = await verifiedOfferForPlan(data.plan);
      } catch {
        logCheckoutStage({
          attemptId,
          stage: "offer_verification",
          outcome: "failed",
          environment,
          plan: data.plan,
          startedAt,
          classification: "provider_unavailable",
        });
        throw checkoutFailure(
          "Payments are not configured yet. Please try again later.",
          "CHK-O01",
          data.plan,
          environment,
        );
      }
      const mismatches = offerMismatchFields(frozenOffer, offer);
      if (mismatches.length > 0) {
        console.error("[saas_checkout_offer_mismatch]", {
          event: "saas_checkout_offer_mismatch",
          attemptId,
          environment,
          plan: data.plan,
          fields: mismatches,
        });
        logCheckoutStage({
          attemptId,
          stage: "offer_verification",
          outcome: "failed",
          environment,
          plan: data.plan,
          startedAt,
          classification: "contract_mismatch",
        });
        throw checkoutFailure(
          "Payments are not configured yet. Please try again later.",
          "CHK-O02",
          data.plan,
          environment,
        );
      }
      logCheckoutStage({
        attemptId,
        stage: "offer_verification",
        outcome: "succeeded",
        environment,
        plan: data.plan,
        startedAt,
      });
    }

    let url: string;
    try {
      url = await createStripeCheckout({
        attemptId,
        startedAt,
        environment,
        checkoutSessionId: begun.checkout_session_id,
        email: begun.checkout_email,
        plan: begun.checkout_plan,
        licenseNumber: normalizeLicenseNumber(data.licenseNumber),
        websiteId: begun.website_id,
        providerSessionId: begun.provider_session_id,
        offer,
      });
    } catch {
      throw checkoutFailure("Unable to start checkout", "CHK-S01", data.plan, environment);
    }

    logCheckoutStage({
      attemptId,
      stage: "request",
      outcome: "succeeded",
      environment,
      plan: data.plan,
      startedAt,
    });

    return {
      kind: "stripe" as const,
      url,
      checkoutSessionId: begun.checkout_session_id,
      email: begun.checkout_email,
    };
  });

export const finalizeStripeCheckout = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ sessionId: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    await loadCheckoutServerModules();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: checkout, error } = await supabaseAdmin
      .from("checkout_sessions")
      .select("id, email, status, profile_id, website_id, plan")
      .eq("stripe_checkout_session_id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error("Unable to check payment status");
    if (!checkout) throw new Error("Checkout session not found");
    if (checkout.status === "pending_payment") {
      return { success: true as const, pending: true as const };
    }
    if (checkout.status !== "pending_otp" && checkout.status !== "completed") {
      throw new Error("Checkout session is no longer available");
    }
    if (checkout.status === "pending_otp") {
      // Nudge the fulfillment outbox so the verification code goes out immediately,
      // without waiting for the cron worker. The worker is lease-guarded and idempotent.
      try {
        const { processCheckoutOtpOutbox } =
          await import("@/lib/checkout-otp-outbox-worker.server");
        await processCheckoutOtpOutbox(25);
      } catch (importError) {
        console.error("[finalizeStripeCheckout] fulfillment nudge failed", importError);
      }
    }

    let templateId: string | null = null;
    if (checkout.website_id) {
      const { data: siteRow } = await supabaseAdmin
        .from("websites")
        .select("*")
        .eq("id", checkout.website_id)
        .maybeSingle();
      const site = siteRow as unknown as {
        template_id?: unknown;
        template_slug?: unknown;
      } | null;
      templateId =
        resolveTemplatePurchaseIdentity(
          site?.template_slug ?? null,
          site && "template_id" in site ? (site.template_id ?? null) : null,
        )?.id ?? null;
    }
    if (!templateId) {
      const { readCheckoutSessionIdentity } = await import("@/lib/template-purchase.server");
      templateId =
        (await readCheckoutSessionIdentity(supabaseAdmin, checkout.id).catch(() => null))?.id ??
        null;
    }

    return {
      success: true as const,
      pending: false as const,
      checkoutSessionId: checkout.id,
      email: checkout.email,
      completed: checkout.status === "completed",
      profileId: checkout.profile_id ?? undefined,
      websiteId: checkout.website_id ?? undefined,
      plan: checkout.plan === "pro" ? ("pro" as const) : ("starter" as const),
      templateId,
    };
  });

export const resendCheckoutOtp = createServerFn({ method: "POST" })
  .validator((data: unknown) => resendCheckoutOtpSchema.parse(data))
  .handler(async ({ data }) => {
    await loadCheckoutServerModules();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: checkout, error } = await supabaseAdmin
      .from("checkout_sessions")
      .select("id, email, status, payment_verified_at")
      .eq("id", data.checkoutSessionId)
      .maybeSingle();

    if (
      error ||
      !checkout ||
      checkout.status !== "pending_otp" ||
      !checkout.payment_verified_at ||
      checkout.email.toLowerCase() !== data.email.toLowerCase()
    ) {
      throw new Error("Checkout session is not available for verification");
    }

    const { data: fulfillment, error: fulfillmentError } = await supabaseAdmin
      .from("saas_checkout_fulfillment_outbox")
      .select("state")
      .eq("checkout_session_id", checkout.id)
      .maybeSingle();
    if (fulfillmentError) throw new Error("Unable to check verification delivery");

    if (fulfillment?.state === "pending" || fulfillment?.state === "retry_wait") {
      const { processCheckoutOtpOutbox } = await import("@/lib/checkout-otp-outbox-worker.server");
      await processCheckoutOtpOutbox(25);
      const { data: settled } = await supabaseAdmin
        .from("saas_checkout_fulfillment_outbox")
        .select("state")
        .eq("checkout_session_id", checkout.id)
        .maybeSingle();
      if (settled?.state !== "accepted") {
        throw new Error("Unable to resend verification code. Please try again shortly.");
      }
    } else if (fulfillment?.state === "accepted") {
      await sendCheckoutOtp(checkout.email);
    } else {
      throw new Error("Verification delivery needs support before it can be retried.");
    }

    return { success: true as const };
  });

export const verifyOtpAndLinkProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) => verifyCheckoutOtpSchema.parse(data))
  .handler(async ({ data }) => {
    await loadCheckoutServerModules();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: checkoutSession, error: sessionLookupError } = await supabaseAdmin
      .from("checkout_sessions")
      .select("*")
      .eq("id", data.checkoutSessionId)
      .eq("status", "pending_otp")
      .maybeSingle();

    if (sessionLookupError || !checkoutSession) {
      throw new Error("Checkout session not found or expired");
    }

    if (checkoutSession.email.toLowerCase() !== data.email.toLowerCase()) {
      throw new Error("Email does not match checkout session");
    }

    const { createSupabaseAuthClient } = await import("@/integrations/supabase/auth-server.server");
    const authClient = createSupabaseAuthClient();

    const { data: authData, error: verifyError } = await authClient.auth.verifyOtp({
      email: data.email,
      token: data.token,
      type: "email",
    });

    if (verifyError || !authData.user) {
      console.error("[verifyOtpAndLinkProfile]", verifyError);
      throw new Error("Invalid or expired code. Please try again.");
    }

    if (!checkoutSession.profile_id) {
      throw new Error("Verified checkout is missing its reserved profile.");
    }
    const reservedProfileId = checkoutSession.profile_id;
    const { data: reservedProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", reservedProfileId)
      .single();
    if (profileError || !reservedProfile) {
      throw new Error("Reserved checkout profile is unavailable.");
    }
    let profile = reservedProfile;

    if (profile.auth_user_id && profile.auth_user_id !== authData.user.id) {
      throw new Error("License already activated — log in instead.");
    }
    if (
      !profile.auth_user_id &&
      (!profile.checkout_claimable_at ||
        profile.checkout_claim_email !== checkoutSession.email.trim().toLowerCase())
    ) {
      throw new Error("This contractor profile is not claimable by this checkout.");
    }

    // Profile ownership is linked inside grant_verified_website_entitlement so
    // any entitlement failure rolls the public claim back atomically.
    const fallbackWebsiteId = await ensureWebsiteForProfile(supabaseAdmin, profile.id);
    await seedOnboardingFromProfile(supabaseAdmin, profile.id, fallbackWebsiteId);

    const context =
      checkoutSession.context_json && typeof checkoutSession.context_json === "object"
        ? (checkoutSession.context_json as Record<string, unknown>)
        : {};
    const contextWebsiteId = typeof context.websiteId === "string" ? context.websiteId : null;

    if (!contextWebsiteId) {
      throw new Error("Verified purchase is missing its website association");
    }

    const { data: contextWebsite } = await supabaseAdmin
      .from("websites")
      .select("id, user_id, status, template_slug")
      .eq("id", contextWebsiteId)
      .maybeSingle();

    if (!contextWebsite || contextWebsite.user_id !== profile.id) {
      throw new Error("Verified purchase website ownership mismatch");
    }

    // This single service-role RPC is the authoritative post-verifyOtp write:
    // it validates checkout/profile/website/subscription identity and atomically
    // activates the subscription, grants only this website, and completes checkout.
    const { error: entitlementError } = await supabaseAdmin.rpc(
      "grant_verified_website_entitlement",
      {
        p_checkout_session_id: checkoutSession.id,
        p_website_id: contextWebsite.id,
        p_auth_user_id: authData.user.id,
      },
    );
    if (entitlementError) {
      console.error("[verifyOtpAndLinkProfile] entitlement", entitlementError);
      throw new Error("Unable to activate website entitlement");
    }

    // Template purchases: copy the captured identity onto the website and seed
    // its first template version. Best-effort by design — entitlement and
    // identity linking already succeeded, and Step 1 entry re-runs both
    // idempotently before starting work. Routing below uses session intent,
    // not copy outcome, so a tagging hiccup still lands the buyer in the
    // purchaser flow, where Step 1 heals the row or surfaces a coded support
    // state instead of stranding them in the unified flow.
    const { readCheckoutSessionIdentity, copyTemplateIdentityToWebsite, seedTemplateVersion } =
      await import("@/lib/template-purchase.server");
    let sessionIdentity: { id: string; slug: string } | null = null;
    try {
      sessionIdentity = await readCheckoutSessionIdentity(supabaseAdmin, checkoutSession.id);
    } catch (templateError) {
      console.error("[verifyOtpAndLinkProfile] template identity read failed", templateError);
    }
    if (sessionIdentity) {
      try {
        const copied = await copyTemplateIdentityToWebsite(
          supabaseAdmin,
          checkoutSession.id,
          contextWebsite.id,
        );
        if (copied) {
          await seedTemplateVersion(supabaseAdmin, contextWebsite.id, copied.slug);
        }
      } catch (templateError) {
        console.error("[verifyOtpAndLinkProfile] template seeding failed", templateError);
      }
    }

    const { data: linkedProfile, error: linkedProfileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", reservedProfileId)
      .eq("auth_user_id", authData.user.id)
      .single();
    if (linkedProfileError || !linkedProfile) {
      throw new Error("Unable to confirm linked profile");
    }
    profile = linkedProfile;

    const confirmedLive = contextWebsite.status === "live";

    return {
      success: true as const,
      profileId: profile.id,
      licenseNumber: normalizeLicenseNumber(checkoutSession.license_number),
      websiteId: contextWebsiteId ?? fallbackWebsiteId,
      plan: checkoutSession.plan === "pro" ? ("pro" as const) : ("starter" as const),
      livePurchased: confirmedLive,
      session: authData.session,
      // Session intent, not the pre-copy website snapshot: even if tagging
      // hiccuped, the buyer routes to the purchaser flow where Step 1 heals.
      templateId: sessionIdentity?.id ?? null,
    };
  });
