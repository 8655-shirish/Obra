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
const { assertSafeRemoteUrl, safeFetchRemoteMedia } = await import(
  pathToFileURL(path.join(here, "../src/lib/media/safe-remote-media.server.ts")).href
);
await assert.rejects(() => assertSafeRemoteUrl(new URL("http://127.0.0.1/photo.png")), /Unsafe/);
await assert.rejects(
  () =>
    assertSafeRemoteUrl(new URL("https://example.test/photo.png"), async () => ["169.254.169.254"]),
  /Unsafe/,
);
assert.deepEqual(await assertSafeRemoteUrl(new URL("https://www.example.com/images/job.jpg")), []);
const resolveHost = async () => ["93.184.216.34"];
const calls = [];
const fetched = await safeFetchRemoteMedia("https://public.test/start", {
  maxBytes: 8,
  resolveHost,
  fetchImpl: async (url, init) => {
    calls.push([String(url), init.redirect]);
    if (calls.length === 1)
      return new Response(null, { status: 302, headers: { location: "https://cdn.test/photo" } });
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-length": "3" },
    });
  },
});
assert.deepEqual([...fetched.bytes], [1, 2, 3]);
assert.deepEqual(calls, [
  ["https://public.test/start", "manual"],
  ["https://cdn.test/photo", "manual"],
]);
await assert.rejects(
  () =>
    safeFetchRemoteMedia("https://public.test/huge", {
      maxBytes: 2,
      resolveHost,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])),
    }),
  /too large/,
);
await assert.rejects(
  () =>
    safeFetchRemoteMedia("https://public.test/start", {
      maxBytes: 8,
      resolveHost: async (hostname) =>
        hostname === "internal.test" ? ["10.0.0.1"] : ["93.184.216.34"],
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: "http://internal.test/secret" } }),
    }),
  /Unsafe/,
);
console.log("verify-safe-remote-media: ok");
