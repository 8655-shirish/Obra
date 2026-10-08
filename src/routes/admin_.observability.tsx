import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { AdminGate } from "@/components/admin/AdminGate";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCalendarObservability,
  getGenerationObservability,
} from "@/lib/admin-observability.functions";
import { BUCKET1_ALERT_CHANNEL, BUCKET1_ALERT_OWNER } from "@/lib/generation-observability";
import { NOINDEX_META } from "@/lib/seo";

type Report = Awaited<ReturnType<typeof getGenerationObservability>>;
type CalendarReport = Awaited<ReturnType<typeof getCalendarObservability>>;

export const Route = createFileRoute("/admin_/observability")({
  head: () => ({
    meta: [{ title: "Worker observability | Obra Admin" }, ...NOINDEX_META],
  }),
  component: GenerationObservabilityPage,
});

function formatValue(value: number | null, unit: "seconds" | "ratio") {
  if (value == null) return "No samples";
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (value >= 3600) return `${(value / 3600).toFixed(1)}h`;
  if (value >= 60) return `${(value / 60).toFixed(1)}m`;
  return `${Math.round(value)}s`;
}

function GenerationObservabilityPage() {
  return <AdminGate>{({ onLogout }) => <Dashboard onLogout={onLogout} />}</AdminGate>;
}

function Dashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const [report, setReport] = useState<Report | null>(null);
  const [calendar, setCalendar] = useState<CalendarReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [generationResult, calendarResult] = await Promise.allSettled([
      getGenerationObservability(),
      getCalendarObservability(),
    ]);
    if (generationResult.status === "fulfilled") setReport(generationResult.value);
    else {
      setReport(null);
      setError("Generation assessment unavailable; previous conditions are unknown.");
    }
    setCalendar(
      calendarResult.status === "fulfilled"
        ? calendarResult.value
        : {
            outcome: "unavailable",
            error: "Calendar assessment unavailable; previous conditions are unknown.",
          },
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const firing = report?.alerts.filter((alert) => alert.status === "firing") ?? [];
  const calendarReport = calendar?.outcome === "available" ? calendar.report : null;

  return (
    <AdminShell onLogout={onLogout}>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 [&_section]:min-w-0">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Worker observability</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generation and calendar health, outstanding work, and independent-alert decisions.
          </p>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>
            Generation owner <strong>{BUCKET1_ALERT_OWNER}</strong> · destination{" "}
            <strong>{BUCKET1_ALERT_CHANNEL}</strong>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {report && <span className="text-muted-foreground">Observed {report.observedAt}</span>}
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <section aria-labelledby="calendar-alerts" className="space-y-3">
          <h2 id="calendar-alerts" className="text-lg font-semibold">
            Calendar monitoring
          </h2>
          {calendar?.outcome === "unavailable" && (
            <p
              role="alert"
              className="rounded-lg border border-destructive p-3 text-sm text-destructive"
            >
              {calendar.error}
            </p>
          )}
          {calendarReport && (
            <>
              <p className="text-sm text-muted-foreground">
                Environment {calendarReport.environment}; observed {calendarReport.observedAt}.{" "}
                Operator {calendarReport.alerts[0]?.owner}; destination{" "}
                {calendarReport.alerts[0]?.channel}. Independent caller and destination acceptance
                must be verified during deployment. Opening this dashboard does not send email or
                run maintenance.
              </p>
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <p className="break-words">
                  Scheduler registry scope: only jobs owned by{" "}
                  <strong>{calendarReport.schedulerScope.owner}</strong>. Jobs owned by other roles
                  are not visible in this assessment.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span>Response recorder configuration</span>
                  <Badge
                    variant={
                      calendarReport.responseRecorder.active === false ? "destructive" : "secondary"
                    }
                  >
                    {calendarReport.responseRecorder.registered === null
                      ? "Unknown registry"
                      : calendarReport.responseRecorder.active
                        ? "Owned recorder active"
                        : "Owned recorder inactive"}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {calendarReport.responseRecorder.registered === null
                    ? "No owned recorder is visible. A recorder owned by another role may exist but is invisible here. This unknown coverage neither fires nor resolves a recorder configuration alarm."
                    : "Owned registration and activation describe configuration, not proof of execution."}
                </p>
                <p className="break-words">
                  Last recorded response (shared ledger):{" "}
                  {calendarReport.responseRecorder.last_recorded_response_at ??
                    "none at or before this observation"}
                  .
                </p>
                <p className="text-muted-foreground">
                  Includes failed responses from any schedule. This timestamp is historical
                  recording evidence, not proof that the recorder is running now or that any
                  calendar worker succeeded. Worker absence and failure conditions remain separate.
                </p>
              </div>
              {(!calendarReport.configuration.monitorEnabled ||
                !calendarReport.configuration.alertConfigured ||
                !calendarReport.configuration.actionNoticesEnabled ||
                !calendarReport.configuration.noticeConfigured) && (
                <p role="alert" className="rounded-lg border p-3 text-sm">
                  Monitor {calendarReport.configuration.monitorEnabled ? "enabled" : "disabled"};
                  operator destination{" "}
                  {calendarReport.configuration.alertConfigured ? "configured" : "not configured"};{" "}
                  contractor email{" "}
                  {calendarReport.configuration.actionNoticesEnabled &&
                  calendarReport.configuration.noticeConfigured
                    ? "enabled and configured"
                    : "disabled or not configured"}
                  . Configuration is not proof of delivery.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {calendarReport.alerts
                  .filter((item) => item.status === "firing")
                  .map((item) => (
                    <Card key={item.dedupeKey} className="border-destructive">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <CardTitle className="text-base">{item.summary}</CardTitle>
                          <Badge variant="destructive">{item.severity}</Badge>
                        </div>
                        <CardDescription className="break-words">{item.dedupeKey}</CardDescription>
                      </CardHeader>
                      <CardContent className="text-sm">
                        Current {item.value}
                        {item.unit === "seconds" ? "s" : ""}; threshold {item.threshold}
                        {item.unit === "seconds" ? "s" : ""}.
                      </CardContent>
                    </Card>
                  ))}
              </div>
              {calendarReport.alerts.every((item) => item.status === "resolved") && (
                <p className="rounded-lg border p-3 text-sm">
                  No calendar condition thresholds are firing in this assessment.
                  {calendarReport.responseRecorder.registered === null &&
                    " Recorder configuration remains unknown; any previous recorder alarm is unassessed."}
                </p>
              )}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="p-3">Owned schedule</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Last dispatch</th>
                      <th className="p-3">Authenticated completion</th>
                      <th className="p-3">Worker outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendarReport.schedules.map((item) => (
                      <tr key={item.schedule_name} className="border-b last:border-0">
                        <td className="p-3">{item.schedule_name}</td>
                        <td className="p-3">{item.status ?? "unknown"}</td>
                        <td className="p-3">{item.last_dispatched_at ?? "none"}</td>
                        <td className="p-3">{item.last_authenticated_completed_at ?? "none"}</td>
                        <td className="p-3">{item.worker_outcome ?? "unverified"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="font-semibold">Outstanding obligations</h3>
              <p className="text-sm text-muted-foreground">
                Paid calendar: {calendarReport.obligations.calendar.count}; oldest{" "}
                {calendarReport.obligations.calendar.oldestPendingAgeSeconds ?? 0}s; blocked{" "}
                {calendarReport.obligations.calendar.blockedCount}; unresolved destination{" "}
                {calendarReport.obligations.calendar.unresolvedDestinationCount}. Booking email:{" "}
                {calendarReport.obligations.notifications.count}; oldest{" "}
                {calendarReport.obligations.notifications.oldestPendingAgeSeconds ?? 0}s; delivery
                review {calendarReport.obligations.notifications.reviewCount}.
              </p>
              <h3 className="font-semibold">Contractor action email</h3>
              <p className="text-sm text-muted-foreground">
                Action required: {calendarReport.actionNotices.action_required_count}; pending:{" "}
                {calendarReport.actionNotices.pending_count}; unresolved delivery review:{" "}
                {calendarReport.actionNotices.review_count}. Provider acceptance does not prove
                inbox delivery. Showing at most {calendarReport.actionNotices.items_limit}{" "}
                connections.
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="p-3">Connection / profile</th>
                      <th className="p-3">Current incident</th>
                      <th className="p-3">Delivery state</th>
                      <th className="p-3">Delivery opened / next attempt</th>
                      <th className="p-3">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendarReport.actionNotices.items.map((item) => (
                      <tr key={item.connection_id} className="border-b last:border-0">
                        <td className="p-3 font-mono">
                          <div>{item.connection_id}</div>
                          <div>{item.profile_id}</div>
                          <div>Notice {item.notice_id}</div>
                        </td>
                        <td className="p-3">
                          <div>
                            {item.current_incident.source}: {item.current_incident.cause}
                          </div>
                          <div>
                            {item.current_incident.closed_at ? "Closed" : "Open"}:{" "}
                            {item.current_incident.id}
                          </div>
                          <div>{item.current_incident.opened_at}</div>
                        </td>
                        <td className="p-3">
                          <div>
                            {item.state}
                            {item.closed_at ? " (original incident closed)" : ""}
                          </div>
                          <div>
                            {item.source}: {item.cause}
                          </div>
                        </td>
                        <td className="p-3">
                          <div>{item.opened_at}</div>
                          <div>{item.next_attempt_at ?? "not scheduled"}</div>
                        </td>
                        <td className="p-3">{item.review_reason ?? "none"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {report && (
          <>
            <section aria-labelledby="active-alerts" className="space-y-3">
              <h2 id="active-alerts" className="text-lg font-semibold">
                Generation alerts
              </h2>
              {firing.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                  No alert thresholds are firing.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {firing.map((alert) => (
                    <Card key={alert.id} className="border-destructive">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <CardTitle className="text-base">{alert.summary}</CardTitle>
                          <Badge variant="destructive">{alert.severity}</Badge>
                        </div>
                        <CardDescription>{alert.dedupeKey}</CardDescription>
                      </CardHeader>
                      <CardContent className="text-sm">
                        Current{" "}
                        {alert.unit === "ratio"
                          ? `${(alert.value * 100).toFixed(1)}%`
                          : `${alert.value}s`}{" "}
                        · threshold{" "}
                        {alert.unit === "ratio"
                          ? `${(alert.threshold * 100).toFixed(1)}%`
                          : `${alert.threshold}s`}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="projections" className="space-y-3">
              <h2 id="projections" className="text-lg font-semibold">
                Liveness projections
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {report.projections.map((item) => (
                  <Card key={item.name}>
                    <CardHeader>
                      <CardTitle className="text-base">{item.name}</CardTitle>
                      <CardDescription>
                        Oldest {item.oldestAgeSeconds == null ? "—" : `${item.oldestAgeSeconds}s`}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <span className="text-3xl font-semibold">{item.count}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section aria-labelledby="slos" className="space-y-3">
              <h2 id="slos" className="text-lg font-semibold">
                24-hour SLO window
              </h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="p-3">Metric</th>
                      <th className="p-3">Current</th>
                      <th className="p-3">Target</th>
                      <th className="p-3">Samples</th>
                      <th className="p-3">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.slos.map((slo) => (
                      <tr key={slo.id} className="border-b last:border-0">
                        <td className="p-3 font-medium">{slo.label}</td>
                        <td className="p-3">{formatValue(slo.value, slo.unit)}</td>
                        <td className="p-3">
                          {slo.comparator === "lte" ? "≤" : "≥"}{" "}
                          {formatValue(slo.threshold, slo.unit)}
                        </td>
                        <td className="p-3">{slo.sampleSize}</td>
                        <td className="p-3">
                          <Badge variant={slo.passing === false ? "destructive" : "secondary"}>
                            {slo.passing == null ? "no data" : slo.passing ? "passing" : "breached"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="failures" className="space-y-3">
              <h2 id="failures" className="text-lg font-semibold">
                Recent attributable failures
              </h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="p-3">When</th>
                      <th className="p-3">Job / trace</th>
                      <th className="p-3">Stage</th>
                      <th className="p-3">Cause</th>
                      <th className="p-3">Effect / disposition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.recentFailures.length === 0 ? (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={5}>
                          No failures in this window.
                        </td>
                      </tr>
                    ) : (
                      report.recentFailures.map((failure) => (
                        <tr
                          key={`${failure.jobId}:${failure.occurredAt}:${failure.cause}`}
                          className="border-b last:border-0"
                        >
                          <td className="p-3">{failure.occurredAt}</td>
                          <td className="p-3 font-mono">
                            <div>{failure.jobId}</div>
                            {failure.traceId && (
                              <Link className="underline" to="/admin/traces">
                                trace {failure.traceId}
                              </Link>
                            )}
                          </td>
                          <td className="p-3">{failure.stage ?? "—"}</td>
                          <td className="p-3">{failure.cause ?? "unknown"}</td>
                          <td className="p-3">
                            {failure.effectCertainty} / {failure.disposition}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
