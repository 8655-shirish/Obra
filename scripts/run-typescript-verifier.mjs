import path from "node:path";
import { createServer } from "vite";

const verifier = process.argv[2];
if (!verifier) {
  console.error("usage: node scripts/run-typescript-verifier.mjs <verifier.ts>");
  process.exit(2);
}

const server = await createServer({
  configFile: false,
  logLevel: "error",
  resolve: { alias: { "@": path.resolve("src") } },
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  await server.ssrLoadModule(`/${verifier.replace(/^\/+/, "")}`);
} finally {
  await server.close();
}
