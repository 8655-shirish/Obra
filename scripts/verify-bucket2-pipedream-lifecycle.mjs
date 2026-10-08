import fs from "node:fs";
const files = [
  "src/lib/pipedream.server.ts",
  "src/routes/api/pipedream/webhook.ts",
  "src/lib/pipedream-webhook-signature.server.ts",
  "src/lib/pipedream-inbox-worker.server.ts",
  "src/lib/pipedream-trigger-reconciliation.server.ts",
  "src/lib/booking-provider.functions.ts",
  "src/lib/booking-readiness.server.ts",
  "supabase/migrations/20260829093910_pipedream_trigger_lifecycle.sql",
  "src/routes/api/cron/pipedream-inbox.ts",
  "supabase/migrations/20260829093909_pipedream_calendar_ingress.sql",
  ".env.example",
];
const text = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const required = [
  "AbortController",
  "x-pd-signature",
  'timestampText + "." + input.rawBody',
  "timingSafeEqual",
  "resolve_pipedream_trigger_signing_key",
  "vault.create_secret",
  "vault.update_secret",
  "configurePipedreamTriggerWebhook",
  "verifyGoogleCalendarFreeBusy",
  'url.hostname !== "pipedream.com"',
  "{ attempts: 1 }",
  "payload_redacted",
  "google_calendar-new-or-updated-event-instant",
  "emit_on_deploy: false",
  "reconcileDuePipedreamTriggers",
  "reserve_pipedream_trigger_deployment",
  "deployment_operation_id",
  "complete_pipedream_stale_trigger_cleanup",
  "claim_due_pipedream_bindings",
  "reconciliation_fencing_token",
  "fail_pipedream_binding_reconciliation",
  "calendar_connection_invalidate_pipedream_binding",
  "binding.data.connection_id === currentConnection.id",
  "ingest_pipedream_calendar_event",
  "pipedream_binding_id",
  "webhook_correlation_id=p_correlation_id",
  "apply_pipedream_calendar_event",
  "processPipedreamCalendarInbox",
  "deletePipedreamAccount",
  '"/accounts/"',
  "reserve_booking_provider_account_disconnect_v3",
  "complete_booking_provider_account_disconnect_v3",
  "PIPEDREAM_INBOX_CRON_SECRET",
];
const missing = required.filter((x) => !text.includes(x));
// Check replacement authorities at their current owners, not retired SQL bodies.
for (const [file, fragments] of [
  [
    "src/lib/pipedream.server.ts",
    [
      "error.status !== 401",
      'error.layer === "google"',
      "if (cachedToken?.value === token) cachedToken = null",
      "token = await accessToken({ attempts: options.attempts });",
      "remainingBudget(operation);",
      "error.requestOperation = operation;",
    ],
  ],
  [
    "src/lib/pipedream-trigger-reconciliation.server.ts",
    [
      "triggerMatches(observed, binding)",
      "observedVersion(observed, pinned, binding.deployment_receipt) === binding.component_version",
      "trigger.componentId === definition.id",
      "definition.key === pinned?.key",
      "receipt?.trigger_id === trigger.id && receipt.operation_id",
      "id: receipt.component_id, key: receipt.component_key, version: receipt.component_version",
      "...(deploymentResponse ? { p_component_id: observed.componentId } : {})",
      "authProvisionId === binding.pipedream_account_id",
      "calendars.length === binding.selected_calendar_ids.length",
      "new Set(calendars).size === calendars.length",
      "binding.selected_calendar_ids.includes(id)",
      '"fail_pipedream_binding_reconciliation"',
      "p_deployment_definitely_rejected: deploymentDefinitelyRejected",
      "p_fencing_token: binding.reconciliation_fencing_token",
    ],
  ],
  [
    "supabase/migrations/20260910120000_google_calendar_lifetime.sql",
    [
      "drop function public.fail_pipedream_trigger_deployment(uuid,uuid,text)",
      "create function public.fail_pipedream_binding_reconciliation(",
      "b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token,false,true)",
      "b.reconciliation_lease_token is distinct from p_lease_token",
      "b.reconciliation_fencing_token is distinct from p_fencing_token",
      "b.reconciliation_lease_expires_at<=pg_catalog.clock_timestamp()",
      "deployment_dispatched_at=case when p_deployment_definitely_rejected",
      "x.deployment_dispatch_lease_token=p_lease_token and x.deployment_dispatch_fencing_token=p_fencing_token",
      "create function public.apply_pipedream_trigger_projection(",
      "b.configuration_revision is distinct from p_expected_connection_revision",
      "p_observed_component_key is distinct from p_component_key or p_observed_component_version is distinct from p_component_version",
      "create function public.adopt_pipedream_trigger_candidate(",
      "p_component_id text default null",
      "b.deployment_dispatch_lease_token is distinct from p_lease_token",
      "b.deployment_dispatch_fencing_token is distinct from p_fencing_token",
      "b.deployment_receipt is not null and b.deployment_receipt is distinct from jsonb_build_object(",
      "deployment_receipt=case when p_component_id is null then deployment_receipt else jsonb_build_object(",
      "'trigger_id',p_deployed_trigger_id,'component_id',p_component_id,'component_key',b.component_key",
      "'component_version',b.component_version,'operation_id',p_deployment_operation_id",
    ],
  ],
]) {
  const source = fs.readFileSync(file, "utf8");
  for (const fragment of fragments)
    if (!source.includes(fragment)) missing.push(file + ": " + fragment);
}
if (missing.length) {
  console.error(missing);
  process.exit(1);
}
console.log("verify-bucket2-pipedream-lifecycle: passed");
