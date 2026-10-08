import { createFileRoute } from "@tanstack/react-router";

import {
  deliverGenerationAlertStates,
  type GenerationAlertState,
} from "@/lib/generation-observability";

function authorized(request: Request) {
  const expected = process.env.GENERATION_MONITOR_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

async function generationAssessment() {
  const webhookUrl = process.env.GENERATION_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    return Response.json({ error: "GENERATION_ALERT_WEBHOOK_URL not configured" }, { status: 503 });
  }

  try {
    const [{ supabaseAdmin }, { collectGenerationObservability }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/generation-observability.server"),
    ]);
    const report = await collectGenerationObservability(supabaseAdmin);
    const alerts: GenerationAlertState[] = report.alerts;
    const delivery = await deliverGenerationAlertStates({
      webhookUrl,
      webhookToken: process.env.GENERATION_ALERT_WEBHOOK_TOKEN,
      alerts,
    });
    return Response.json({ observedAt: report.observedAt, ...delivery, alerts });
  } catch {
    console.error("[generation-monitor] failed");
    return Response.json({ error: "Generation monitor failed" }, { status: 500 });
  }
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Calendar configuration, health or delivery cannot prevent generation assessment.
  // Without an explicit calendar opt-in, preserve the shipped response and behavior.
  const generation = generationAssessment();
  const flag = process.env.CALENDAR_MONITOR_ENABLED;
  if (!flag || flag === "false") return generation;
  const calendar = (async () => {
    try {
      const [{ supabaseAdmin }, { runCalendarMonitor }] = await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("@/lib/calendar-observability.server"),
      ]);
      return await runCalendarMonitor(supabaseAdmin);
    } catch {
      return { outcome: "failed", error: "Calendar monitor failed; assessment is unknown" };
    }
  })();
  const [generationResponse, calendarResult] = await Promise.all([generation, calendar]);
  return Response.json(
    { ...(await generationResponse.json()), calendar: calendarResult },
    {
      status: !generationResponse.ok
        ? generationResponse.status
        : calendarResult.outcome === "succeeded"
          ? 200
          : 503,
    },
  );
}

export const Route = createFileRoute("/api/cron/generation-monitor")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
