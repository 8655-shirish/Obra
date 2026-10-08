import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

// All requests are mapped to loopback; the fixed dummy bearer never leaves this test.
// curl -L + -H uses the same libcurl FOLLOWLOCATION/HTTPHEADER defaults as stock pg_net.
const received = [];
let destination;
const handler = (req, res) => {
  received.push({
    host: req.headers.host,
    path: req.url,
    auth: req.headers.authorization,
    method: req.method,
  });
  req.resume();
  if (req.url === "/start") res.writeHead(307, { location: destination }).end();
  else res.end("ok");
};
const first = createServer(handler);
const second = createServer(handler);
// Linux cannot reopen Node's socket-backed stdout pipe via /dev/stdout.
// mkdtemp creates a 0700 directory; only the fresh, inert fixture key touches disk.
const tlsDirectory = mkdtempSync(path.join(tmpdir(), "obra-calendar-cron-tls-"));
let secure;
try {
  const keyFile = path.join(tlsDirectory, "key.pem");
  writeFileSync(keyFile, "", { mode: 0o600, flag: "wx" });
  const tls = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=origin.test",
      "-keyout",
      keyFile,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(
    tls.status,
    0,
    `local TLS fixture generation must succeed (status=${tls.status}, signal=${tls.signal ?? "none"}, spawn=${tls.error?.code ?? "none"})\n${(
      tls.stderr ?? ""
    ).replace(/-----BEGIN [^-]+-----[\s\S]*?(?:-----END [^-]+-----|$)/g, "[PEM redacted]")}`,
  );
  secure = createHttpsServer({ key: readFileSync(keyFile), cert: tls.stdout }, handler);
} finally {
  rmSync(tlsDirectory, { recursive: true, force: true });
}
for (const server of [first, second, secure])
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port1 = first.address().port;
const port2 = second.address().port;
const tlsPort = secure.address().port;
function curl(trusted = false, https = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "curl",
      [
        "-q",
        "--silent",
        "--show-error",
        "--noproxy",
        "*",
        "--location",
        "--max-redirs",
        "3",
        "--max-time",
        "3",
        "--resolve",
        `origin.test:${port1}:127.0.0.1`,
        "--resolve",
        `other.test:${port1}:127.0.0.1`,
        "--resolve",
        `origin.test:${port2}:127.0.0.1`,
        "--resolve",
        `origin.test:${tlsPort}:127.0.0.1`,
        "--header",
        "Authorization: Bearer redirect-fixture",
        "--data",
        "{}",
        ...(trusted ? ["--location-trusted"] : []),
        ...(https ? ["--insecure"] : []),
        https ? `https://origin.test:${tlsPort}/start` : `http://origin.test:${port1}/start`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
}
let bundle;
try {
  for (const [target, expected] of [
    [`http://origin.test:${port1}/finish`, "Bearer redirect-fixture"],
    [`http://other.test:${port1}/finish`, undefined],
    [`http://origin.test:${port2}/finish`, undefined],
  ]) {
    received.length = 0;
    destination = target;
    await curl();
    assert.equal(received.length, 2);
    assert.equal(received[0].auth, "Bearer redirect-fixture");
    assert.equal(received[1].auth, expected, "Authorization is stripped on a changed host or port");
  }
  received.length = 0;
  destination = `http://origin.test:${port1}/finish`;
  await curl(false, true);
  assert.equal(received[1].auth, undefined, "HTTPS downgrade must not forward Authorization");
  received.length = 0;
  destination = `http://other.test:${port1}/finish`;
  await curl(true);
  assert.equal(
    received[1].auth,
    "Bearer redirect-fixture",
    "negative control: UNRESTRICTED_AUTH would leak the header",
  );

  bundle = await importWithMocks(path.resolve("src/lib/calendar-cron-auth.server.ts"), {});
  const read = bundle.subject.readCalendarCronRequest;
  const headers = {
    authorization: "Bearer fixture",
    "x-obra-worker-environment": "test",
    "x-obra-cron-schedule": "obra-calendar-test-booking-core",
  };
  const make = (url, body = { family: "core" }, h = headers) =>
    new Request(url, { method: "POST", headers: h, body: JSON.stringify(body) });
  const canonical = "https://obratech.co/api/cron/booking";
  assert.equal(
    (await read(make(canonical), "booking", "fixture")).scheduleName,
    "obra-calendar-test-booking-core",
  );
  for (const request of [
    make("https://evil.example/api/cron/booking"),
    make("https://obra-tech.lovable.app/api/cron/booking"),
    make("http://obratech.co/api/cron/booking"),
    make("https://obratech.co:444/api/cron/booking"),
    make(canonical + "?redirect=1"),
    make(canonical + "/other"),
    make(canonical, { family: "notifications" }),
    make(canonical, { family: "attachment_cleanup" }),
    make(canonical, { family: "core", extra: true }),
    make(canonical, { family: "core" }, { ...headers, "x-obra-worker-environment": "live" }),
  ])
    assert.equal((await read(request, "booking", "fixture")).status, 400);
  assert.equal(
    (
      await read(
        make(canonical, { family: "core" }, { ...headers, authorization: "" }),
        "booking",
        "fixture",
      )
    ).status,
    401,
  );
  console.log(
    "test-calendar-cron-redirects: passed (loopback libcurl host/port/HTTPS downgrade stripping; negative control; canonical identity)",
  );
} finally {
  await Promise.all(
    [first, second, secure].map((server) => new Promise((resolve) => server.close(resolve))),
  );
  if (bundle) await bundle.cleanup();
}
