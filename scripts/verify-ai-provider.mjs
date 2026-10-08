import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const originalFetch = globalThis.fetch;
const originalEnv = {
  key: process.env.AI_API_KEY,
  baseUrl: process.env.AI_BASE_URL,
  model: process.env.AI_MODEL,
  legacyUrl: process.env.LOVABLE_AI_GATEWAY_URL,
  legacyModel: process.env.LOVABLE_AI_MODEL,
};

try {
  process.env.AI_API_KEY = "test-token";
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.LOVABLE_AI_GATEWAY_URL;
  delete process.env.LOVABLE_AI_MODEL;

  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  const { streamChatCompletion } = await import(
    pathToFileURL(path.join(here, "../src/lib/agent/lovable-ai.server.ts")).href
  );
  const tokens = [];
  const result = await streamChatCompletion({ messages: [{ role: "user", content: "hello" }], onToken: (token) => tokens.push(token) });

  assert.equal(request.url, "https://consilium.workday.lovable.app/api/public/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.equal(request.init.headers["Lovable-API-Key"], undefined);
  assert.equal(JSON.parse(request.init.body).model, "openai/gpt-5.6-sol");
  assert.equal(result.content, "ok");
  assert.deepEqual(tokens, ["ok"]);
  console.log("verify-ai-provider: ok");
} finally {
  globalThis.fetch = originalFetch;
  const restore = (name, value) => value == null ? delete process.env[name] : process.env[name] = value;
  restore("AI_API_KEY", originalEnv.key);
  restore("AI_BASE_URL", originalEnv.baseUrl);
  restore("AI_MODEL", originalEnv.model);
  restore("LOVABLE_AI_GATEWAY_URL", originalEnv.legacyUrl);
  restore("LOVABLE_AI_MODEL", originalEnv.legacyModel);
}
