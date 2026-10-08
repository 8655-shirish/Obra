import assert from "node:assert/strict";

import {
  BUCKET1_ALERT_CHANNEL,
  BUCKET1_ALERT_OWNER,
  BUCKET1_SLO_THRESHOLDS,
  deliverGenerationAlertStates,
  evaluateGenerationAlerts,
} from "../src/lib/generation-observability.ts";

const observedAt = "2026-01-01T00:00:00.000Z";
const healthy = evaluateGenerationAlerts({
  observedAt,
  schedulerSilenceSeconds: 60,
  schedulerDeliveryRate: 1,
  schedulerSamples: 20,
  runnableQueueAgeSeconds: 30,
  staleRecoveryAgeSeconds: 0,
  stageLatencyP95Seconds: 100,
  endToEndLatencyP95Seconds: 200,
  reconciliationAgeSeconds: 0,
  reconciliationEndToEndSeconds: 0,
  providerFailureRate: 0,
  providerSamples: 20,
  exhaustionRate: 0,
  exhaustionSamples: 20,
});
assert.equal(healthy.length, 10);
assert.ok(healthy.every((alert) => alert.status === "resolved"));

const firing = evaluateGenerationAlerts({
  observedAt,
  schedulerSilenceSeconds: BUCKET1_SLO_THRESHOLDS.schedulerSilenceSeconds + 1,
  schedulerDeliveryRate: BUCKET1_SLO_THRESHOLDS.schedulerDeliveryRate - 0.01,
  schedulerSamples: 20,
  runnableQueueAgeSeconds: BUCKET1_SLO_THRESHOLDS.runnableQueueAgeSeconds + 1,
  staleRecoveryAgeSeconds: BUCKET1_SLO_THRESHOLDS.staleRecoveryAgeSeconds + 1,
  stageLatencyP95Seconds: BUCKET1_SLO_THRESHOLDS.stageLatencyP95Seconds + 1,
  endToEndLatencyP95Seconds: BUCKET1_SLO_THRESHOLDS.endToEndLatencyP95Seconds + 1,
  reconciliationAgeSeconds: BUCKET1_SLO_THRESHOLDS.reconciliationAgeSeconds + 1,
  reconciliationEndToEndSeconds: BUCKET1_SLO_THRESHOLDS.reconciliationEndToEndSeconds + 1,
  providerFailureRate: BUCKET1_SLO_THRESHOLDS.providerFailureRate + 0.01,
  providerSamples: 20,
  exhaustionRate: BUCKET1_SLO_THRESHOLDS.exhaustionRate + 0.01,
  exhaustionSamples: 20,
});
assert.ok(firing.every((alert) => alert.status === "firing"));
assert.ok(firing.every((alert) => alert.owner === BUCKET1_ALERT_OWNER));
assert.ok(firing.every((alert) => alert.channel === BUCKET1_ALERT_CHANNEL));
assert.equal(new Set(firing.map((alert) => alert.dedupeKey)).size, firing.length);

const delivered = [];
const result = await deliverGenerationAlertStates({
  webhookUrl: "https://alerts.invalid/bucket1",
  webhookToken: "test-token",
  alerts: [...firing, ...healthy],
  fetchImpl: async (input, init) => {
    delivered.push({ input, init });
    return new Response(null, { status: 204 });
  },
});
assert.deepEqual(result, { delivered: 20, destination: BUCKET1_ALERT_CHANNEL });
assert.equal(delivered.length, 1);
assert.equal(delivered[0].init.headers.authorization, "Bearer test-token");
const payload = JSON.parse(delivered[0].init.body);
assert.equal(payload.source, "obra.bucket1.generation");
assert.equal(payload.alerts.filter((alert) => alert.status === "firing").length, 10);
assert.equal(payload.alerts.filter((alert) => alert.status === "resolved").length, 10);

console.log("verify-bucket1-alerts: ok");
