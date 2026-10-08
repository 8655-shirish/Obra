import { randomUUID } from "node:crypto";

import { billingEnvironment } from "@/lib/stripe.server";
import { workerCanContinue, WorkerDeadlineError } from "@/lib/worker-deadline.server";
import {
  assertStripeEnvironment,
  reconcileStripeConnectAccount,
  reconcileStripeConnectInboxEvent,
} from "@/lib/stripe-connect.server";

type RefreshOptions = { environment: "test" | "live"; deadlineAt: number };
type AccountClaim = {
  profile_id: string;
  environment: string;
  stripe_account_id: string | null;
  reconciliation_fencing_token: number;
};

function signal(deadlineAt: number) {
  const remaining = Math.floor(deadlineAt - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new Error("Stripe maintenance deadline exceeded");
  return AbortSignal.timeout(Math.min(5_000, remaining));
}

async function fail(eventId: string, leaseToken: string, fence: number, deadlineAt: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .rpc("complete_provider_event", {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_fencing_token: fence,
      p_succeeded: false,
      p_safe_error: "Connect account reconciliation failed",
    })
    .abortSignal(signal(deadlineAt));
  if (error || data !== true) throw new Error("Unable to settle failed Connect event");
}

export async function processStripeConnectInbox(limit = 25, options?: RefreshOptions) {
  const environment = options?.environment ?? billingEnvironment();
  assertStripeEnvironment(environment);
  const deadlineAt = Math.min(options?.deadlineAt ?? Infinity, Date.now() + 40_000);
  let processed = 0;
  let failed = 0;
  let claimed = 0;
  if (!workerCanContinue() || !Number.isFinite(deadlineAt) || deadlineAt - Date.now() < 4_000)
    return { processed, failed, claimed, deadlineExceeded: true };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin
    .from("provider_event_inbox")
    .select("id,profile_id,environment,account_context,event_type")
    .eq("provider", "stripe")
    .eq("event_family", "connect")
    .eq("environment", environment)
    .in("processing_state", ["pending", "processing", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("received_at")
    .limit(Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 1, 25)))
    .abortSignal(signal(deadlineAt - 2_000));
  if (error) throw new Error("Unable to load Connect inbox");
  for (const row of rows ?? []) {
    if (!workerCanContinue() || Date.now() >= deadlineAt - 4_000) break;
    const leaseToken = randomUUID();
    const { data: fence, error: claimError } = await supabaseAdmin
      .rpc("claim_provider_event", {
        p_event_id: row.id,
        p_lease_token: leaseToken,
        p_lease_seconds: 55,
      })
      .abortSignal(signal(deadlineAt - 2_000));
    if (claimError) {
      if (claimError.code === "P0001") continue;
      throw new Error("Unable to claim Connect event");
    }
    if (fence === null || !Number.isSafeInteger(fence) || fence < 1)
      throw new Error("Indeterminate Connect event claim");
    claimed++;
    try {
      if (!workerCanContinue() || Date.now() >= deadlineAt - 4_000) throw new WorkerDeadlineError();
      if (
        !row.profile_id ||
        row.event_type !== "account.updated" ||
        row.environment !== environment
      )
        throw new Error("Rejected Connect event context");
      await reconcileStripeConnectInboxEvent({
        eventId: row.id,
        leaseToken,
        fencingToken: fence,
        profileId: row.profile_id,
        environment: row.environment as "test" | "live",
        stripeAccountId: row.account_context,
        deadlineAt: deadlineAt - 2_000,
      });
      processed++;
    } catch {
      failed++;
      await fail(row.id, leaseToken, fence, deadlineAt);
    }
  }
  return {
    processed,
    failed,
    claimed,
    deadlineExceeded: !workerCanContinue() || Date.now() >= deadlineAt - 4_000,
  };
}

async function reconcileClaim(row: AccountClaim, leaseToken: string, options: RefreshOptions) {
  if (
    row.environment !== options.environment ||
    !row.stripe_account_id ||
    !Number.isSafeInteger(row.reconciliation_fencing_token) ||
    row.reconciliation_fencing_token < 1
  )
    throw new Error("Stripe refresh claim scope mismatch");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let checked = false;
  try {
    // A claim returned after continuation stops still needs its original fenced release.
    if (!workerCanContinue() || Date.now() >= options.deadlineAt - 4_000)
      throw new WorkerDeadlineError();
    checked = Boolean(
      await reconcileStripeConnectAccount({
        profileId: row.profile_id,
        environment: options.environment,
        lease: { token: leaseToken, fencingToken: row.reconciliation_fencing_token },
        deadlineAt: options.deadlineAt - 2_000,
      }),
    );
  } catch {
    checked = false;
  }
  const { data: released, error } = await supabaseAdmin
    .rpc(
      "release_stripe_connect_reconciliation_claim" as never,
      {
        p_profile_id: row.profile_id,
        p_environment: options.environment,
        p_lease_token: leaseToken,
        p_fencing_token: row.reconciliation_fencing_token,
        p_succeeded: checked,
      } as never,
    )
    .abortSignal(signal(options.deadlineAt));
  if (error || released !== true) throw new Error("Unable to settle Stripe refresh claim");
  return { checked };
}

/** Trusted callers resolve the profile/environment before invoking this read-only provider path. */
export async function refreshSavedStripeConnectAccount(input: {
  profileId: string;
  environment: "test" | "live";
  deadlineAt: number;
}): Promise<{ checked: boolean }> {
  assertStripeEnvironment(input.environment);
  const deadlineAt = Math.min(input.deadlineAt, Date.now() + 15_000);
  if (!workerCanContinue() || !Number.isFinite(deadlineAt) || deadlineAt - Date.now() < 4_000)
    return { checked: false };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!workerCanContinue() || Date.now() >= deadlineAt - 4_000) return { checked: false };
  const leaseToken = randomUUID();
  const { data, error } = await supabaseAdmin
    .rpc(
      "claim_stripe_connect_account_refresh" as never,
      {
        p_profile_id: input.profileId,
        p_environment: input.environment,
        p_lease_token: leaseToken,
      } as never,
    )
    .abortSignal(signal(deadlineAt - 2_000));
  if (error) throw new Error("Unable to claim saved Stripe account refresh");
  const rows = data as unknown as AccountClaim[] | null;
  if (!Array.isArray(rows)) throw new Error("Indeterminate Stripe refresh claim");
  if (!rows.length) return { checked: false };
  if (rows.length !== 1 || rows[0].profile_id !== input.profileId)
    throw new Error("Stripe refresh claim scope mismatch");
  return reconcileClaim(rows[0], leaseToken, { environment: input.environment, deadlineAt });
}

export async function reconcileDueStripeConnectAccounts(limit = 25, options?: RefreshOptions) {
  const environment = options?.environment ?? billingEnvironment();
  assertStripeEnvironment(environment);
  const deadlineAt = Math.min(options?.deadlineAt ?? Infinity, Date.now() + 40_000);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let reconciled = 0;
  let failed = 0;
  let claimed = 0;
  const bounded = Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 1, 25));
  for (let index = 0; index < bounded; index++) {
    if (!workerCanContinue() || !Number.isFinite(deadlineAt) || Date.now() >= deadlineAt - 4_000)
      break;
    const leaseToken = randomUUID();
    const { data, error } = await supabaseAdmin
      .rpc("claim_due_stripe_connect_accounts", {
        p_environment: environment,
        p_lease_token: leaseToken,
        p_limit: 1,
      })
      .abortSignal(signal(deadlineAt - 2_000));
    if (error) throw new Error("Unable to claim due Connect reconciliation");
    const rows = data as AccountClaim[] | null;
    if (!Array.isArray(rows)) throw new Error("Indeterminate Stripe refresh claim");
    if (!rows.length) break;
    if (rows.length !== 1) throw new Error("Stripe refresh returned an unbounded claim");
    claimed++;
    try {
      const result = await reconcileClaim(rows[0], leaseToken, {
        environment,
        deadlineAt: Math.min(deadlineAt, Date.now() + 15_000),
      });
      if (result.checked) reconciled++;
      else failed++;
    } catch {
      failed++;
      // Lost settlement is not success. The finite lease and cooldown retain recovery authority.
    }
  }
  return {
    reconciled,
    failed,
    claimed,
    deadlineExceeded:
      !workerCanContinue() || !Number.isFinite(deadlineAt) || Date.now() >= deadlineAt - 4_000,
  };
}
