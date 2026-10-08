import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createSupabaseAuthClient } from "@/integrations/supabase/auth-server.server";
import { assertOtpRateLimit } from "@/lib/auth/contractor-session.server";
import { billingEnvironment } from "@/lib/stripe.server";
import { workerCanContinue, WorkerDeadlineError } from "@/lib/worker-deadline.server";

export async function processCheckoutOtpOutbox(limit = 25) {
  if (!workerCanContinue()) throw new WorkerDeadlineError();
  const leaseToken = randomUUID();
  const { data: rows, error } = await supabaseAdmin.rpc("claim_due_saas_checkout_fulfillment", {
    p_environment: billingEnvironment(),
    p_lease_token: leaseToken,
    p_limit: limit,
  });
  if (error) throw new Error("Unable to claim checkout fulfillment");
  let accepted = 0;
  let continuationStopped = false;
  const dispatchedRecipients = new Set<string>();
  for (const row of rows ?? []) {
    let succeeded = false;
    let retryable = true;
    let deliveryUnknown = false;
    const authDispatch = { dispatched: false };
    try {
      if (!workerCanContinue()) throw new WorkerDeadlineError();
      // Auth enforces a per-address cooldown. Sending twice to the same recipient in one
      // pass guarantees a rate-limit rejection, so defer the duplicates to a later pass.
      if (dispatchedRecipients.has(row.recipient_email.toLowerCase())) {
        throw new Error("Recipient already received a verification code in this pass");
      }
      await assertOtpRateLimit(supabaseAdmin, row.recipient_email, "checkout");
      // Renew immediately before the irreversible provider call. This narrows, but cannot remove,
      // the bounded at-least-once acceptance window between Auth acceptance and durable settlement.
      const { data: renewed, error: renewalError } = await supabaseAdmin.rpc(
        "renew_saas_checkout_fulfillment",
        {
          p_id: row.id,
          p_lease_token: leaseToken,
          p_fencing_token: row.fencing_token,
        },
      );
      if (renewalError || renewed !== true) throw new Error("Checkout fulfillment lease was lost");
      const { data: dispatchStarted, error: dispatchError } = await supabaseAdmin.rpc(
        "begin_saas_checkout_fulfillment_dispatch",
        {
          p_id: row.id,
          p_lease_token: leaseToken,
          p_fencing_token: row.fencing_token,
        },
      );
      if (dispatchError || dispatchStarted !== true) {
        throw new Error("Unable to record checkout fulfillment provider dispatch");
      }
      if (!workerCanContinue()) throw new WorkerDeadlineError();
      let otpError: { status?: number | null } | null;
      try {
        ({ error: otpError } = await createSupabaseAuthClient(authDispatch).auth.signInWithOtp({
          email: row.recipient_email,
          options: { shouldCreateUser: true },
        }));
      } catch (error) {
        // The SDK can hide a prevented send as status zero. Only the transport
        // observation distinguishes that from a request Auth may have accepted.
        deliveryUnknown = authDispatch.dispatched;
        throw error;
      }
      if (otpError) {
        // Only a definitive rate-limit rejection is safely retryable. Missing/5xx responses may
        // have reached Auth, so reconcile the durable delivery_unknown record before any resend.
        retryable = !authDispatch.dispatched || otpError.status === 429;
        deliveryUnknown =
          authDispatch.dispatched &&
          (otpError.status == null || otpError.status === 0 || otpError.status >= 500);
        throw otpError;
      }
      succeeded = true;
      dispatchedRecipients.add(row.recipient_email.toLowerCase());
    } catch (error) {
      continuationStopped ||= error instanceof WorkerDeadlineError || !workerCanContinue();
      // Never log Auth/provider payloads. Durable outbox state owns retry/ambiguity evidence.
      if (!authDispatch.dispatched) {
        const { data: deferred, error: deferError } = await supabaseAdmin.rpc(
          "defer_saas_checkout_fulfillment",
          {
            p_id: row.id,
            p_lease_token: leaseToken,
            p_fencing_token: row.fencing_token,
            p_safe_error: "OTP dispatch deferred before provider call",
          },
        );
        if (deferError || deferred !== true) {
          throw new Error("Unable to defer checkout fulfillment");
        }
        continue;
      }
    }
    if (deliveryUnknown) {
      const { data: markedUnknown, error: unknownError } = await supabaseAdmin.rpc(
        "mark_saas_checkout_fulfillment_delivery_unknown",
        {
          p_id: row.id,
          p_lease_token: leaseToken,
          p_fencing_token: row.fencing_token,
          p_safe_error: "OTP provider response was ambiguous; reconcile before any resend",
        },
      );
      if (unknownError || markedUnknown !== true) {
        throw new Error("Unable to mark checkout fulfillment delivery unknown");
      }
      continue;
    }
    const { data: completed, error: completionError } = await supabaseAdmin.rpc(
      "complete_saas_checkout_fulfillment",
      {
        p_id: row.id,
        p_lease_token: leaseToken,
        p_fencing_token: row.fencing_token,
        p_succeeded: succeeded,
        p_retryable: retryable,
        p_safe_error: succeeded ? undefined : "verification request was not accepted",
      },
    );
    if (completionError || completed !== true) {
      throw new Error("Unable to settle checkout fulfillment");
    }
    if (succeeded) accepted++;
  }
  if (continuationStopped) throw new WorkerDeadlineError();
  return { checked: rows?.length ?? 0, accepted };
}
