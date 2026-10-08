import { rpcNullable } from "@/lib/rpc-nullable";
import type Stripe from "stripe";

import type { Database, Json } from "@/integrations/supabase/types";
import { billingEnvironment, getStripe, publicAppUrl } from "@/lib/stripe.server";
import {
  hasWorkerDeadline,
  workerCanContinue,
  WorkerDeadlineError,
  workerProviderFetch,
} from "@/lib/worker-deadline.server";

type Environment = "test" | "live";
type ConnectRow = Database["public"]["Tables"]["stripe_connected_accounts"]["Row"];

export function getStripeConnectEnvironment(workspaceEnvironment: Environment) {
  let stripeEnvironment: Environment | null = null;
  try {
    stripeEnvironment = billingEnvironment();
  } catch {
    return {
      workspaceEnvironment,
      stripeEnvironment,
      environmentError: "Stripe is not configured correctly for this deployment. Contact support.",
    };
  }
  return {
    workspaceEnvironment,
    stripeEnvironment,
    environmentError:
      stripeEnvironment === workspaceEnvironment
        ? null
        : `This workspace uses ${workspaceEnvironment} payments, but this deployment uses ${stripeEnvironment} Stripe. Open this workspace in a matching ${workspaceEnvironment} environment or contact support. Changing Stripe credentials does not convert existing purchases or accounts.`,
  };
}

export function assertStripeEnvironment(environment: Environment) {
  const { environmentError } = getStripeConnectEnvironment(environment);
  if (environmentError) throw new Error(environmentError);
}

function accountRequirements(account: Stripe.Account): Json {
  const requirements = account.requirements;
  return {
    currently_due: Array.isArray(requirements?.currently_due) ? requirements.currently_due : null,
    eventually_due: Array.isArray(requirements?.eventually_due)
      ? requirements.eventually_due
      : null,
    past_due: Array.isArray(requirements?.past_due) ? requirements.past_due : null,
    pending_verification: Array.isArray(requirements?.pending_verification)
      ? requirements.pending_verification
      : null,
    disabled_reason: requirements?.disabled_reason ?? null,
  };
}

function projectionArguments(account: Stripe.Account) {
  return {
    p_charges_enabled: account.charges_enabled,
    p_payouts_enabled: account.payouts_enabled,
    p_details_submitted: account.details_submitted,
    p_capabilities: account.capabilities as Json,
    p_requirements: accountRequirements(account),
    p_provider_created_at: rpcNullable(
      typeof account.created === "number" ? new Date(account.created * 1000).toISOString() : null,
    ),
    p_observed_at: new Date().toISOString(),
  };
}

async function projectAccount(input: {
  profileId: string;
  environment: Environment;
  account: Stripe.Account;
  reconciliationGeneration: number;
  lease?: { token: string; fencingToken: number };
  deadlineAt?: number;
}): Promise<ConnectRow> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const args = {
    p_profile_id: input.profileId,
    p_environment: input.environment,
    p_stripe_account_id: input.account.id,
    p_reconciliation_generation: input.reconciliationGeneration,
    ...projectionArguments(input.account),
  };
  const projection = input.lease
    ? supabaseAdmin.rpc(
        "apply_leased_stripe_connect_account_projection" as never,
        {
          ...args,
          p_lease_token: input.lease.token,
          p_fencing_token: input.lease.fencingToken,
        } as never,
      )
    : supabaseAdmin.rpc("apply_stripe_connect_account_projection", args);
  const { data, error } = await (input.deadlineAt === undefined
    ? projection
    : projection.abortSignal(stripeRefreshSignal(input.deadlineAt)));
  if (error || !data) {
    throw new Error("Unable to save Stripe account status");
  }
  return data as ConnectRow;
}

function stripeRefreshSignal(deadlineAt: number) {
  const remaining = Math.floor(deadlineAt - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new Error("Stripe account verification deadline exceeded");
  return AbortSignal.timeout(Math.min(5_000, remaining));
}

async function retrieveSavedAccount(accountId: string, deadlineAt?: number) {
  if (deadlineAt === undefined) return getStripe().accounts.retrieve(accountId);
  // Stop before dispatch when the worker fence is already lost. Inside a worker
  // scope the read then rides the shared fenced transport (scope abort, work
  // deadline, body limits); outside one it keeps the previous plain behavior.
  // Stripe 22.6.1 supports per-request timeout/retry options. Its fetch transport keeps
  // the timeout armed through response-body reads; Node's socket timeout is idle-only.
  if (!workerCanContinue()) throw new WorkerDeadlineError();
  const { default: Stripe } = await import("stripe");
  const { STRIPE_API_VERSION } = await import("@/lib/stripe.server");
  const timeout = Math.floor(Math.min(8_000, deadlineAt - Date.now() - 2_000));
  if (!Number.isFinite(timeout) || timeout < 100)
    throw new Error("Stripe account verification deadline exceeded");
  const transport = hasWorkerDeadline() ? workerProviderFetch : fetch;
  const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"]!.trim(), {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient((url, init) =>
      // redirect:"manual": Workers rejects "error" before any network I/O, and the
      // SDK then fails closed on a non-ok response instead of following anything.
      transport(url, { ...init, redirect: "manual" }),
    ),
  });
  return stripe.accounts.retrieve(accountId, {}, { timeout, maxNetworkRetries: 0 });
}

export async function createOrReuseStripeConnectOnboarding(input: {
  profileId: string;
  environment: Environment;
  authUserId: string;
  websiteId: string;
  email?: string | null;
  /**
   * Same-origin return path for re-hosted flows. Omitted callers land on /user
   * with connect markers.
   */
  returnPath?: string;
}) {
  assertStripeEnvironment(input.environment);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: reserved, error } = await supabaseAdmin.rpc("reserve_stripe_connect_account", {
    p_profile_id: input.profileId,
    p_website_id: input.websiteId,
    p_environment: input.environment,
    p_auth_user_id: input.authUserId,
  });
  if (error || !reserved) throw new Error("Unable to reserve Stripe account setup");

  const stripe = getStripe();
  const creationKey = "connect-account:" + input.environment + ":" + input.profileId;
  let account: Stripe.Account;
  if (reserved.stripe_account_id)
    account = await stripe.accounts.retrieve(reserved.stripe_account_id);
  else {
    const recoveryCandidates: Stripe.Account[] = [];
    for await (const candidate of stripe.accounts.list({ limit: 100 })) {
      if (
        candidate.metadata?.obra_profile_id === input.profileId &&
        candidate.metadata?.obra_environment === input.environment &&
        candidate.metadata?.obra_creation_key === creationKey
      )
        recoveryCandidates.push(candidate);
      if (recoveryCandidates.length > 1) break;
    }
    if (recoveryCandidates.length > 1)
      throw new Error("Multiple Stripe accounts need operator reconciliation");
    account =
      recoveryCandidates[0] ??
      (await stripe.accounts.create(
        {
          type: "express",
          country: "US",
          email: input.email ?? undefined,
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: {
            obra_profile_id: input.profileId,
            obra_environment: input.environment,
            obra_creation_key: creationKey,
          },
        },
        { idempotencyKey: creationKey },
      ));
  }
  if (account.type !== "express" || account.country !== "US")
    throw new Error("Stripe returned an unsupported connected account configuration");
  const { data: generation, error: generationError } = await supabaseAdmin.rpc(
    "bind_stripe_connect_account",
    {
      p_profile_id: input.profileId,
      p_environment: input.environment,
      p_stripe_account_id: account.id,
      p_creation_key: creationKey,
    },
  );
  if (generationError || generation === null)
    throw new Error("Unable to verify Stripe account status");
  const state = await projectAccount({
    profileId: input.profileId,
    environment: input.environment,
    account,
    reconciliationGeneration: generation,
  });
  if (input.returnPath && !input.returnPath.startsWith("/")) {
    throw new Error("Connect return path must be same-origin");
  }
  const { purchaserWorkspacePath, withConnectMarker } =
    await import("@/lib/auth/contractor-return-path");
  const basePath = input.returnPath ?? purchaserWorkspacePath(input.profileId, input.websiteId);
  const origin = publicAppUrl();
  const link = await stripe.accountLinks.create({
    account: account.id,
    type: "account_onboarding",
    refresh_url: origin + withConnectMarker(basePath, "refresh"),
    return_url: origin + withConnectMarker(basePath, "return"),
  });
  return { url: link.url, status: serializeStripeConnectStatus(state) };
}

export async function reconcileStripeConnectAccount(input: {
  profileId: string;
  environment: Environment;
  lease?: { token: string; fencingToken: number };
  deadlineAt?: number;
}) {
  assertStripeEnvironment(input.environment);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const query = supabaseAdmin
    .from("stripe_connected_accounts")
    .select("stripe_account_id")
    .eq("profile_id", input.profileId)
    .eq("environment", input.environment);
  if (input.deadlineAt !== undefined) query.abortSignal(stripeRefreshSignal(input.deadlineAt));
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Unable to load Stripe account");
  if (!data?.stripe_account_id) return null;
  const generationCall = input.lease
    ? supabaseAdmin.rpc("begin_leased_stripe_connect_reconciliation", {
        p_profile_id: input.profileId,
        p_environment: input.environment,
        p_stripe_account_id: data.stripe_account_id,
        p_lease_token: input.lease.token,
        p_fencing_token: input.lease.fencingToken,
      })
    : supabaseAdmin.rpc("begin_stripe_connect_reconciliation", {
        p_profile_id: input.profileId,
        p_environment: input.environment,
        p_stripe_account_id: data.stripe_account_id,
      });
  const { data: generation, error: generationError } = await (input.deadlineAt === undefined
    ? generationCall
    : generationCall.abortSignal(stripeRefreshSignal(input.deadlineAt)));
  if (generationError || generation === null)
    throw new Error("Unable to start Stripe status verification");
  const account = await retrieveSavedAccount(data.stripe_account_id, input.deadlineAt);
  if (
    account.id !== data.stripe_account_id ||
    account.type !== "express" ||
    account.country !== "US"
  )
    throw new Error("Stripe account configuration does not match Obra payments");
  return serializeStripeConnectStatus(
    await projectAccount({ ...input, account, reconciliationGeneration: generation }),
  );
}

export async function reconcileStripeConnectInboxEvent(input: {
  eventId: string;
  leaseToken: string;
  fencingToken: number;
  profileId: string;
  environment: Environment;
  stripeAccountId: string;
  deadlineAt?: number;
}) {
  assertStripeEnvironment(input.environment);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const begin = supabaseAdmin.rpc("begin_stripe_connect_inbox_reconciliation", {
    p_event_id: input.eventId,
    p_lease_token: input.leaseToken,
    p_fencing_token: input.fencingToken,
  });
  const { data: generation, error: generationError } = await (input.deadlineAt === undefined
    ? begin
    : begin.abortSignal(stripeRefreshSignal(input.deadlineAt)));
  if (generationError || generation === null)
    throw new Error("Unable to start Connect reconciliation");
  const account = await retrieveSavedAccount(input.stripeAccountId, input.deadlineAt);
  if (
    account.id !== input.stripeAccountId ||
    account.type !== "express" ||
    account.country !== "US"
  )
    throw new Error("Stripe account configuration does not match Obra payments");
  const projection = supabaseAdmin.rpc("apply_stripe_connect_inbox_projection", {
    p_event_id: input.eventId,
    p_lease_token: input.leaseToken,
    p_fencing_token: input.fencingToken,
    p_reconciliation_generation: generation,
    ...projectionArguments(account),
  });
  const { data: applied, error } = await (input.deadlineAt === undefined
    ? projection
    : projection.abortSignal(stripeRefreshSignal(input.deadlineAt)));
  if (error || applied !== true) throw new Error("Unable to apply Connect account status");
}

export async function createStripeExpressLoginLink(input: {
  profileId: string;
  environment: Environment;
}) {
  const status = await reconcileStripeConnectAccount(input);
  if (!status?.stripeAccountId) throw new Error("Connect Stripe before opening payments");
  if (!status.detailsSubmitted) throw new Error("Finish Stripe onboarding before opening payments");
  const link = await getStripe().accounts.createLoginLink(status.stripeAccountId);
  return { url: link.url };
}

export function serializeStripeConnectStatus(row: ConnectRow) {
  return {
    stripeAccountId: row.stripe_account_id,
    onboardingState: row.onboarding_state as
      "not_started" | "pending" | "ready" | "restricted" | "disabled",
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    detailsSubmitted: row.details_submitted,
    lastVerifiedAt: row.last_verified_at,
    reconnectReason: row.reconnect_reason,
  };
}
