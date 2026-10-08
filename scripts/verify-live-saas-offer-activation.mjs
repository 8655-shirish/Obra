import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260904141500_activate_live_saas_offers.sql",
  "utf8",
);

assert.match(migration, /confirmed_at constant timestamptz := timestamptz '2026-09-04T14:15:42Z'/);
assert.doesNotMatch(migration, /clock_timestamp|now\(\)/);
assert.match(migration, /'live',\s*'starter',\s*'price_1UBv1wEjgAPzsVsT16jTWfoX',\s*'prod_VCJf9cb38DrMux',\s*7900,\s*confirmed_at/);
assert.match(migration, /'live',\s*'pro',\s*'price_1UBv4REjgAPzsVsTgJaCJbzu',\s*'prod_VCJhFaSe0Jrofq',\s*12900,\s*confirmed_at/);
assert.match(migration, /rotate_saas_offer_contract\('live', 'starter', starter_contract_id, null::text\)/);
assert.match(migration, /rotate_saas_offer_contract\('live', 'pro', pro_contract_id, null::text\)/);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*?'saas-offer-registry-write-v2'/);
assert.match(migration, /assert_saas_offer_readiness\('live'\)/);
assert.doesNotMatch(migration, /checkout\.sessions|payment_intents/i);
console.log("verify-live-saas-offer-activation: exact initial live routes are narrow and fail closed");
