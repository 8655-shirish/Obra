import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import Stripe from "stripe";

import {
  UNPARSED_WEBHOOK_CONTENT_TYPE,
  isRawBodyWebhookPath,
  withUnparsedWebhookBody,
} from "../src/lib/webhook-raw-body.server.ts";

const originalJson = '{ "id": "evt_1", "type": "checkout.session.completed" }';
const reserialized = JSON.stringify(JSON.parse(originalJson));
assert.notEqual(originalJson, reserialized, "h3 JSON parse/stringify is a different byte string");

assert.equal(isRawBodyWebhookPath("/api/stripe/webhook"), true);
assert.equal(isRawBodyWebhookPath("/api/stripe/webhook/"), true);
assert.equal(isRawBodyWebhookPath("/api/stripe/connect-webhook/"), true);
assert.equal(isRawBodyWebhookPath("/api/pipedream/webhook/"), true);
assert.equal(isRawBodyWebhookPath("/api/checkout/begin"), false);

const signature = "t=1900000000,v1=signed";
const incoming = new Request("https://example.test/api/stripe/webhook/", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "stripe-signature": signature,
  },
  body: originalJson,
});
const rewritten = await withUnparsedWebhookBody(incoming);
assert.equal(rewritten.headers.get("content-type"), UNPARSED_WEBHOOK_CONTENT_TYPE);
assert.equal(rewritten.headers.get("stripe-signature"), signature);
const ownedBody = await rewritten.text();
assert.equal(ownedBody, originalJson);
assert.notEqual(ownedBody, reserialized);

const secret = "whsec_test";
const hmacOverOwned = createHmac("sha256", secret).update(ownedBody).digest("hex");
const hmacOverWire = createHmac("sha256", secret).update(originalJson).digest("hex");
const hmacOverParsed = createHmac("sha256", secret).update(reserialized).digest("hex");
assert.equal(hmacOverOwned, hmacOverWire);
assert.notEqual(hmacOverOwned, hmacOverParsed);

const pipedream = await withUnparsedWebhookBody(
  new Request("https://example.test/api/pipedream/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-pd-signature": "t=1,v1=abc" },
    body: originalJson,
  }),
);
assert.equal(pipedream.headers.get("content-type"), UNPARSED_WEBHOOK_CONTENT_TYPE);
assert.equal(pipedream.headers.get("x-pd-signature"), "t=1,v1=abc");
assert.equal(await pipedream.text(), originalJson);

const other = new Request("https://example.test/api/checkout/begin", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: originalJson,
});
const untouched = await withUnparsedWebhookBody(other);
assert.equal(untouched, other);
assert.equal(untouched.headers.get("content-type"), "application/json");
assert.equal(await untouched.text(), originalJson);

const getWebhook = new Request("https://example.test/api/stripe/webhook", { method: "GET" });
assert.equal(await withUnparsedWebhookBody(getWebhook), getWebhook);

const forbidden = ["__stripeRawBodyCache", "x-stripe-raw-body-id", "readStripeRawBody"];
const sources = {
  "src/server.ts": readFileSync("src/server.ts", "utf8"),
  "src/lib/webhook-raw-body.server.ts": readFileSync("src/lib/webhook-raw-body.server.ts", "utf8"),
  "src/routes/api/stripe/webhook.ts": readFileSync("src/routes/api/stripe/webhook.ts", "utf8"),
  "src/routes/api/stripe/connect-webhook.ts": readFileSync(
    "src/routes/api/stripe/connect-webhook.ts",
    "utf8",
  ),
  "src/routes/api/pipedream/webhook.ts": readFileSync("src/routes/api/pipedream/webhook.ts", "utf8"),
};
for (const [path, source] of Object.entries(sources)) {
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `${path} still contains ${token}`);
  }
}

assert.match(sources["src/server.ts"], /request = await withUnparsedWebhookBody\(request\)/);
assert.match(
  sources["src/server.ts"],
  /request = await withUnparsedWebhookBody\(request\);[\s\S]*getServerEntry\(\)/,
);
for (const path of [
  "src/routes/api/stripe/webhook.ts",
  "src/routes/api/stripe/connect-webhook.ts",
  "src/routes/api/pipedream/webhook.ts",
] as const) {
  assert.match(sources[path], /const rawBody = await request\.text\(\)/);
}

const stripeServer = readFileSync("src/lib/stripe.server.ts", "utf8");
assert.match(stripeServer, /constructEventAsync/);
assert.match(stripeServer, /createSubtleCryptoProvider/);
assert.equal(stripeServer.includes("webhooks.constructEvent("), false);
for (const path of [
  "src/routes/api/stripe/webhook.ts",
  "src/routes/api/stripe/connect-webhook.ts",
] as const) {
  assert.match(sources[path], /await constructStripeWebhookEvent\(/);
  assert.equal(sources[path].includes("webhooks.constructEvent("), false);
}

const stripe = new Stripe("sk_test_placeholder", { apiVersion: "2026-08-26.dahlia" });
const subtle = Stripe.createSubtleCryptoProvider();
const signedBody = '{"id":"evt_1","object":"event"}';
const signingSecret = "whsec_test";
const timestamp = Math.floor(Date.now() / 1000);
const hmac = createHmac("sha256", signingSecret)
  .update(`${timestamp}.${signedBody}`)
  .digest("hex");
const header = `t=${timestamp},v1=${hmac}`;
assert.throws(
  () => stripe.webhooks.constructEvent(signedBody, header, signingSecret, undefined, subtle),
  (error: unknown) =>
    error instanceof Error &&
    error.message.includes("SubtleCryptoProvider cannot be used in a synchronous context"),
);
const verified = await stripe.webhooks.constructEventAsync(
  signedBody,
  header,
  signingSecret,
  undefined,
  subtle,
);
assert.equal(verified.id, "evt_1");

console.log("verify-webhook-raw-body: one owner of signed webhook bytes");
