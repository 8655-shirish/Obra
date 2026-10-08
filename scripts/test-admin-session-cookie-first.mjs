import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const sessionSource = fs.readFileSync("src/lib/auth/admin-session.server.ts", "utf8");
{
  const reader = sessionSource.slice(sessionSource.indexOf("export async function getAdminSession"));
  const cookie = reader.indexOf("getCookie(ADMIN_SESSION_COOKIE, actualRequest)");
  const missing = reader.indexOf("if (!token) return null");
  const origin = reader.indexOf("assertAdminSameOriginMutation(actualRequest)");
  assert.ok(
    cookie !== -1 && missing !== -1 && origin !== -1 && cookie < missing && missing < origin,
    "cookieless POSTs must not run the admin origin guard",
  );
}

const originalEnv = { ...process.env };
process.env = {
  ...originalEnv,
  PUBLIC_APP_URL: "https://obratech.co",
};

function post(origin, cookie) {
  return new Request("https://preview.example/_serverFn", {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie: `obra_admin_session=${cookie}` } : {}),
    },
  });
}

const rpcCalls = [];
const bundle = await importWithMocks(path.resolve("src/lib/auth/admin-session.server.ts"), {
  "@tanstack/react-start/server": `
    export function getRequest() { throw new Error("getRequest unused when request is passed"); }
    export function setResponseHeader() {}
  `,
  "@/integrations/supabase/client.server": `
    export const supabaseAdmin = {
      rpc(name, args) {
        globalThis.__adminSessionRpc.push({ name, args });
        return Promise.resolve({
          data: [{ session_id: "s1", user_id: "u1", role: "admin", impersonated_profile_id: null }],
          error: null,
        });
      },
    };
  `,
});

globalThis.__adminSessionRpc = rpcCalls;

try {
  const { getAdminSession, getImpersonationProfileId, assertAdminSameOriginMutation } =
    bundle.subject;

  assert.equal(await getAdminSession(post("https://preview.example")), null);
  assert.equal(await getImpersonationProfileId(post("https://www.obratech.co")), undefined);
  assert.equal(rpcCalls.length, 0);

  await assert.rejects(
    () => getAdminSession(post("https://preview.example", "token")),
    { message: "Forbidden: same-origin admin request required" },
  );
  assert.equal(rpcCalls.length, 0);

  assert.throws(
    () => assertAdminSameOriginMutation(post("https://preview.example")),
    { message: "Forbidden: same-origin admin request required" },
  );

  const session = await getAdminSession(post("https://obratech.co", "token"));
  assert.equal(session?.user_id, "u1");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "validate_admin_session_v4");

  console.log(
    "PASS: cookieless POSTs skip the admin origin guard; admin cookies still require PUBLIC_APP_URL",
  );
} finally {
  process.env = originalEnv;
  delete globalThis.__adminSessionRpc;
  await bundle.cleanup();
}
