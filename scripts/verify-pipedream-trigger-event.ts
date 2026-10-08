import assert from "node:assert/strict";

import { parsePipedreamTriggerEvent } from "../src/lib/pipedream-trigger-event.ts";

const now = Date.parse("2027-01-01T00:00:00.000Z");
assert.deepEqual(
  parsePipedreamTriggerEvent({ id: "evt-1", k: "emit", ts: now, e: { id: "google-event" } }, now),
  {
    id: "evt-1",
    type: "emit",
    occurredAt: "2027-01-01T00:00:00.000Z",
    payload: { id: "google-event" },
  },
);
for (const invalid of [
  null,
  { id: "", k: "emit", ts: now, e: {} },
  { id: "evt", k: "other", ts: now, e: {} },
  { id: "evt", k: "emit", ts: now + 300_001, e: {} },
  { id: "evt", k: "emit", ts: now, e: [] },
])
  assert.throws(() => parsePipedreamTriggerEvent(invalid, now));
console.log("verify-pipedream-trigger-event: ok");
