import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patch = await fs.readFile(
  path.join(root, "src/lib/agent/apply-template-patch.server.ts"),
  "utf8",
);
assert.match(patch, /isOwnedSiteMediaPath\(websiteId, value\)/);
assert.match(patch, /signSiteMediaPath/);
assert.match(patch, /Template media slot is detached/);
assert.match(patch, /Template blog image is detached/);
assert.doesNotMatch(patch, /attestGalleryPatch|TRUSTED_MEDIA_FIELDS|attestStoredEvidenceImage/);
const persist = await fs.readFile(
  path.join(root, "src/lib/media/persist-scraped-media.server.ts"),
  "utf8",
);
assert.match(persist, /safeFetchRemoteMedia/);
assert.match(persist, /isOwnedEvidenceMediaPath/);
assert.match(persist, /validateDecodedImageBytes/);
const evidence = await fs.readFile(path.join(root, "src/lib/site-evidence.ts"), "utf8");
assert.match(evidence, /isProofEligibleStillMimeType/);
assert.ok(evidence.includes("image/png"));
assert.ok(
  !evidence
    .slice(
      evidence.indexOf("PROOF_ELIGIBLE_STILL_MIME_TYPES"),
      evidence.indexOf("PROOF_ELIGIBLE_STILL_MIME_TYPES") + 180,
    )
    .includes("image/heic"),
);
const sweeper = await fs.readFile(
  path.join(root, "src/lib/media/add-video-orphan-sweeper.server.ts"),
  "utf8",
);
assert.match(sweeper, /DIRECT_UPLOAD_FILE/);
assert.match(sweeper, /direct_upload_storage_object_is_referenced/);
console.log("verify-media-security-boundaries: ok");
