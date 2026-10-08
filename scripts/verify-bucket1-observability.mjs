import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const contract = read("src/lib/generation-observability.ts");
const collector = read("src/lib/generation-observability.server.ts");
const monitor = read("src/routes/api/cron/generation-monitor.ts");
const runbook = read("docs/runbooks/bucket1-generation.md");
const env = read(".env.example");
const packageJson = JSON.parse(read("package.json"));

for (const projection of [
  "runnable-pending",
  "dependency-blocked",
  "backoff-waiting",
  "stale-running",
  "scheduler-silent",
  "reconciliation-required",
]) {
  assert.ok(contract.includes(projection), `missing projection contract: ${projection}`);
  assert.ok(collector.includes(projection), `missing projection query: ${projection}`);
}

for (const metric of [
  "scheduler-delivery",
  "runnable-queue-age",
  "stale-recovery-age",
  "stage-latency-p95",
  "end-to-end-latency-p95",
  "reconciliation-age",
  "provider-failure-rate",
  "exhaustion-rate",
]) {
  assert.ok(contract.includes(metric), `missing SLO/alert metric: ${metric}`);
}

for (const source of [
  "background_jobs",
  "site_generation_attempt_events",
  "site_generation_media_slots",
  "background_job_cron_health",
]) {
  assert.ok(collector.includes(source), `collector does not query ${source}`);
}

assert.ok(monitor.includes('createFileRoute("/api/cron/generation-monitor")'));
assert.ok(monitor.includes("GENERATION_MONITOR_SECRET"));
assert.ok(monitor.includes("GENERATION_ALERT_WEBHOOK_URL"));
assert.ok(contract.includes('status: input.firing ? "firing" : "resolved"'));
assert.ok(contract.includes("bucket1-generation:${input.id}"));
assert.ok(contract.includes('BUCKET1_ALERT_OWNER = "Generation on-call"'));
assert.ok(contract.includes('BUCKET1_ALERT_CHANNEL = "#obra-generation-oncall"'));

for (const key of [
  "GENERATION_MONITOR_SECRET=",
  "GENERATION_ALERT_WEBHOOK_URL=",
  "GENERATION_ALERT_WEBHOOK_TOKEN=",
]) {
  assert.ok(env.includes(key), `missing env contract: ${key}`);
}

for (const requirement of [
  "must not run from the Supabase pg_cron",
  "bucket1-generation:<alert-id>",
  "Triage queries",
  "Reconciliation required",
  "Resolution:",
  "Forward rollback and escalation",
  "Acceptance drill",
  "two consecutive external monitor evaluations",
]) {
  assert.ok(runbook.includes(requirement), `runbook missing: ${requirement}`);
}

for (const threshold of [
  "> 180 s",
  "< 99%",
  "> 300 s",
  "> 120 s",
  "> 900 s",
  "> 1,800 s",
  "> 3,600 s",
  "> 10%",
  "> 5%",
]) {
  assert.ok(runbook.includes(threshold), `runbook threshold missing: ${threshold}`);
}

assert.ok(
  packageJson.scripts["verify:bucket1-observability"],
  "package verifier script is missing",
);
assert.match(packageJson.scripts["test:bucket1-generation"], /verify:bucket1-observability/);

console.log("verify-bucket1-observability: ok");
