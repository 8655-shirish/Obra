import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import {
  withWorkerDeadline,
  workerCanContinue,
  workerProviderFetch,
} from "@/lib/worker-deadline.server";

type Environment = "test" | "live";
type AdminClient = Pick<SupabaseClient<Database>, "rpc">;
const runbook = "docs/runbooks/calendar-observability.md";
export const CALENDAR_ALERT_THRESHOLDS = {
  dispatchSeconds: 180,
  overdueSeconds: 120,
  freshnessSeconds: 900,
  paidCriticalSeconds: 300,
} as const;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
const nullableTime = timestamp.nullable();
const bindingFailureReasons = [
  "provider_account_unhealthy",
  "provider_account_missing",
  "provider_temporary_failure",
  "provider_platform_error",
  "provider_configuration_error",
  "provider_reauthorization_required",
  "calendar_permissions_changed",
  "calendar_selection_invalid",
  "trigger_missing",
  "trigger_identity_mismatch",
  "trigger_contract_mismatch",
  "trigger_contract_unavailable",
  "trigger_version_unverified",
  "trigger_webhook_mismatch",
  "trigger_deployment_ambiguous",
  "trigger_cleanup_pending",
  "unknown",
] as const;
const workerOutcome = z.enum([
  "succeeded",
  "completed",
  "partial_failure",
  "failed",
  "off",
  "skipped",
  "deadline_exceeded",
]);
const scheduleSchema = z.object({
  schedule_name: z.string(),
  registered: z.boolean(),
  active: z.boolean(),
  command_matches: z.boolean().nullable(),
  schedule_matches: z.boolean().nullable(),
  last_dispatched_at: nullableTime,
  last_responded_at: nullableTime,
  last_authenticated_completed_at: nullableTime,
  last_authenticated_requested_at: nullableTime,
  oldest_unanswered_at: nullableTime,
  overdue_unanswered_count: count,
  last_started_at: nullableTime,
  last_completed_at: nullableTime,
  last_success: z.boolean().nullable(),
  transport_outcome: z.enum(["succeeded", "failed", "timed_out", "pending"]).nullable(),
  worker_outcome: workerOutcome.nullable(),
  worker_counts: z.object({ failed: count.nullable() }).nullable(),
  status: z
    .enum([
      "missing_schedule",
      "inactive",
      "schedule_drift",
      "missed_dispatch",
      "missing_response",
      "missed_authenticated_completion",
      "off",
      "missed_worker_start",
      "worker_failed",
      "pending",
      "timed_out",
      "failed",
      "succeeded",
      "completed",
      "partial_failure",
      "skipped",
      "deadline_exceeded",
      "transport_only",
    ])
    .nullable(),
});
const pendingSchema = z.object({
  count,
  oldestPendingAt: nullableTime,
  oldestPendingAgeSeconds: count.nullable(),
  retryCount: count,
  expiredLeaseCount: count,
  oldestExpiredLeaseAt: nullableTime,
  oldestExpiredLeaseAgeSeconds: count.nullable(),
});
const healthSchema = z.object({
  environment: z.enum(["test", "live"]),
  observed_at: timestamp,
  scheduler_scope: z.object({ owner: z.string().min(1), visibility: z.literal("owner_only") }),
  response_recorder: z
    .object({
      registered: z.literal(true).nullable(),
      active: z.boolean().nullable(),
      last_recorded_response_at: nullableTime,
    })
    .refine((recorder) => (recorder.registered === null) === (recorder.active === null), {
      message: "Calendar response recorder registry is inconsistent",
    }),
  schedules: z.array(scheduleSchema).length(4),
  overdue_connections: z
    .array(
      z.object({
        provider: z.enum(["google", "stripe"]),
        id: z.string().uuid(),
        profile_id: z.string().uuid(),
        environment: z.enum(["test", "live"]),
        last_success_at: nullableTime,
        due_at: timestamp,
        overdue_seconds: count,
        expired_lease_seconds: count.nullable(),
        attempts: count,
        freshness_expired: z.boolean(),
      }),
    )
    .max(100),
  overdue_connections_limit: z.literal(100),
  binding_failures: z.record(z.enum(bindingFailureReasons), count),
  row_failures: z.object({
    google_inbox: count,
    stripe_connect_inbox: count,
    saas_inbox: count,
    booking_inbox: count,
    stripe_verification: count,
    calendar_manual_repair: count,
    notifications: count,
  }),
  overdue_obligations: z.object({
    calendar: pendingSchema.extend({
      blockedCount: count,
      manualRepairCount: count,
      unresolvedDestinationCount: count,
    }),
    notifications: pendingSchema.extend({
      failedCount: count,
      deliveryDelayedCount: count,
      reviewCount: count,
      oldestReviewAt: nullableTime,
    }),
  }),
});
const noticeHealthSchema = z.object({
  environment: z.enum(["test", "live"]),
  observed_at: timestamp,
  action_required_count: count,
  pending_count: count,
  oldest_pending_age_seconds: count,
  review_count: count,
  setup_overdue_count: count,
  oldest_setup_overdue_seconds: count,
  platform_error_count: count,
  unverified_disconnected_count: count,
  items_limit: z.literal(100),
  items: z
    .array(
      z.object({
        connection_id: z.string().uuid(),
        profile_id: z.string().uuid(),
        // Top-level identity/state describe the retained delivery, not a later incident.
        notice_id: z.string().uuid(),
        current_incident: z.object({
          id: z.string().uuid(),
          cause: z.enum(["reauthorization", "permissions", "selection", "setup"]),
          source: z.enum(["saved", "setup"]),
          opened_at: timestamp,
          closed_at: nullableTime,
        }),
        cause: z.enum(["reauthorization", "permissions", "selection", "setup"]),
        source: z.enum(["saved", "setup"]),
        state: z.enum(["pending", "accepted", "suppressed", "review"]),
        opened_at: timestamp,
        closed_at: nullableTime,
        first_dispatch_at: nullableTime,
        accepted_at: nullableTime,
        next_attempt_at: nullableTime,
        lease_expires_at: nullableTime,
        review_reason: z
          .enum([
            "recipient_unavailable",
            "recipient_changed",
            "provider_rejected",
            "acceptance_unknown",
            "idempotency_expired",
          ])
          .nullable(),
      }),
    )
    .max(100),
});

export type CalendarAlertState = {
  id: string;
  status: "firing" | "resolved";
  severity: "warning" | "critical";
  summary: string;
  value: number;
  threshold: number;
  unit: "seconds" | "count";
  owner: string;
  channel: string;
  dedupeKey: string;
  runbook: string;
  observedAt: string;
  environment: Environment;
};
type Routing = { owner: string; channel: string };

function alert(
  environment: Environment,
  observedAt: string,
  routing: Routing,
  id: string,
  summary: string,
  value: number,
  threshold = 1,
  severity: CalendarAlertState["severity"] = "warning",
  unit: CalendarAlertState["unit"] = "count",
): CalendarAlertState {
  return {
    id,
    summary,
    value,
    threshold,
    severity,
    unit,
    status: value >= threshold ? "firing" : "resolved",
    owner: routing.owner,
    channel: routing.channel,
    environment,
    dedupeKey: `calendar:${environment}:${id}`,
    runbook,
    observedAt,
  };
}

/** Pure evaluation of the real RPC projections. Missing/malformed evidence throws,
 * never resolves a previously firing condition by substituting an empty inventory. */
export function evaluateCalendarObservability(
  environment: Environment,
  rawHealth: unknown,
  rawNotices: unknown,
  routing: Routing = { owner: "Unassigned", channel: "Not configured" },
) {
  const health = healthSchema.parse(rawHealth);
  const notices = noticeHealthSchema.parse(rawNotices);
  const t = CALENDAR_ALERT_THRESHOLDS;
  const observedAt = health.observed_at;
  const now = Date.parse(observedAt);
  const age = (at: string | null) =>
    at === null ? 0 : Math.max(0, Math.floor((now - Date.parse(at)) / 1000));
  const workers = ["google", "stripe", "booking-core", "booking-notifications"];
  if (
    health.environment !== environment ||
    notices.environment !== environment ||
    health.overdue_connections.some((c) => c.environment !== environment) ||
    new Set(health.schedules.map((s) => s.schedule_name)).size !== 4 ||
    workers.some(
      (worker) =>
        !health.schedules.some((s) => s.schedule_name === `obra-calendar-${environment}-${worker}`),
    )
  )
    throw new Error("Calendar health scope is invalid");
  const alerts: CalendarAlertState[] = [];
  const add = (
    id: string,
    summary: string,
    value: number,
    threshold = 1,
    severity: CalendarAlertState["severity"] = "warning",
    unit: CalendarAlertState["unit"] = "count",
  ) =>
    alerts.push(
      alert(environment, observedAt, routing, id, summary, value, threshold, severity, unit),
    );
  add(
    "assessment-unavailable",
    "Calendar assessment is unavailable; previous conditions are unknown",
    0,
    1,
    "critical",
  );
  // Hidden registry entries cannot establish absence or resolve a prior alarm.
  // Shared response timestamps are recording evidence, not registry/worker health.
  if (health.response_recorder.registered === true)
    add(
      "response-recorder",
      "Owned calendar response recorder is inactive",
      Number(!health.response_recorder.active),
      1,
      "critical",
    );
  for (const worker of workers) {
    const s = health.schedules.find(
      (row) => row.schedule_name === `obra-calendar-${environment}-${worker}`,
    )!;
    add(
      `${worker}:schedule`,
      `${worker} schedule is missing, inactive or drifted`,
      Number(
        !s.registered || !s.active || s.command_matches !== true || s.schedule_matches !== true,
      ),
      1,
      "critical",
    );
    add(
      `${worker}:dispatch`,
      `${worker} has missed three minutes of dispatch`,
      s.last_dispatched_at ? age(s.last_dispatched_at) : t.dispatchSeconds,
      t.dispatchSeconds,
      "critical",
      "seconds",
    );
    add(
      `${worker}:completion`,
      `${worker} has no recent authenticated completion or an unanswered dispatch`,
      Math.max(
        s.last_authenticated_completed_at
          ? age(s.last_authenticated_completed_at)
          : s.last_dispatched_at
            ? age(s.last_dispatched_at)
            : t.dispatchSeconds,
        age(s.oldest_unanswered_at),
        s.overdue_unanswered_count > 0 || s.status === "missed_authenticated_completion"
          ? t.dispatchSeconds
          : 0,
      ),
      t.dispatchSeconds,
      "critical",
      "seconds",
    );
    if (worker.startsWith("booking-"))
      add(
        `${worker}:start`,
        `${worker} has missed three minutes of worker starts`,
        s.last_started_at ? age(s.last_started_at) : t.dispatchSeconds,
        t.dispatchSeconds,
        "critical",
        "seconds",
      );
    add(
      `${worker}:outcome`,
      `${worker} reports off, failed, partial, skipped or unverified work`,
      Number(
        s.last_success === false ||
          (s.worker_counts?.failed ?? 0) > 0 ||
          ["off", "failed", "partial_failure", "skipped", "deadline_exceeded"].includes(
            s.worker_outcome ?? "",
          ) ||
          ["failed", "timed_out"].includes(s.transport_outcome ?? "") ||
          (s.transport_outcome === "succeeded" && !s.worker_outcome),
      ),
      1,
      "critical",
    );
  }
  for (const provider of ["google", "stripe"] as const) {
    const rows = health.overdue_connections.filter((c) => c.provider === provider);
    add(
      `${provider}:verification-overdue`,
      `${provider} verification is overdue`,
      Math.max(0, ...rows.map((c) => c.overdue_seconds)),
      t.overdueSeconds,
      "warning",
      "seconds",
    );
    add(
      `${provider}:freshness`,
      `${provider} verification has reached the 15-minute freshness boundary`,
      Math.max(
        0,
        ...rows.map((c) =>
          Math.max(age(c.last_success_at), c.freshness_expired ? t.freshnessSeconds : 0),
        ),
      ),
      t.freshnessSeconds,
      "critical",
      "seconds",
    );
    add(
      `${provider}:expired-lease`,
      `${provider} verification lease has not recovered in two cycles`,
      Math.max(0, ...rows.map((c) => c.expired_lease_seconds ?? 0)),
      t.overdueSeconds,
      "warning",
      "seconds",
    );
    add(
      `${provider}:retry-exhaustion`,
      `${provider} verification is in extended retry`,
      rows.filter((c) => c.attempts >= 8).length,
    );
  }
  // This uncapped aggregate owns persistent incidents. An idle invocation and
  // fresh account reads do not establish that its monitoring trigger recovered.
  for (const reason of bindingFailureReasons)
    add(
      `google:binding:${reason}`,
      `Google monitoring has unresolved ${reason} failures`,
      health.binding_failures[reason] ?? 0,
      1,
      reason === "provider_temporary_failure" ? "warning" : "critical",
    );
  add(
    "connection-inventory-limit",
    "Overdue connection inventory is capped; counts are a lower bound",
    health.overdue_connections.length,
    health.overdue_connections_limit,
  );
  const calendar = health.overdue_obligations.calendar;
  const notifications = health.overdue_obligations.notifications;
  for (const [name, obligation] of [
    ["paid-calendar", calendar],
    ["booking-notifications", notifications],
  ] as const) {
    if (
      (obligation.count > 0 &&
        (!obligation.oldestPendingAt || obligation.oldestPendingAgeSeconds === null)) ||
      (obligation.expiredLeaseCount > 0 &&
        (!obligation.oldestExpiredLeaseAt || obligation.oldestExpiredLeaseAgeSeconds === null))
    )
      throw new Error("Calendar obligation age is unavailable");
    const pendingAge =
      obligation.count > 0
        ? Math.max(age(obligation.oldestPendingAt), obligation.oldestPendingAgeSeconds ?? 0)
        : 0;
    add(
      `${name}:pending`,
      `${name} work has waited more than two scheduling cycles`,
      pendingAge,
      t.overdueSeconds,
      "warning",
      "seconds",
    );
    if (name === "paid-calendar")
      add(
        `${name}:critical`,
        "Paid calendar fulfillment has waited five minutes",
        pendingAge,
        t.paidCriticalSeconds,
        "critical",
        "seconds",
      );
    add(
      `${name}:expired-lease`,
      `${name} lease recovery is overdue`,
      obligation.expiredLeaseCount > 0
        ? Math.max(
            age(obligation.oldestExpiredLeaseAt),
            obligation.oldestExpiredLeaseAgeSeconds ?? 0,
          )
        : 0,
      t.overdueSeconds,
      "warning",
      "seconds",
    );
  }
  add(
    "paid-calendar:blocked",
    "Paid calendar fulfillment needs permission or audited destination/conflict repair",
    Math.max(
      calendar.blockedCount,
      calendar.manualRepairCount,
      calendar.unresolvedDestinationCount,
    ),
    1,
    "critical",
  );
  add(
    "booking-notifications:review",
    "Booking email failure or unresolved delivery requires review",
    Math.max(notifications.failedCount, notifications.reviewCount),
    1,
    "critical",
  );
  add(
    "booking-notifications:delayed",
    "Provider-accepted booking email is delayed; do not resend",
    notifications.deliveryDelayedCount,
  );
  for (const [name, value] of Object.entries(health.row_failures))
    add(`rows:${name}`, `${name} has durable failed or retrying work`, value);
  add(
    "setup:overdue",
    "Owner-authorized calendar setup continuation is overdue",
    notices.oldest_setup_overdue_seconds,
    t.overdueSeconds,
    "warning",
    "seconds",
  );
  add(
    "connection:platform",
    "Calendar service configuration needs operator attention, not contractor OAuth",
    notices.platform_error_count,
    1,
    "critical",
  );
  add(
    "connection:action-required",
    "Calendar consent, access or setup has no confirmed resolution",
    notices.action_required_count,
  );
  add(
    "connection:unverified",
    "Provider-disconnected calendar has no current evidence; consent status is unconfirmed",
    notices.unverified_disconnected_count,
    1,
    "critical",
  );
  add(
    "action-notices:pending",
    "Contractor action email has waited more than two scheduling cycles",
    notices.oldest_pending_age_seconds,
    t.overdueSeconds,
    "warning",
    "seconds",
  );
  add(
    "action-notices:review",
    "Contractor action email delivery is unresolved; automatic resend is unsafe",
    notices.review_count,
    1,
    "critical",
  );
  return {
    environment,
    observedAt,
    schedulerScope: health.scheduler_scope,
    responseRecorder: health.response_recorder,
    // A capped oldest-100 inventory establishes positive breaches, not absence of
    // unseen provider failures. Keep their previous conditions unknown, not resolved.
    alerts:
      health.overdue_connections.length < health.overdue_connections_limit
        ? alerts
        : alerts.filter(
            (item) =>
              item.status === "firing" ||
              !/^(google|stripe):(verification-overdue|freshness|expired-lease|retry-exhaustion)$/.test(
                item.id,
              ),
          ),
    schedules: health.schedules,
    overdueConnections: health.overdue_connections,
    bindingFailures: health.binding_failures,
    obligations: health.overdue_obligations,
    actionNotices: notices,
    independentMonitorVerified: false as const,
  };
}

function environment(): Environment {
  const value = process.env.CALENDAR_MONITOR_ENVIRONMENT;
  if (value !== "test" && value !== "live")
    throw new Error("Calendar monitor environment is not configured");
  return value;
}
function routing(): Routing {
  return {
    owner: process.env.CALENDAR_ALERT_OWNER?.trim() || "Unassigned",
    channel: process.env.CALENDAR_ALERT_CHANNEL?.trim() || "Not configured",
  };
}
function webhookConfiguration() {
  const value = process.env.CALENDAR_ALERT_WEBHOOK_URL;
  const url = new URL(value ?? "");
  const token = process.env.CALENDAR_ALERT_WEBHOOK_TOKEN || undefined;
  const destination = routing();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !process.env.CALENDAR_ALERT_OWNER?.trim() ||
    !process.env.CALENDAR_ALERT_CHANNEL?.trim() ||
    [destination.owner, destination.channel].some(
      (s) =>
        s.length > 120 ||
        [...s].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127),
    ) ||
    (token !== undefined && (!token.trim() || /\s/.test(token)))
  )
    throw new Error("Calendar alert delivery is not configured");
  return { url: url.href, token, ...destination };
}

async function rpc<
  Name extends
    | "get_calendar_worker_health"
    | "get_calendar_action_notice_health"
    | "claim_calendar_action_notice"
    | "transition_calendar_action_notice",
>(supabase: AdminClient, name: Name, args: Database["public"]["Functions"][Name]["Args"]) {
  const result = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(5_000));
  if (result.error) throw new Error("Calendar monitoring database operation failed");
  return result.data as unknown;
}

export async function collectCalendarObservability(
  supabase: AdminClient,
  scope: Environment = environment(),
) {
  return withWorkerDeadline(Date.now() + 10_000, async () => {
    try {
      const [health, notices] = await Promise.all([
        rpc(supabase, "get_calendar_worker_health", { p_environment: scope }),
        rpc(supabase, "get_calendar_action_notice_health", { p_environment: scope }),
      ]);
      let alertConfigured = false;
      let noticeConfigured = false;
      try {
        webhookConfiguration();
        alertConfigured = true;
      } catch {
        /* Report config, never its values. */
      }
      try {
        noticeConfiguration(scope);
        noticeConfigured = true;
      } catch {
        /* Reading never enables delivery. */
      }
      return {
        ...evaluateCalendarObservability(scope, health, notices, routing()),
        configuration: {
          monitorEnabled: process.env.CALENDAR_MONITOR_ENABLED === "true",
          actionNoticesEnabled: process.env.CALENDAR_ACTION_NOTICES_ENABLED === "true",
          alertConfigured,
          noticeConfigured,
        },
      };
    } catch {
      throw new Error("Calendar assessment unavailable; previous conditions are unknown");
    }
  });
}

function noticeConfiguration(scope: Environment) {
  const key = process.env[`RESEND_API_KEY_${scope.toUpperCase()}`];
  const from = process.env[`BOOKING_EMAIL_FROM_${scope.toUpperCase()}`]?.trim();
  const origin = process.env.PUBLIC_APP_URL;
  if (
    !key ||
    /\s/.test(key) ||
    !from ||
    from.length > 320 ||
    /[\r\n]/.test(from) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.replace(/^.*<([^<>]+)>$/, "$1")) ||
    (origin !== "https://obratech.co" && origin !== "https://obratech.co/")
  )
    throw new Error("Calendar action email is not configured");
  return { key, from, loginUrl: "https://obratech.co/login" };
}

const claimSchema = z.object({
  connection_id: z.string().uuid(),
  environment: z.enum(["test", "live"]),
  fencing_token: count,
  lease_expires_at: timestamp,
  notice: z.object({
    id: z.string().uuid(),
    state: z.literal("pending"),
    recipient_email: z.string().email().max(254),
    scope: z.object({
      cause: z.enum(["reauthorization", "permissions", "selection", "setup"]),
      source: z.enum(["saved", "setup"]),
    }),
    payload: z.string().max(16384).optional(),
  }),
});

export async function processCalendarActionNotices(supabase: AdminClient, scope: Environment) {
  const config = noticeConfiguration(scope);
  return withWorkerDeadline(
    Date.now() + 25_000,
    async () => {
      const counts = { claimed: 0, accepted: 0, deferred: 0, failed: 0 };
      // Just-in-time claims, not a preleased batch. No login session or booking required.
      while (workerCanContinue() && counts.claimed < 20) {
        const lease = randomUUID();
        const raw = await rpc(supabase, "claim_calendar_action_notice", {
          p_environment: scope,
          p_lease_token: lease,
        });
        if (raw === null) break;
        const row = claimSchema.parse(raw);
        if (row.environment !== scope) throw new Error("Calendar action claim scope is invalid");
        counts.claimed++;
        const cause = row.notice.scope.cause;
        const message =
          cause === "reauthorization"
            ? "Google requires renewed authorization for your calendar connection. Sign in to Obra and reconnect Google."
            : cause === "permissions"
              ? "Access needed for your selected Google calendars is no longer available. Sign in to Obra to review calendar permissions or choose an accessible calendar. Reconnecting alone may not restore calendar access."
              : cause === "setup"
                ? "Your Google calendar setup could not complete because its configuration or verification needs attention. Sign in to Obra to review your calendar setup. If it still cannot complete, contact support. This does not by itself mean Google authorization was revoked."
                : "Your saved Google calendar selection needs attention. Sign in to Obra to review and choose your calendars.";
        const payload =
          row.notice.payload ??
          JSON.stringify({
            from: config.from,
            to: [row.notice.recipient_email],
            subject: "Action needed: your Obra calendar connection",
            text:
              message +
              (row.notice.scope.source === "setup"
                ? " Your calendar setup has not completed."
                : "") +
              "\n\nCalendar booking availability may be restricted until this is resolved. Existing booking and payment status are separate; review them in your workspace.\n\nSign in: " +
              config.loginUrl,
          });
        const fence = {
          p_environment: scope,
          p_connection_id: row.connection_id,
          p_notice_id: row.notice.id,
          p_lease_token: lease,
          p_fencing_token: row.fencing_token,
        };
        if (!workerCanContinue()) {
          counts.deferred++;
          break;
        }
        const authorizationStart = performance.now();
        const authorization = z
          .object({
            action: z.enum(["dispatch", "deferred", "suppressed", "review"]),
            payload: z.string().optional(),
            dispatch_budget_ms: z.number().positive().max(10_000).optional(),
            idempotency_key: z.string().optional(),
          })
          .parse(
            await rpc(supabase, "transition_calendar_action_notice", {
              ...fence,
              p_action: "authorize",
              p_payload: payload,
            }),
          );
        if (authorization.action !== "dispatch") {
          counts.deferred++;
          continue;
        }
        if (
          authorization.payload !== payload ||
          !authorization.dispatch_budget_ms ||
          authorization.idempotency_key !==
            `calendar-action:${scope}:${row.connection_id}:${row.notice.id}`
        )
          throw new Error("Calendar action dispatch authority is invalid");
        const remaining = Math.floor(
          authorizationStart + authorization.dispatch_budget_ms - performance.now(),
        );
        if (remaining <= 0 || !workerCanContinue()) {
          counts.deferred++;
          break;
        }
        let action: "accepted" | "unknown" | "rejected" = "unknown";
        let providerId: string | undefined;
        try {
          const response = await workerProviderFetch("https://api.resend.com/emails", {
            method: "POST",
            // redirect:"manual" (Workers rejects "error"); non-ok stays ambiguous below.
            redirect: "manual",
            signal: AbortSignal.timeout(remaining),
            headers: {
              Authorization: `Bearer ${config.key}`,
              "Content-Type": "application/json",
              "Idempotency-Key": authorization.idempotency_key,
            },
            body: authorization.payload,
          });
          if (response.ok) {
            const text = await response.text();
            if (text.length <= 16_384) {
              const result = z
                .object({ id: z.string().regex(/^[A-Za-z0-9_-]{8,200}$/) })
                .safeParse(JSON.parse(text));
              if (result.success) {
                providerId = result.data.id;
                action = "accepted";
              }
            }
          } else if (
            response.status >= 400 &&
            response.status < 500 &&
            ![408, 409, 429].includes(response.status)
          ) {
            action = "rejected";
          }
        } catch {
          // Transport/body failure after authorization is ambiguous, not proven rejection.
        }
        let settled = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const settlement = await rpc(supabase, "transition_calendar_action_notice", {
              ...fence,
              p_action: action,
              ...(providerId ? { p_provider_message_id: providerId } : {}),
            });
            const result = z
              .object({ action: z.enum(["accepted", "pending", "review"]) })
              .parse(settlement);
            if (action === "accepted" && result.action !== "accepted")
              throw new Error("Calendar acceptance is unresolved");
            settled = true;
            break;
          } catch {
            // Retry only the known result's DB settlement. Never send again in this claim.
          }
        }
        if (!settled) throw new Error("Calendar action email settlement is unresolved");
        if (action === "accepted") counts.accepted++;
        else counts.failed++;
      }
      return counts;
    },
    { workDeadlineAt: Date.now() + 20_000 },
  );
}

/** Same firing/resolved adapter contract as generation, without its hard-coded
 * generation namespace or unbounded redirect behavior. URLs come only from env. */
export async function deliverCalendarAlertStates(alerts: CalendarAlertState[]) {
  const config = webhookConfiguration();
  return withWorkerDeadline(
    Date.now() + 10_000,
    async () => {
      const response = await workerProviderFetch(config.url, {
        method: "POST",
        // redirect:"manual" (Workers rejects "error"); non-ok fails closed below.
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: {
          "content-type": "application/json",
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({
          source: "obra.calendar",
          owner: config.owner,
          channel: config.channel,
          alerts,
        }),
      });
      if (!response.ok) throw new Error("Calendar alert delivery failed");
      return { delivered: alerts.length, destination: config.channel };
    },
    { workDeadlineAt: Date.now() + 8_000 },
  );
}

export async function runCalendarMonitor(supabase: AdminClient) {
  let scope: Environment;
  let destination: Routing;
  try {
    if (process.env.CALENDAR_MONITOR_ENABLED !== "true") throw new Error("Invalid monitor flag");
    scope = environment();
    const configured = webhookConfiguration();
    destination = { owner: configured.owner, channel: configured.channel };
  } catch {
    return {
      outcome: "configuration_error" as const,
      error: "Calendar monitor configuration unavailable",
    };
  }
  const noticesFlag = process.env.CALENDAR_ACTION_NOTICES_ENABLED;
  const [initialAssessment, notices] = await Promise.allSettled([
    collectCalendarObservability(supabase, scope),
    noticesFlag === "true"
      ? processCalendarActionNotices(supabase, scope)
      : noticesFlag === undefined || noticesFlag === "" || noticesFlag === "false"
        ? Promise.resolve(null)
        : Promise.reject(new Error("Invalid calendar action notice flag")),
  ]);
  // Dispatch may have accepted, suppressed or moved an incident to review. Report
  // that durable outcome, not the pre-send snapshot's obsolete pending count.
  const [assessment] =
    initialAssessment.status === "fulfilled" && noticesFlag === "true"
      ? await Promise.allSettled([collectCalendarObservability(supabase, scope)])
      : [initialAssessment];
  const observedAt = new Date().toISOString();
  const alerts =
    assessment.status === "fulfilled"
      ? assessment.value.alerts
      : [
          alert(
            scope,
            observedAt,
            destination,
            "assessment-unavailable",
            "Calendar assessment is unavailable; previous conditions are unknown",
            1,
            1,
            "critical",
          ),
        ];
  alerts.push(
    alert(
      scope,
      observedAt,
      destination,
      "action-notices:disabled",
      "Unattended contractor action email is disabled",
      Number(noticesFlag !== "true"),
    ),
  );
  alerts.push(
    alert(
      scope,
      observedAt,
      destination,
      "action-notices:delivery",
      "Contractor action email processing or settlement failed",
      notices.status === "rejected" ? 1 : (notices.value?.failed ?? 0),
      1,
      "critical",
    ),
  );
  try {
    const delivery = await deliverCalendarAlertStates(alerts);
    return {
      outcome:
        assessment.status === "rejected" ||
        notices.status === "rejected" ||
        (notices.status === "fulfilled" && (notices.value?.failed ?? 0) > 0)
          ? ("partial_failure" as const)
          : ("succeeded" as const),
      environment: scope,
      observedAt,
      assessmentAvailable: assessment.status === "fulfilled",
      ...delivery,
      alerts,
      notices:
        notices.status === "fulfilled"
          ? (notices.value ?? { outcome: "disabled" })
          : { outcome: "failed" },
    };
  } catch {
    return {
      outcome: "delivery_failed" as const,
      environment: scope,
      observedAt,
      alerts,
      error: "Calendar alert delivery failed",
    };
  }
}
