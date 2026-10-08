import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const siteConfig = read("src/lib/agent/site-config.server.ts");
const migration = read("supabase/migrations/20260823220000_cross_website_layout_fingerprints.sql");
const types = read("src/integrations/supabase/types.ts");

assert.match(
  siteConfig,
  /const realizedLayoutFingerprint = layoutFingerprint\(configJson\)\.trim\(\);[\s\S]*?const persistedConfigJson = \{[\s\S]*?layoutFingerprint: realizedLayoutFingerprint,[\s\S]*?const rpcResult = mediaSlotIds/,
  "the realized fingerprint is attached immediately before generated-version insertion",
);
assert.match(siteConfig, /p_config_json: persistedConfigJson as Json/g);
assert.equal(
  (siteConfig.match(/p_config_json: persistedConfigJson as Json/g) ?? []).length,
  2,
  "both generated-version insert paths persist the fingerprint",
);
assert.match(
  siteConfig,
  /\.rpc\("list_cross_website_layout_fingerprints", \{[\s\S]*?p_website_id: websiteId,[\s\S]*?p_limit: CROSS_WEBSITE_LAYOUT_SAMPLE_CAP/,
);
assert.doesNotMatch(
  siteConfig,
  /comparisonSites|activeVersionIds|crossWebsitePriors|priorLayoutFingerprints\(crossWebsite/,
);
assert.match(
  siteConfig,
  /const fingerprint = row\.layout_fingerprint\?\.trim\(\);[\s\S]*?return fingerprint \? \[fingerprint\] : \[\];/,
  "only nonempty persisted fingerprints become cross-site hard constraints",
);
assert.match(siteConfig, /\...priorLayoutFingerprints\(storedPriors\)/);
assert.match(siteConfig, /\...crossWebsiteLayoutFingerprints/);

assert.match(
  migration,
  /returns table\(id uuid, version_number integer, layout_fingerprint text\)/i,
);
assert.match(migration, /language sql\s+stable\s+security definer/i);
assert.match(migration, /versions\.config_json->>'layoutFingerprint' as layout_fingerprint/);
assert.match(migration, /versions\.id = sampled_website\.active_version_id/);
assert.match(migration, /versions\.website_id = sampled_website\.id/);
assert.match(migration, /foreign key \(active_version_id, id\)/);
assert.match(migration, /references public\.website_versions \(id, website_id\)/);
assert.match(migration, /not valid/);
assert.match(migration, /order by sampled_website\.updated_at desc, sampled_website\.id desc/i);
assert.match(migration, /limit least\(greatest\(coalesce\(p_limit, 12\), 0\), 12\)/i);
assert.doesNotMatch(migration, /select[\s\S]*?config_json\s*(?:,|from)/i);
assert.match(migration, /where status = 'live' and active_version_id is not null/i);
assert.match(migration, /revoke all on function[\s\S]*?from public, anon, authenticated/i);
assert.match(migration, /grant execute on function[\s\S]*?to service_role/i);

assert.match(
  types,
  /list_cross_website_layout_fingerprints: \{[\s\S]*?Args: \{ p_limit\?: number; p_website_id: string \};[\s\S]*?id: string;[\s\S]*?layout_fingerprint: string \| null;[\s\S]*?version_number: number;/,
);

console.log("verify-cross-website-layout-fingerprints: ok");
