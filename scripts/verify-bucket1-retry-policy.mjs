import assert from "node:assert/strict";
import {
  SITE_GENERATION_RETRY_POLICIES as P,
  SITE_GENERATION_RETRY_POLICY_VERSION as V,
  retryDelayMs,
} from "../src/lib/jobs/site-generation-retry-policy.ts";
assert.equal(V, 1);
assert.equal(Object.keys(P).length, 43);
for (const policy of Object.values(P)) {
  assert.equal(policy.version, 1);
  assert.ok(policy.resetRule);
  assert.ok(policy.statusText);
  assert.ok(policy.budget >= 0);
}
assert.equal(P.lease_lost.disposition, "resume");
assert.equal(P.lease_lost.budgetType, "none");
assert.equal(P.provider_indeterminate_acceptance.disposition, "reconcile");
assert.equal(P.overflow.disposition, "writer_repair");
assert.equal(P.provider_auth.disposition, "terminal");
assert.equal(retryDelayMs({ cause: "provider_rate_limit", attempt: 2, retryAfterMs: 5000 }), 5000);
assert.equal(retryDelayMs({ cause: "provider_timeout", attempt: 1, jitterSample: 0.5 }), 1000);
console.log("verify-bucket1-retry-policy: ok");
