import assert from "node:assert/strict";
import path from "node:path";

import { importWithMocks } from "./lib/import-with-mocks.mjs";

const bundle = await importWithMocks(path.resolve("src/lib/provider-authorization.ts"), {});
const policy = bundle.subject;

try {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  const active = {
    plan: "pro",
    state: "active",
    order_confirmed_at: "2026-08-01T00:00:00.000Z",
    effective_at: "2026-08-01T00:00:00.000Z",
    ends_at: null,
  };

  assert.equal(policy.isCurrentActiveConfirmedPro(active, now), true);
  assert.equal(policy.isCurrentActiveConfirmedPro({ ...active, state: "grace" }, now), true);
  assert.equal(policy.isCurrentActiveConfirmedPro({ ...active, plan: "starter" }, now), false);
  assert.equal(policy.isCurrentActiveConfirmedPro({ ...active, state: "cancelled" }, now), false);
  assert.equal(policy.isCurrentActiveConfirmedPro({ ...active, order_confirmed_at: null }, now), false);
  assert.equal(
    policy.isCurrentActiveConfirmedPro(
      { ...active, effective_at: "2026-09-02T00:00:00.000Z" },
      now,
    ),
    false,
  );
  assert.equal(
    policy.isCurrentActiveConfirmedPro(
      { ...active, ends_at: "2026-09-01T12:00:00.000Z" },
      now,
    ),
    false,
  );
  assert.equal(policy.isCurrentActiveConfirmedPro({ ...active, ends_at: "not-a-date" }, now), false);

  assert.equal(policy.isSharedProviderDisconnectEnabled(undefined), false);
  assert.equal(policy.isSharedProviderDisconnectEnabled("false"), false);
  assert.equal(policy.isSharedProviderDisconnectEnabled("TRUE"), false);
  assert.equal(policy.isSharedProviderDisconnectEnabled("true"), true);

  console.log("test-provider-authorization: passed");
} finally {
  await bundle.cleanup();
}
