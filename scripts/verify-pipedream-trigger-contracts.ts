import assert from "node:assert/strict";

import {
  parseConfiguredPipedreamWebhook,
  parsePipedreamDeployedTrigger,
  parsePipedreamTriggerDefinition,
} from "../src/lib/pipedream-trigger-contracts.ts";

assert.deepEqual(
  parsePipedreamTriggerDefinition({
    key: "google_calendar-new-or-updated-event-instant",
    name: "New Created or Updated Event (Instant)",
    version: "0.1.20",
    configurable_props: [{ name: "googleCalendar" }, { name: "calendarIds" }],
  }),
  {
    key: "google_calendar-new-or-updated-event-instant",
    name: "New Created or Updated Event (Instant)",
    version: "0.1.20",
    configurableProps: [{ name: "googleCalendar" }, { name: "calendarIds" }],
  },
);
assert.throws(() => parsePipedreamTriggerDefinition({ key: "x", version: "1" }));
assert.deepEqual(
  parsePipedreamDeployedTrigger({
    id: "dc_123",
    component_id: "sc_123",
    component_key: "google_calendar-new-or-updated-event-instant",
    configured_props: { calendarIds: ["primary"] },
    active: true,
    type: "DeployedComponent",
  }),
  {
    id: "dc_123",
    componentId: "sc_123",
    componentKey: "google_calendar-new-or-updated-event-instant",
    configuredProps: { calendarIds: ["primary"] },
    active: true,
    webhookSigningKey: null,
  },
);
assert.throws(() => parsePipedreamDeployedTrigger({ id: "dc_123", active: true }));
const url = "https://obratech.co/api/pipedream/webhook?binding_id=b";
assert.deepEqual(
  parseConfiguredPipedreamWebhook(
    {
      webhook_urls: [url],
      webhooks: [{ id: "wh_1", url, signing_key: "secret", signing_key_set: true }],
    },
    url,
  ),
  { id: "wh_1", signingKey: "secret" },
);
assert.throws(() =>
  parseConfiguredPipedreamWebhook(
    {
      webhook_urls: ["https://attacker.example"],
      webhooks: [
        {
          id: "wh_1",
          url: "https://attacker.example",
          signing_key: "secret",
          signing_key_set: true,
        },
      ],
    },
    url,
  ),
);
console.log("verify-pipedream-trigger-contracts: ok");
