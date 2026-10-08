import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260905181159_activate_sandbox_saas_offers.sql",
  "utf8",
);

assert.match(migration, /confirmed_at constant timestamptz := timestamptz '2026-09-05T18:11:59Z'/);
assert.doesNotMatch(migration, /clock_timestamp|now\(\)/);
assert.match(
  migration,
  /'test',\s*'starter',\s*'price_1U90KGEjgAPzsVsTmS6lgHnQ',\s*'prod_V9Iw1h1tesmf0h',\s*7900,\s*confirmed_at/,
);
assert.match(
  migration,
  /'test',\s*'pro',\s*'price_1U90KYEjgAPzsVsTLzMO54Sd',\s*'prod_V9IwztC1fi8sqi',\s*12900,\s*confirmed_at/,
);
assert.match(
  migration,
  /rotate_saas_offer_contract\('test', 'starter', starter_contract_id, null::text\)/,
);
assert.match(migration, /rotate_saas_offer_contract\('test', 'pro', pro_contract_id, null::text\)/);
const lockIndex = migration.indexOf("pg_advisory_xact_lock");
const firstInstallIndex = migration.indexOf("install_saas_offer_contract");
assert.ok(
  lockIndex >= 0 && lockIndex < firstInstallIndex,
  "registry lock must precede installation",
);
assert.match(migration, /assert_saas_offer_readiness\('test'\)/);
assert.doesNotMatch(migration, /'live'/);
assert.doesNotMatch(
  migration,
  /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:checkout_sessions|subscriptions|booking_payments|appointments)\b|\b(?:net|http)\.|checkout\.sessions|payment_intents|sk_test_|whsec_/i,
);

console.log("verify-sandbox-saas-offer-activation: exact test routes are narrow and fail closed");
