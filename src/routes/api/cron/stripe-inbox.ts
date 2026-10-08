import { createFileRoute } from "@tanstack/react-router";
import { processCheckoutOtpOutbox } from "@/lib/checkout-otp-outbox-worker.server";
import { processSaasStripeInbox } from "@/lib/stripe-inbox-worker.server";
import {
  processStripeConnectInbox,
  reconcileDueStripeConnectAccounts,
} from "@/lib/stripe-connect-inbox-worker.server";
import { billingEnvironment } from "@/lib/stripe.server";
import { readCalendarCronRequest } from "@/lib/calendar-cron-auth.server";
import { withWorkerDeadline, WorkerDeadlineError } from "@/lib/worker-deadline.server";
export const Route = createFileRoute("/api/cron/stripe-inbox")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const expected = process.env.STRIPE_INBOX_CRON_SECRET?.trim();
        const validated = await readCalendarCronRequest(request, "stripe", expected);
        if (validated instanceof Response) return validated;
        const environment = process.env["BOOKING_WORKER_ENVIRONMENT"]?.trim();
        if (environment !== "test" && environment !== "live")
          return Response.json(
            {
              outcome: "failed",
              environment: validated.environment,
              scheduleName: validated.scheduleName,
              error: "Invalid worker environment",
            },
            { status: 503 },
          );
        try {
          if (billingEnvironment() !== environment) throw new Error("Environment mismatch");
        } catch {
          return Response.json(
            {
              outcome: "failed",
              environment: validated.environment ?? environment,
              scheduleName: validated.scheduleName,
              error: "Stripe worker configuration mismatch",
            },
            { status: 503 },
          );
        }
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
        const configured = Number(process.env["CALENDAR_WORKER_BUDGET_MS"] ?? 45_000);
        const budgetMs = Number.isFinite(configured)
          ? Math.max(10_000, Math.min(configured, 45_000))
          : 45_000;
        const reserve = Number(process.env["CALENDAR_WORKER_SETTLEMENT_MS"] ?? 5_000);
        const settlementMs = Number.isFinite(reserve)
          ? Math.max(3_000, Math.min(reserve, 5_000))
          : 5_000;
        const deadlineAt = startedAt + budgetMs - settlementMs;
        const saasEnabled = process.env["SAAS_STRIPE_INBOX_WORKER_ENABLED"] === "true";
        const fulfillmentEnabled =
          process.env["SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED"] === "true";
        // Independent starts: a rejected SaaS task must not starve saved Connect verification.
        const settled = await Promise.allSettled([
          saasEnabled
            ? withWorkerDeadline(Math.min(deadlineAt, startedAt + 20_000), () =>
                processSaasStripeInbox(1),
              )
            : Promise.resolve({ processed: 0, skipped: true as const }),
          withWorkerDeadline(Math.min(deadlineAt, startedAt + 20_000), () =>
            processStripeConnectInbox(2, {
              environment,
              deadlineAt: Math.min(deadlineAt, startedAt + 20_000),
            }),
          ),
          withWorkerDeadline(deadlineAt, () =>
            reconcileDueStripeConnectAccounts(25, { environment, deadlineAt }),
          ),
          fulfillmentEnabled
            ? withWorkerDeadline(Math.min(deadlineAt, startedAt + 20_000), () =>
                processCheckoutOtpOutbox(1),
              )
            : Promise.resolve({ accepted: 0, skipped: true as const }),
        ]);
        const results = settled.map((result) =>
          result.status === "fulfilled" ? result.value : { error: "Worker failed" },
        );
        const rejected = settled.some((result) => result.status === "rejected");
        const perRowFailure = results.some(
          (result) => "failed" in result && typeof result.failed === "number" && result.failed > 0,
        );
        const deadlineExceeded =
          Date.now() >= deadlineAt ||
          settled.some(
            (result) =>
              result.status === "rejected" && result.reason instanceof WorkerDeadlineError,
          ) ||
          results.some(
            (result) => "deadlineExceeded" in result && result.deadlineExceeded === true,
          );
        return Response.json(
          {
            environment,
            scheduleName: validated.scheduleName,
            outcome: deadlineExceeded
              ? "deadline_exceeded"
              : rejected
                ? "failed"
                : perRowFailure
                  ? "partial_failure"
                  : saasEnabled || fulfillmentEnabled
                    ? "completed"
                    : "succeeded",
            elapsedMs: Date.now() - startedAt,
            budgetMs,
            // Legacy SaaS/OTP workers do not report per-row failures. Never manufacture zero.
            failed:
              rejected || saasEnabled || fulfillmentEnabled
                ? null
                : results.reduce(
                    (sum, result) =>
                      sum +
                      ("failed" in result && typeof result.failed === "number" ? result.failed : 0),
                    0,
                  ),
            reconciled: "reconciled" in results[2] ? results[2].reconciled : null,
            accepted: "accepted" in results[3] ? results[3].accepted : null,
            saas: results[0],
            connect: results[1],
            reconciliation: results[2],
            checkoutFulfillment: results[3],
          },
          { status: rejected ? 500 : 200 },
        );
      },
    },
  },
});
