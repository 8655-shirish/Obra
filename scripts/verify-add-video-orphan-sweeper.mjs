import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await fs.mkdtemp(path.join(root, ".verify-orphan-sweeper-"));
const out = path.join(temporary, "sweeper.mjs");
await build({
  entryPoints: [path.join(root, "src/lib/media/add-video-orphan-sweeper.server.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { "@": path.join(root, "src") },
});
const { sweepAddVideoOrphans } = await import(pathToFileURL(out));
const website = "11111111-1111-4111-8111-111111111111";
const old = "2026-08-20T00:00:00.000Z";
const recent = "2026-08-22T13:00:00.000Z";
const bytes = new TextEncoder().encode("crash-before-ledger");
const removed = [];
const referenceChecks = [];
const errors = [];
const makeDeps = () => ({
  async list(prefix) {
    if (!prefix)
      return [
        { name: website, id: null },
        { name: "unowned", id: null },
      ];
    if (prefix === website)
      return [{ name: "1720000000000-deadbeef.png", id: "direct-old", created_at: old }];
    if (prefix === website + "/generated")
      return [
        { name: "aaaaaaaaaaaaaaaa.mp4", id: "old-storage", created_at: old },
        { name: "bbbbbbbbbbbbbbbb.mp4", id: "recent-storage", created_at: recent },
        { name: "ddddddddddddddd.mp4", id: "too-short", created_at: old },
        { name: "eeeeeeeeeeeeeeeee.mp4", id: "noncanonical-17", created_at: old },
        { name: `${"f".repeat(63)}.mp4`, id: "noncanonical-63", created_at: old },
        { name: `${"a".repeat(64)}.mp4`, id: "canonical-64", created_at: recent },
        { name: "AAAAAAAAAAAAAAAA.mp4", id: "uppercase", created_at: old },
        { name: "not-owned.tmp", id: "ignored", created_at: old },
      ];
    return [];
  },
  async download(pathname) {
    assert.ok(
      pathname === website + "/generated/aaaaaaaaaaaaaaaa.mp4" ||
        pathname === website + "/1720000000000-deadbeef.png",
    );
    return bytes;
  },
  async remove(pathname) {
    removed.push(pathname);
  },
  async listLedger() {
    return [
      {
        storage_path: website + "/generated/cccccccccccccccc.mp4",
        content_hash: "ledger-hash",
        oldest_at: old,
      },
    ];
  },
  async isDirectUploadReferenced(pathname) {
    referenceChecks.push([pathname, "direct"]);
    return false;
  },
  async isReferenced(pathname, contentHash) {
    referenceChecks.push([pathname, contentHash]);
    return pathname.endsWith("cccccccccccccccc.mp4");
  },
  log: {
    info() {},
    error(...args) {
      errors.push(args);
    },
  },
});

const dry = await sweepAddVideoOrphans({
  deps: makeDeps(),
  now: new Date("2026-08-23T12:00:00.000Z"),
});
assert.equal(dry.dryRun, true);
assert.equal(dry.eligible, 3);
assert.ok(
  !dry.candidates.some((candidate) =>
    /too-short|noncanonical|uppercase/.test(candidate.storagePath),
  ),
);
assert.equal(dry.referenced, 1);
assert.equal(dry.deleted, 0);
assert.equal(removed.length, 0);
assert.ok(
  referenceChecks.some(
    ([pathname, value]) => pathname.endsWith("aaaaaaaaaaaaaaaa.mp4") && value.length === 64,
  ),
  "storage-only object must be downloaded and hashed",
);
assert.ok(dry.candidates.some((candidate) => candidate.action === "would_delete"));

const live = await sweepAddVideoOrphans({
  deps: makeDeps(),
  dryRun: false,
  minimumAgeMs: 1,
  now: new Date("2026-08-23T12:00:00.000Z"),
});
assert.equal(live.cutoff, "2026-08-22T12:00:00.000Z", "minimum age is clamped to 24 hours");
assert.equal(live.deleted, 2);
assert.equal(removed.length, 2);
assert.equal(live.candidates.filter((candidate) => candidate.action === "deleted").length, 2);

const sql = await fs.readFile(
  path.join(root, "supabase/migrations/20260823120000_add_video_database_foundation.sql"),
  "utf8",
);
assert.match(sql, /site_generation_media_slots_orphan_retention_idx/);
assert.match(sql, /list_add_video_orphan_candidates/);
assert.match(sql, /job.job_type = 'add_video'/);
assert.match(sql, /add_video_storage_object_is_referenced/);
assert.match(
  sql,
  /website_version_media_slots attachment[\s\S]*attachment.storage_path = p_storage_path or attachment.asset_id = p_content_hash/,
);
assert.match(
  sql,
  /revoke all on function public.add_video_storage_object_is_referenced[\s\S]*public, anon, authenticated/,
);
const server = await fs.readFile(path.join(root, "src/server.ts"), "utf8");
assert.match(server, /ADD_VIDEO_ORPHAN_SWEEPER_SECRET/);
assert.match(server, /dryRun: input.dryRun !== false/);
const flags = await fs.readFile(path.join(root, "src/lib/agent/add-video-flags.server.ts"), "utf8");
assert.match(flags, /ADD_VIDEO_ENABLED/);
assert.doesNotMatch(flags, /default.*true/i);
await fs.rm(temporary, { recursive: true, force: true });
console.log("verify-add-video-orphan-sweeper: ok");
