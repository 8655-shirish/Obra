import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { readCalendarCronRequest } from "@/lib/calendar-cron-auth.server";
import {
  withWorkerDeadline,
  workerCanContinue,
  WorkerDeadlineError,
} from "@/lib/worker-deadline.server";

const requestSchema = z.object({
  family: z.enum(["core", "notifications", "attachment_scan", "attachment_cleanup"]),
});

export const Route = createFileRoute("/api/cron/booking")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const expected = process.env.BOOKING_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
        const validated = await readCalendarCronRequest(request, "booking", expected);
        if (validated instanceof Response) return validated;
        const configured = Number(process.env["CALENDAR_WORKER_BUDGET_MS"] ?? 45_000);
        const budgetMs = Number.isFinite(configured)
          ? Math.max(10_000, Math.min(configured, 45_000))
          : 45_000;
        const reserve = Number(process.env["CALENDAR_WORKER_SETTLEMENT_MS"] ?? 5_000);
        const settlementMs = Number.isFinite(reserve)
          ? Math.max(3_000, Math.min(reserve, 5_000))
          : 5_000;
        const invocationDeadlineAt = startedAt + budgetMs;
        const deadlineAt = invocationDeadlineAt - settlementMs;
        try {
          return await withWorkerDeadline(
            invocationDeadlineAt,
            async () => {
              const signal = () => {
                const remaining = Math.floor(invocationDeadlineAt - Date.now());
                if (remaining <= 0) throw new Error("Booking invocation deadline exceeded");
                return AbortSignal.timeout(Math.min(3_000, remaining));
              };
              const mode = process.env["BOOKING_WORKER_MODE"]?.trim() ?? "off";
              if (mode !== "off" && mode !== "drain" && mode !== "active")
                return Response.json(
                  {
                    outcome: "failed",
                    environment: validated.environment,
                    scheduleName: validated.scheduleName,
                    error: "Invalid booking worker mode",
                  },
                  { status: 503 },
                );
              const environment = process.env["BOOKING_WORKER_ENVIRONMENT"]?.trim();
              if (environment !== "test" && environment !== "live")
                return Response.json(
                  {
                    outcome: "failed",
                    environment: validated.environment,
                    scheduleName: validated.scheduleName,
                    error: "Invalid booking worker environment",
                  },
                  { status: 503 },
                );
              const requestedEnvironment = request.headers.get("x-obra-worker-environment");
              if (requestedEnvironment !== null && requestedEnvironment !== environment)
                return Response.json(
                  {
                    outcome: "failed",
                    environment: validated.environment,
                    scheduleName: validated.scheduleName,
                    error: "Worker environment mismatch",
                  },
                  { status: 503 },
                );
              if (mode === "off")
                return Response.json({
                  disabled: true,
                  mode,
                  outcome: "off",
                  environment,
                  scheduleName: validated.scheduleName,
                });
              const parsed = requestSchema.safeParse(validated.body);
              if (!parsed.success)
                return Response.json({ error: "Invalid worker family" }, { status: 400 });
              try {
                const { billingEnvironment } = await import("@/lib/stripe.server");
                if (billingEnvironment() !== environment) throw new Error("Environment mismatch");
              } catch {
                return Response.json(
                  {
                    outcome: "failed",
                    environment,
                    scheduleName: validated.scheduleName,
                    error: "Stripe key mode does not match worker environment",
                  },
                  { status: 503 },
                );
              }
              const { bookingWorker } =
                await import("@/integrations/supabase/booking-worker.server");
              const leaseToken = randomUUID();
              const { data: fence, error: claimError } = await bookingWorker
                .rpc(
                  "claim_booking_worker_family_v3" as never,
                  {
                    p_environment: environment,
                    p_family: parsed.data.family,
                    p_lease_token: leaseToken,
                    p_lease_seconds: 55,
                  } as never,
                )
                .abortSignal(signal());
              if (claimError)
                return Response.json(
                  {
                    outcome: "failed",
                    environment,
                    scheduleName: validated.scheduleName,
                    error: "Unable to claim worker family",
                  },
                  { status: 500 },
                );
              if (fence === null)
                return Response.json({
                  skipped: true,
                  outcome: "skipped",
                  reason: "already_running",
                  environment,
                  scheduleName: validated.scheduleName,
                });
              const results: Record<string, unknown> = {};
              let coreHasFailures = false;
              let coreFailed: number | null = null;
              let notificationCounts: {
                processed: number;
                claimed: number;
                accepted: number;
                failed: number;
                suppressed: number;
                review: number;
                settled: number;
                skipped: number;
              } | null = null;
              let deadlineExceeded = false;
              let success = false;
              let renewalStopped = false;
              let renewalError: Error | null = null;
              let releaseHeartbeat: (() => void) | null = null;
              let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
              const heartbeat = (async () => {
                while (!renewalStopped) {
                  await new Promise<void>((resolve) => {
                    releaseHeartbeat = () => {
                      if (heartbeatTimer) clearTimeout(heartbeatTimer);
                      heartbeatTimer = null;
                      resolve();
                    };
                    heartbeatTimer = setTimeout(
                      releaseHeartbeat,
                      Math.min(20_000, Math.max(0, deadlineAt - Date.now())),
                    );
                  });
                  releaseHeartbeat = null;
                  if (renewalStopped || Date.now() >= deadlineAt) break;
                  try {
                    const { data, error } = await bookingWorker
                      .rpc(
                        "renew_booking_worker_family_v3" as never,
                        {
                          p_environment: environment,
                          p_family: parsed.data.family,
                          p_lease_token: leaseToken,
                          p_fencing_token: fence,
                          p_lease_seconds: 55,
                        } as never,
                      )
                      .abortSignal(signal());
                    if (error || data !== true) {
                      renewalError = error ?? new Error("Worker family lease renewal failed");
                      break;
                    }
                  } catch {
                    renewalError = new Error("Worker family lease renewal failed");
                    break;
                  }
                }
              })();
              const canContinue = () => renewalError === null && Date.now() < deadlineAt;
              try {
                if (parsed.data.family === "core") {
                  const [
                    { processBookingStripeInbox },
                    { processBookingOutbox },
                    { reconcileBookingLifecycle },
                    { withPipedreamDeadline },
                  ] = await Promise.all([
                    import("@/lib/booking-stripe-inbox-worker.server"),
                    import("@/lib/booking-outbox-worker.server"),
                    import("@/lib/booking-reconciliation.server"),
                    import("@/lib/pipedream.server"),
                  ]);
                  const settled = await Promise.allSettled([
                    withWorkerDeadline(
                      deadlineAt,
                      () => processBookingStripeInbox(environment, 25, canContinue),
                      { canContinue },
                    ),
                    withWorkerDeadline(
                      deadlineAt,
                      () => processBookingOutbox(environment, 25, canContinue),
                      { canContinue },
                    ),
                    withWorkerDeadline(
                      deadlineAt,
                      () =>
                        withPipedreamDeadline(deadlineAt, () =>
                          reconcileBookingLifecycle(environment, canContinue, deadlineAt),
                        ),
                      { canContinue },
                    ),
                  ]);
                  [results.inbox, results.outbox, results.lifecycle] = settled.map((item) =>
                    item.status === "fulfilled" ? item.value : { error: "Subworker failed" },
                  );
                  // Positive partial evidence is enough to fail health, but not to
                  // invent an exhaustive total for workers that omit failure counts.
                  const failureCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
                  const counts = settled.map((item) =>
                    item.status === "fulfilled"
                      ? z
                          .object({
                            failed: failureCount.nullish(),
                            googleFailures: failureCount.optional(),
                            latePaymentFailures: failureCount.optional(),
                            recoveryFailures: failureCount.optional(),
                            holdFailures: failureCount.optional(),
                            abandonedCheckoutFailures: failureCount.optional(),
                            sessionExpiryFailures: failureCount.optional(),
                            segmentFailures: failureCount.optional(),
                            skipped: failureCount.optional(),
                            deadlineExceeded: z.boolean().optional(),
                          })
                          .parse(item.value)
                      : null,
                  );
                  coreHasFailures = counts.some(
                    (item) =>
                      item !== null &&
                      Object.values(item).some((value) => typeof value === "number" && value > 0),
                  );
                  if (
                    counts.every(
                      (item) =>
                        typeof item?.failed === "number" &&
                        !item.deadlineExceeded &&
                        !item.skipped &&
                        Object.values(item).every(
                          (value) => typeof value !== "number" || value <= item.failed!,
                        ),
                    )
                  ) {
                    coreFailed = counts.reduce((sum, item) => sum + item!.failed!, 0);
                    if (!Number.isSafeInteger(coreFailed))
                      throw new Error("Invalid core failure total");
                  }
                  deadlineExceeded =
                    counts.some((item) => item?.deadlineExceeded) ||
                    settled.some(
                      (item) =>
                        item.status === "rejected" && item.reason instanceof WorkerDeadlineError,
                    );
                  if (settled.some((item) => item.status === "rejected"))
                    throw new Error("Core worker failed");
                  if (deadlineExceeded) throw new WorkerDeadlineError();
                } else if (parsed.data.family === "notifications") {
                  const { processBookingNotifications } =
                    await import("@/lib/booking-notification-worker.server");
                  const { error: projectionError } = await bookingWorker
                    .rpc(
                      "reconcile_booking_notification_projection_v3" as never,
                      { p_environment: environment, p_limit: 25 } as never,
                    )
                    .abortSignal(signal());
                  if (projectionError) throw new Error("Notification projection repair failed");
                  const totals = {
                    processed: 0,
                    claimed: 0,
                    accepted: 0,
                    failed: 0,
                    suppressed: 0,
                    review: 0,
                    settled: 0,
                    skipped: 0,
                  };
                  notificationCounts = totals;
                  results.notifications = totals;
                  await withWorkerDeadline(
                    deadlineAt,
                    async () => {
                      while (canContinue() && workerCanContinue()) {
                        const batch = await processBookingNotifications(
                          environment,
                          1,
                          canContinue,
                        );
                        if (
                          ![
                            batch.processed,
                            batch.claimed,
                            batch.accepted,
                            batch.failed,
                            batch.suppressed,
                            batch.review,
                            batch.settled,
                            batch.skipped,
                          ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
                          batch.claimed > 1 ||
                          batch.processed !== batch.accepted ||
                          batch.settled !==
                            batch.processed + batch.failed + batch.suppressed + batch.review ||
                          batch.settled + batch.skipped !== batch.claimed
                        )
                          throw new Error("Indeterminate notification result");
                        totals.processed += batch.processed;
                        totals.claimed += batch.claimed;
                        totals.accepted += batch.accepted;
                        totals.failed += batch.failed;
                        totals.suppressed += batch.suppressed;
                        totals.review += batch.review;
                        totals.settled += batch.settled;
                        totals.skipped += batch.skipped;
                        if (batch.claimed === 0) return;
                        // A lost settlement/continuation fence cannot drive another claim loop.
                        if (batch.settled !== batch.claimed)
                          throw new Error("Notification claim did not settle");
                      }
                      if (!canContinue() || !workerCanContinue()) throw new WorkerDeadlineError();
                    },
                    { canContinue },
                  );
                } else if (parsed.data.family === "attachment_scan") {
                  const { processBookingAttachmentScans } =
                    await import("@/lib/booking-attachments.functions");
                  if (canContinue())
                    results.attachments = await withWorkerDeadline(
                      deadlineAt,
                      () => processBookingAttachmentScans(environment, 1),
                      { canContinue },
                    );
                } else {
                  const { cleanupBookingAttachments } =
                    await import("@/lib/booking-attachments.functions");
                  if (canContinue())
                    results.attachmentCleanup = await withWorkerDeadline(
                      deadlineAt,
                      () =>
                        cleanupBookingAttachments(environment, {
                          discover: mode === "active",
                          limit: 1,
                        }),
                      { canContinue },
                    );
                }
                if (renewalError) throw renewalError;
                if (Date.now() >= deadlineAt) throw new Error("Booking worker budget exhausted");
                success = true;
              } catch (error) {
                deadlineExceeded ||= error instanceof WorkerDeadlineError;
                success = false;
              } finally {
                renewalStopped = true;
                (releaseHeartbeat as null | (() => void))?.();
                await heartbeat;
                if (renewalError) success = false;
              }
              if (Date.now() >= invocationDeadlineAt)
                return Response.json(
                  {
                    outcome: "deadline_exceeded",
                    scheduleName: validated.scheduleName,
                    error: "Booking invocation deadline exceeded before settlement",
                    mode,
                    environment,
                    family: parsed.data.family,
                    ...results,
                  },
                  { status: 500 },
                );
              const { data: familyCompleted, error: familyCompletionError } = await bookingWorker
                .rpc(
                  "complete_booking_worker_family_v3" as never,
                  {
                    p_environment: environment,
                    p_family: parsed.data.family,
                    p_lease_token: leaseToken,
                    p_fencing_token: fence,
                    p_success:
                      success &&
                      !coreHasFailures &&
                      (notificationCounts?.failed ?? 0) === 0 &&
                      (notificationCounts?.review ?? 0) === 0,
                    p_safe_error: !success
                      ? "Booking worker family failed"
                      : coreHasFailures
                        ? "Booking core rows failed"
                        : notificationCounts?.failed
                          ? "Booking notification rows failed"
                          : notificationCounts?.review
                            ? "Booking notification delivery requires review"
                            : null,
                  } as never,
                )
                .abortSignal(signal());
              if (familyCompletionError || familyCompleted !== true)
                return Response.json(
                  {
                    outcome: "failed",
                    environment,
                    scheduleName: validated.scheduleName,
                    error: "Unable to persist worker family result",
                  },
                  { status: 500 },
                );
              if (!success)
                return Response.json(
                  {
                    outcome:
                      deadlineExceeded || Date.now() >= deadlineAt ? "deadline_exceeded" : "failed",
                    scheduleName: validated.scheduleName,
                    error: "Booking worker family failed",
                    mode,
                    environment,
                    family: parsed.data.family,
                    elapsedMs: Date.now() - startedAt,
                    budgetMs,
                    ...notificationCounts,
                    // A rejected batch may have committed; only prior settled counts are known.
                    failed: null,
                    ...results,
                  },
                  { status: 500 },
                );
              return Response.json({
                outcome:
                  coreHasFailures ||
                  (notificationCounts?.failed ?? 0) + (notificationCounts?.review ?? 0) > 0
                    ? "partial_failure"
                    : notificationCounts
                      ? "succeeded"
                      : "completed",
                mode,
                environment,
                scheduleName: validated.scheduleName,
                family: parsed.data.family,
                elapsedMs: Date.now() - startedAt,
                budgetMs,
                // Skipped/deadline or missing lane evidence keeps totals unknown.
                ...notificationCounts,
                failed: notificationCounts?.failed ?? coreFailed,
                ...results,
              });
            },
            { workDeadlineAt: deadlineAt },
          );
        } catch (error) {
          return Response.json(
            {
              outcome:
                error instanceof WorkerDeadlineError || Date.now() >= deadlineAt
                  ? "deadline_exceeded"
                  : "failed",
              error: "Booking invocation did not complete",
              environment: validated.environment,
              scheduleName: validated.scheduleName,
              budgetMs,
              elapsedMs: Date.now() - startedAt,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
