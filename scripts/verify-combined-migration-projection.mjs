import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const runner = readFileSync(new URL("scripts/test-db-bucket3-local.sh", root), "utf8");
const requiredCanonical = [
  "20260828120000_",
  "20260828121000_",
  "20260828122000_",
  "20260828123000_",
  "20260828160000_",
  "20260828170000_",
  "20260828171000_",
  "20260828173000_",
];
for (const version of requiredCanonical) {
  assert.equal(
    new RegExp("^\\s*" + version, "m").test(runner),
    false,
    version + " canonical generation revision must remain in the clean replay projection",
  );
}
assert.ok(
  runner.includes("20260828172000_*) continue"),
  "the stale local Add Video patch must be skipped",
);
assert.equal(
  runner.includes("20260829093506_*) continue"),
  false,
  "the unique Lovable Add Video compatibility patch must remain selected",
);
for (const alias of [
  "20260829080453_",
  "20260829081231_",
  "20260829092517_",
  "20260829092631_",
  "20260829092714_",
  "20260829093132_",
  "20260829093345_",
  "20260829093820_",
]) {
  assert.ok(runner.includes(alias), alias + " duplicate hosted alias must be projected out");
}
// Keep deployment-data exclusions exact and pinned to reviewed SQL, never a date/UUID wildcard.
for (const [name, digest] of [
  [
    "20260909223245_5ad3e2d5-9ae8-4bee-b91f-9faeb552b684.sql",
    "9864289ea377cc052d4af56cf5ffd0baed17417d25bc7b4e5b6df23cc8995de8",
  ],
  [
    "20260909223840_2e80086c-328c-4a29-810d-43f6ff7105db.sql",
    "b20c43a9ba3aa2e9d475eaf6e038a2a4a0dccab600c6df46866b8daf783e7457",
  ],
]) {
  assert.ok(runner.includes(`${name}) continue ;;`), `${name} must not mutate replay fixtures`);
  assert.equal(
    createHash("sha256")
      .update(readFileSync(new URL(`supabase/migrations/${name}`, root)))
      .digest("hex"),
    digest,
    `${name} changed: reassess the deployment-data exclusion rather than silently skipping it`,
  );
}
assert.match(
  runner,
  /create table auth\.users\([\s\S]*instance_id uuid[\s\S]*email_confirmed_at timestamptz[\s\S]*confirmed_at timestamptz/,
  "replay stub must accept GoTrue-shaped auth.users inserts",
);
assert.match(
  runner,
  /new\.email_confirmed_at := coalesce\(new\.email_confirmed_at, new\.confirmed_at\)/,
  "replay stub must keep confirmed_at and email_confirmed_at aligned",
);
assert.equal(
  runner.includes("20260912184938_1378ad2d-4f6a-4711-a200-eb38206861d3.sql) continue"),
  false,
  "fixed-admin seed is schema-plus-data and must stay in the replay",
);
assert.equal(
  runner.includes("20260912190000_fixed_admin_credentials.sql) continue"),
  false,
  "duplicate fixed-admin seed must stay in the replay",
);
console.log(
  "verify-combined-migration-projection: schema revisions retained; duplicate aliases and reviewed deployment data excluded",
);
