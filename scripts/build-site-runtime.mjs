import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const outDir = path.join(root, "public/site-runtime");
const templatePath = path.join(root, "src/site-runtime/host.html");
const TAILWIND_MARK = "<!--SITE_RUNTIME_TAILWIND-->";
const BOOTSTRAP_MARK = "<!--SITE_RUNTIME_BOOTSTRAP-->";

mkdirSync(outDir, { recursive: true });

const tailwindBrowser = path.join(
  root,
  "node_modules/@tailwindcss/browser/dist/index.global.js",
);

const tmpDir = path.join(os.tmpdir(), "obra-site-runtime");
mkdirSync(tmpDir, { recursive: true });
const bootstrapOut = path.join(tmpDir, "bootstrap.js");

await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "src/site-runtime/bootstrap.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: bootstrapOut,
  jsx: "automatic",
  minify: true,
  logLevel: "info",
});

function inlineScript(source) {
  return `<script nonce="obra-site-runtime">${source.replace(/<\/script/gi, "<\\/script")}</script>`;
}

const template = readFileSync(templatePath, "utf8");
if (!template.includes(TAILWIND_MARK) || !template.includes(BOOTSTRAP_MARK)) {
  throw new Error("host.html template missing runtime markers");
}

const html = template
  .replace(TAILWIND_MARK, () => inlineScript(readFileSync(tailwindBrowser, "utf8")))
  .replace(BOOTSTRAP_MARK, () => inlineScript(readFileSync(bootstrapOut, "utf8")));

if (
  /<script[^>]+src=["'](?:bootstrap|tailwind-browser)\.js["']/.test(html) ||
  html.includes(TAILWIND_MARK) ||
  html.includes(BOOTSTRAP_MARK)
) {
  throw new Error("inlined host.html still references external player scripts");
}

writeFileSync(path.join(outDir, "host.html"), html);
for (const leftover of ["bootstrap.js", "tailwind-browser.js"]) {
  rmSync(path.join(outDir, leftover), { force: true });
}

console.log("site-runtime: wrote public/site-runtime/host.html (scripts inlined)");
