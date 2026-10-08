import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
const { attestStoredEvidenceImage, isOwnedEvidenceMediaPath } = await import(
  pathToFileURL(path.join(here, "../src/lib/media/persist-scraped-media.server.ts")).href
);

function readDotEnv() {
  if (!fs.existsSync(".env.local")) return {};
  return Object.fromEntries(
    fs
      .readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        const raw = line.slice(at + 1).trim();
        return [line.slice(0, at), raw.replace(/^(["']).*\1$/, (value) => value.slice(1, -1))];
      }),
  );
}

const env = { ...readDotEnv(), ...process.env };
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const apply = false;
if (process.argv.includes("--apply"))
  throw new Error(
    "In-place version backfill is disabled; regenerate drafts through the authoritative media ledger",
  );
const { readBodyLimited } = await import(
  pathToFileURL(path.join(root, "src/lib/media/safe-remote-media.server.ts")).href
);

const supabase = createClient(url, key, { auth: { persistSession: false } });

function ownedPath(websiteId, storagePath) {
  return isOwnedEvidenceMediaPath(websiteId, storagePath);
}

function candidate(item, websiteId) {
  return (
    item &&
    typeof item === "object" &&
    item.origin !== "generated" &&
    item.provenance?.kind !== "generated" &&
    ownedPath(websiteId, item.storagePath)
  );
}

function attestationMatchesBytes(item, attested) {
  return (
    item.mimeType === attested.mimeType &&
    item.contentHash === attested.contentHash &&
    item.width === attested.width &&
    item.height === attested.height &&
    item.aspect === attested.aspect &&
    item.orientation === attested.orientation &&
    item.provenance?.kind === "evidence" &&
    item.provenance.sourceUrl === (item.url || item.storagePath) &&
    item.provenance.storageBucket === "site-media" &&
    item.proofEligible === attested.proofEligible
  );
}

async function backfillRow(row) {
  const enrichment =
    row.enrichment_json && typeof row.enrichment_json === "object" ? row.enrichment_json : {};
  const images = Array.isArray(enrichment.images) ? enrichment.images : [];
  const attestedByIdentity = new Map();
  let failures = 0;
  for (const raw of images) {
    if (!candidate(raw, row.website_id)) continue;
    const { data, error } = await supabase.storage.from("site-media").download(raw.storagePath);
    if (error || !data) {
      failures += 1;
      continue;
    }
    const attested = await attestStoredEvidenceImage({
      websiteId: row.website_id,
      source: { ...raw, url: raw.url || raw.provenance?.sourceUrl || raw.storagePath },
      bytes: await readBodyLimited(
        new Response(data.stream(), { headers: { "content-length": String(data.size) } }),
        50 * 1024 * 1024,
      ),
      mimeType: data.type || raw.mimeType || "image/jpeg",
      storagePath: raw.storagePath,
    });
    if (attested && !attestationMatchesBytes(raw, attested))
      attestedByIdentity.set(`${raw.url}\0${raw.storagePath}`, attested);
    else if (!attested) failures += 1;
  }
  if (attestedByIdentity.size === 0) return { changed: false, failures };
  if (!apply) return { changed: true, failures };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: latest, error: loadError } = await supabase
      .from("contractor_profiles")
      .select("enrichment_json,updated_at")
      .eq("id", row.id)
      .single();
    if (loadError) throw loadError;
    const current =
      latest.enrichment_json && typeof latest.enrichment_json === "object"
        ? latest.enrichment_json
        : {};
    const currentImages = Array.isArray(current.images) ? current.images : [];
    let matched = false;
    const nextImages = currentImages.map((item) => {
      const attested =
        item && typeof item === "object"
          ? attestedByIdentity.get(`${item.url}\0${item.storagePath}`)
          : undefined;
      if (!attested) return item;
      matched = true;
      return { ...item, ...attested };
    });
    if (!matched) return { changed: false, failures };
    const { data: updated, error: updateError } = await supabase
      .from("contractor_profiles")
      .update({ enrichment_json: { ...current, images: nextImages } })
      .eq("id", row.id)
      .eq("updated_at", latest.updated_at)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) return { changed: true, failures };
  }
  throw new Error(`Concurrent enrichment updates prevented backfill for profile ${row.id}`);
}

let scanned = 0;
let changed = 0;
let failed = 0;
async function backfillVersion(row) {
  if (row.status === "live") return { changed: false, failures: 0 };
  const config = row.config_json && typeof row.config_json === "object" ? row.config_json : {};
  const gallery = Array.isArray(config.mediaGallery) ? config.mediaGallery : [];
  const attestedByIdentity = new Map();
  let failures = 0;
  for (const raw of gallery) {
    if (!candidate(raw, row.website_id)) continue;
    const { data, error } = await supabase.storage.from("site-media").download(raw.storagePath);
    if (error || !data) {
      failures += 1;
      continue;
    }
    const attested = await attestStoredEvidenceImage({
      websiteId: row.website_id,
      source: { ...raw, url: raw.url || raw.provenance?.sourceUrl || raw.storagePath },
      bytes: await readBodyLimited(
        new Response(data.stream(), { headers: { "content-length": String(data.size) } }),
        50 * 1024 * 1024,
      ),
      mimeType: data.type || raw.mimeType || "image/jpeg",
      storagePath: raw.storagePath,
    });
    if (attested && !attestationMatchesBytes(raw, attested))
      attestedByIdentity.set(`${raw.url}\0${raw.storagePath}`, attested);
    else if (!attested) failures += 1;
  }
  if (attestedByIdentity.size === 0) return { changed: false, failures };
  if (!apply) return { changed: true, failures };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: latest, error: loadError } = await supabase
      .from("website_versions")
      .select("config_json,revision")
      .eq("id", row.id)
      .single();
    if (loadError) throw loadError;
    const current =
      latest.config_json && typeof latest.config_json === "object" ? latest.config_json : {};
    const currentGallery = Array.isArray(current.mediaGallery) ? current.mediaGallery : [];
    let matched = false;
    const nextGallery = currentGallery.map((item) => {
      const attested =
        item && typeof item === "object"
          ? attestedByIdentity.get(`${item.url}\0${item.storagePath}`)
          : undefined;
      if (!attested) return item;
      matched = true;
      return { ...item, ...attested };
    });
    if (!matched) return { changed: false, failures };
    const { data: updated, error: updateError } = await supabase
      .from("website_versions")
      .update({
        config_json: { ...current, mediaGallery: nextGallery },
        revision: latest.revision + 1,
      })
      .eq("id", row.id)
      .eq("revision", latest.revision)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) return { changed: true, failures };
  }
  throw new Error(`Concurrent config updates prevented backfill for version ${row.id}`);
}

async function scanTable(table, select, processRow) {
  let afterId = "00000000-0000-0000-0000-000000000000";
  while (true) {
    const { data: rows, error } = await supabase
      .from(table)
      .select(select)
      .gt("id", afterId)
      .order("id", { ascending: true })
      .limit(100);
    if (error) throw error;
    if (!rows?.length) break;
    for (const row of rows) {
      scanned += 1;
      const result = await processRow(row);
      if (result.changed) changed += 1;
      failed += result.failures;
    }
    afterId = rows.at(-1).id;
    if (rows.length < 100) break;
  }
}

await scanTable("contractor_profiles", "id,website_id,enrichment_json", backfillRow);
await scanTable("website_versions", "id,website_id,config_json,revision,status", backfillVersion);
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, changed, failed }));
