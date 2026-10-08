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
const { detectImageMimeType, extractImageByteMetadata, validateDecodedImageBytes } = await import(
  pathToFileURL(path.join(here, "../src/lib/media/image-metadata.ts")).href
);

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3,
  0x20, 0, 0, 2, 0x58, 8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
]);
assert.deepEqual(extractImageByteMetadata(png), {
  width: 800,
  height: 600,
  aspect: 4 / 3,
  orientation: "landscape",
});
assert.equal(extractImageByteMetadata(png.subarray(0, 24)), null);

const gif = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 1, 0xe0, 1, 0, 0, 0, 0x2c, 0, 0, 0, 0, 0x40, 1, 0xe0, 1,
  0, 2, 1, 0, 0, 0x3b,
]);
assert.deepEqual(extractImageByteMetadata(gif), {
  width: 320,
  height: 480,
  aspect: 2 / 3,
  orientation: "portrait",
});

const webp = new Uint8Array(30);
webp.set(
  [
    0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0,
    0,
  ],
  0,
);
webp.set([0xff, 0, 0], 24);
webp.set([0xff, 0, 0], 27);
assert.deepEqual(extractImageByteMetadata(webp), {
  width: 256,
  height: 256,
  aspect: 1,
  orientation: "square",
});

const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0, 0x11, 8, 0x02, 0x58, 0x03, 0x20, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 0, 0, 0, 0xff, 0xd9,
]);
assert.deepEqual(extractImageByteMetadata(jpeg), {
  width: 800,
  height: 600,
  aspect: 4 / 3,
  orientation: "landscape",
});
assert.equal(extractImageByteMetadata(jpeg.subarray(0, 21)), null);
const heic = new Uint8Array(40);
heic.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
heic.set([0x69, 0x73, 0x70, 0x65, 0, 0, 0, 0, 0, 0, 3, 0x20, 0, 0, 2, 0x58], 16);
assert.equal(detectImageMimeType(heic), "image/heic");
assert.equal(extractImageByteMetadata(heic), null);
assert.equal(extractImageByteMetadata(new Uint8Array([1, 2, 3])), null);

const { encode } = await import("fast-png");
const validPng = encode({
  width: 2,
  height: 2,
  data: new Uint8Array(16).fill(255),
  depth: 8,
  channels: 4,
});
assert.deepEqual(await validateDecodedImageBytes(validPng), {
  width: 2,
  height: 2,
  aspect: 1,
  orientation: "square",
});
assert.equal(
  await validateDecodedImageBytes(png),
  null,
  "invalid CRC/deflate pseudo-PNG is rejected",
);
assert.equal(await validateDecodedImageBytes(jpeg), null, "invalid JPEG entropy data is rejected");
assert.equal(await validateDecodedImageBytes(webp), null, "header-only WebP is rejected");
console.log("verify-image-metadata: ok");
