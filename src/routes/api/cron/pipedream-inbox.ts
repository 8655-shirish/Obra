import { createFileRoute } from "@tanstack/react-router";
import { processPipedreamCalendarInbox } from "@/lib/pipedream-inbox-worker.server";
import { reconcileDuePipedreamTriggers } from "@/lib/pipedream-trigger-reconciliation.server";
import { withPipedreamDeadline } from "@/lib/pipedream.server";
import { readCalendarCronRequest } from "@/lib/calendar-cron-auth.server";
import { withWorkerDeadline, WorkerDeadlineError } from "@/lib/worker-deadline.server";
export const Route = createFileRoute("/api/cron/pipedream-inbox")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const expected = process.env.PIPEDREAM_INBOX_CRON_SECRET?.trim();
        const validated = await readCalendarCronRequest(request, "google", expected);
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
        const settled = await Promise.allSettled([
          withWorkerDeadline(Math.min(deadlineAt, startedAt + 15_000), () =>
            processPipedreamCalendarInbox(5, {
              environment,
              deadlineAt: Math.min(deadlineAt, startedAt + 15_000),
            }),
          ),
          withWorkerDeadline(deadlineAt, () =>
            withPipedreamDeadline(deadlineAt, () =>
              reconcileDuePipedreamTriggers(25, { environment, deadlineAt }),
            ),
          ),
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
            (result) =>
              ("deadlineExceeded" in result && result.deadlineExceeded === true) ||
              ("deadlineReached" in result && result.deadlineReached === true),
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
                  : "succeeded",
            elapsedMs: Date.now() - startedAt,
            budgetMs,
            processed: "processed" in results[0] ? results[0].processed : null,
            failed: rejected
              ? null
              : results.reduce(
                  (sum, result) =>
                    sum +
                    ("failed" in result && typeof result.failed === "number" ? result.failed : 0),
                  0,
                ),
            reconciled: "reconciled" in results[1] ? results[1].reconciled : null,
            inbox: results[0],
            reconciliation: results[1],
          },
          { status: rejected ? 500 : 200 },
        );
      },
    },
  },
});
