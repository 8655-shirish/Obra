import { randomUUID } from "node:crypto";

import { bookingWorker } from "@/integrations/supabase/booking-worker.server";
import type { Database } from "@/integrations/supabase/types";

import { billingEnvironment, getStripe } from "@/lib/stripe.server";
import {
  workerCanContinue,
  WorkerDeadlineError,
  workerProviderContext,
} from "@/lib/worker-deadline.server";
import {
  bookingStripeFailure,
  BookingStripeConfigurationError as BookingConfigurationError,
} from "@/lib/booking-stripe-failure.server";

function providerJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function processBookingOutbox(
  environment: "test" | "live",
  limit = 25,
  familyLeaseCurrent: () => boolean = () => true,
) {
  if (billingEnvironment() !== environment)
    throw new BookingConfigurationError(
      "Stripe key mode does not match booking worker environment",
    );
  const counts = { processed: 0, claimed: 0, failed: 0, skipped: 0, deadlineExceeded: false };
  for (let index = 0; index < limit; index++) {
    if (!familyLeaseCurrent() || !workerCanContinue()) break;
    const leaseToken = randomUUID();
    const { data: commands, error } = await bookingWorker.rpc("claim_due_booking_outbox", {
      p_environment: environment,
      p_lease_token: leaseToken,
      p_limit: 1,
    });
    if (error) throw new Error("Unable to claim booking provider work");
    if (!Array.isArray(commands) || commands.length > 1)
      throw new Error("Invalid booking refund claim");
    const command = commands?.[0];
    if (!command) break;
    counts.claimed++;
    if (command.environment !== environment) throw new Error("Booking outbox environment mismatch");
    try {
      const { data: providerContext, error: contextError } = await bookingWorker.rpc(
        "get_booking_outbox_context",
        {
          p_command_id: command.id,
          p_lease_token: leaseToken,
          p_fencing_token: command.fencing_token,
        },
      );
      if (contextError) throw new Error("Unable to load booking provider context");
      if (!providerContext) {
        counts.skipped++;
        continue;
      }
      const context = providerContext as unknown as {
        appointment: Database["public"]["Tables"]["appointments"]["Row"];
        payment: Database["public"]["Tables"]["booking_payments"]["Row"] | null;
      };
      const appointment = context.appointment,
        payment = context.payment;
      if (!appointment || !payment)
        throw new BookingConfigurationError("Booking provider context is missing");
      if (command.command_type === "refund") {
        const renewLease = async () => {
          if (!familyLeaseCurrent() || !workerCanContinue()) throw new WorkerDeadlineError();
          const { data, error: renewError } = await bookingWorker.rpc(
            "renew_booking_refund_command_v3" as never,
            {
              p_command_id: command.id,
              p_lease_token: leaseToken,
              p_fencing_token: command.fencing_token,
              p_lease_seconds: 180,
            } as never,
          );
          if (renewError || data !== true)
            throw renewError ?? new Error("Stale booking refund lease");
        };
        if (!payment.stripe_account_id || !payment.payment_intent_id)
          throw new BookingConfigurationError("Stripe refund correlation is unavailable");
        const stripe = getStripe();
        const exactSnapshot = async () => {
          await renewLease();
          const paymentIntent = await stripe.paymentIntents.retrieve(
            payment.payment_intent_id!,
            {},
            { stripeAccount: payment.stripe_account_id! },
          );
          const latestChargeId =
            typeof paymentIntent.latest_charge === "string"
              ? paymentIntent.latest_charge
              : paymentIntent.latest_charge?.id;
          if (payment.charge_id && latestChargeId && payment.charge_id !== latestChargeId)
            throw new BookingConfigurationError("Stripe Charge identity changed");
          const chargeId = payment.charge_id ?? latestChargeId;
          if (!chargeId)
            throw new BookingConfigurationError("Stripe Charge identity is unavailable");
          const refunds: Record<string, unknown>[] = [];
          let startingAfter: string | undefined;
          const seenCursors = new Set<string>();
          for (;;) {
            await renewLease();
            const page = await stripe.refunds.list(
              {
                charge: chargeId,
                limit: 100,
                ...(startingAfter ? { starting_after: startingAfter } : {}),
              },
              { stripeAccount: payment.stripe_account_id! },
            );
            refunds.push(...(page.data as unknown as Record<string, unknown>[]));
            if (!page.has_more) break;
            const nextCursor = page.data.at(-1)?.id;
            if (!nextCursor || nextCursor === startingAfter || seenCursors.has(nextCursor))
              throw new Error("Stripe refund pagination did not advance");
            seenCursors.add(nextCursor);
            startingAfter = nextCursor;
          }
          await renewLease();
          const charge = await stripe.charges.retrieve(
            chargeId,
            {},
            { stripeAccount: payment.stripe_account_id! },
          );
          return providerJson({
            stripeAccountId: payment.stripe_account_id,
            paymentIntent,
            charge,
            refunds,
            refundsHasMore: false,
          });
        };

        const reduce = async (snapshot: Awaited<ReturnType<typeof exactSnapshot>>) => {
          await renewLease();
          const response = (await bookingWorker.rpc(
            "reduce_booking_financial_evidence_v3" as never,
            {
              p_authority_kind: "refund_command",
              p_authority_id: command.id,
              p_lease_token: leaseToken,
              p_fencing_token: command.fencing_token,
              p_provider_snapshot: snapshot,
            } as never,
          )) as unknown as { data: unknown; error: Error | null };
          if (response.error || !response.data)
            throw response.error ?? new Error("Stripe refund evidence was not accepted");
          if (
            typeof response.data !== "object" ||
            !("action" in response.data) ||
            !["create", "settled", "waiting", "failed", "superseded"].includes(
              String(response.data.action),
            )
          )
            throw new Error("Indeterminate booking refund settlement");
          return response.data as unknown as {
            action: "create" | "settled" | "waiting" | "failed" | "superseded";
            stripeAccountId?: string;
            paymentIntentId?: string;
            chargeId?: string;
            amountMinor?: number;
            idempotencyKey?: string;
            paymentId?: string;
            appointmentId?: string;
            profileId?: string;
            environment?: string;
            generation?: number;
            commandId?: string;
          };
        };

        let decision = await reduce(await exactSnapshot());
        if (decision.action === "create") {
          if (
            !decision.stripeAccountId ||
            !decision.paymentIntentId ||
            !decision.chargeId ||
            !decision.amountMinor ||
            !decision.idempotencyKey ||
            !decision.paymentId ||
            !decision.appointmentId ||
            !decision.profileId ||
            !decision.environment ||
            !decision.generation ||
            !decision.commandId
          )
            throw new BookingConfigurationError("Frozen refund submission is incomplete");
          let createError: unknown;
          try {
            await renewLease();
            await stripe.refunds.create(
              {
                charge: decision.chargeId,
                amount: decision.amountMinor,
                metadata: {
                  kind: "booking_refund",
                  bookingPaymentId: decision.paymentId,
                  bookingAppointmentId: decision.appointmentId,
                  bookingProfileId: decision.profileId,
                  bookingEnvironment: decision.environment,
                  refundGeneration: String(decision.generation),
                  bookingCommandId: decision.commandId,
                },
              },
              {
                stripeAccount: decision.stripeAccountId,
                idempotencyKey: decision.idempotencyKey,
              },
            );
          } catch (error) {
            createError = error;
          }
          decision = await reduce(await exactSnapshot());
          if (decision.action === "create")
            throw (
              createError ??
              new Error("Stripe refund creation did not appear in the complete Charge snapshot")
            );
        }
        if (decision.action === "failed") counts.failed++;
        else counts.processed++;
        continue;
      } else throw new BookingConfigurationError("Unsupported booking provider command");
    } catch (error) {
      const failure = bookingStripeFailure(error);
      const { data: failed, error: failError } = await bookingWorker.rpc(
        "fail_booking_refund_command_v3",
        {
          p_command_id: command.id,
          p_lease_token: leaseToken,
          p_fencing_token: command.fencing_token,
          p_retryable: failure.retryable,
          p_retry_delay_seconds: failure.retryDelaySeconds,
          p_safe_error: "Booking refund provider operation failed",
        } as never,
      );
      if (failError) throw failError;
      if (failed === true) counts.failed++;
      else counts.skipped++;
    }
  }
  counts.deadlineExceeded = Date.now() >= (workerProviderContext()?.deadlineAt ?? Infinity);
  return counts;
}
