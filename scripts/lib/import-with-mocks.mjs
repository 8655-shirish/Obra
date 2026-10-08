import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

/** Bundle a production entry while replacing only declared external seams. */
export async function importWithMocks(entry, mocks) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "obra-booking-unit-"));
  const mockFiles = new Map();
  for (const [specifier, source] of Object.entries(mocks)) {
    const file = path.join(directory, "mock-" + mockFiles.size + ".mjs");
    await writeFile(file, source);
    mockFiles.set(specifier, file);
  }
  const output = path.join(directory, "subject.mjs");
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: "inline",
    alias: { "@": path.resolve("src") },
    plugins: [
      {
        name: "acceptance-provider-mocks",
        setup(buildApi) {
          buildApi.onResolve({ filter: /.*/ }, (args) => {
            const replacement = mockFiles.get(args.path);
            return replacement ? { path: replacement } : undefined;
          });
        },
      },
    ],
  });
  const subject = await import(
    pathToFileURL(output).href + "?run=" + Date.now() + "-" + Math.random()
  );
  return { subject, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
