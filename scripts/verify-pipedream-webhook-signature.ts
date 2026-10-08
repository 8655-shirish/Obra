import { createHmac } from "node:crypto";
import assert from "node:assert/strict";

import { verifyPipedreamSignature } from "../src/lib/pipedream-webhook-signature.server.ts";

const timestamp = 1_800_000_000;
const body = JSON.stringify({ id: "evt-1", payload: { calendar: "primary" } });
const secret = "test-signing-secret";
const signature = createHmac("sha256", secret)
  .update(timestamp + "." + body)
  .digest("hex");
const valid = verifyPipedreamSignature({
  header: `t=${timestamp},v1=${signature}`,
  rawBody: body,
  secret,
  nowMs: timestamp * 1000,
});
assert.deepEqual(valid, { timestamp });
assert.deepEqual(
  verifyPipedreamSignature({
    header: `t=${timestamp},v1=${"0".repeat(64)},v1=${signature}`,
    rawBody: body,
    secret,
    nowMs: timestamp * 1000,
  }),
  { timestamp },
);
assert.equal(
  verifyPipedreamSignature({
    header: `t=${timestamp},v1=${signature}`,
    rawBody: body + " ",
    secret,
    nowMs: timestamp * 1000,
  }),
  null,
);
assert.equal(
  verifyPipedreamSignature({
    header: `t=${timestamp},v1=${signature}`,
    rawBody: body,
    secret,
    nowMs: (timestamp + 301) * 1000,
  }),
  null,
);
assert.equal(
  verifyPipedreamSignature({
    header: "t=bad,v1=" + signature,
    rawBody: body,
    secret,
    nowMs: timestamp * 1000,
  }),
  null,
);
assert.equal(
  verifyPipedreamSignature({
    header: "t=" + timestamp + ",v1=00",
    rawBody: body,
    secret,
    nowMs: timestamp * 1000,
  }),
  null,
);
console.log("verify-pipedream-webhook-signature: ok");
