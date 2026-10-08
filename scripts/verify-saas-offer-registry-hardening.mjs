import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(
  "supabase/migrations/20260904120000_harden_repo_migration_runner.sql",
  "utf8",
);
const registry = readFileSync(
  "supabase/migrations/20260904125000_harden_saas_offer_registry_writes.sql",
  "utf8",
);
const recovery = readFileSync("supabase/tests/saas-checkout-fulfillment-recovery.sql", "utf8");

assert.match(
  runner,
  /if p_mode not in \('dry_run', 'apply'\)[\s\S]*?pg_advisory_xact_lock\([\s\S]*?'repo-migration-runner-v2'[\s\S]*?select \* into v_existing/s,
  "runner must validate input, lock, then read the ledger",
);
assert.match(
  registry,
  /create or replace function public\.install_saas_offer_contract[\s\S]*?pg_advisory_xact_lock[\s\S]*?'saas-offer-registry-write-v2'[\s\S]*?on conflict do nothing[\s\S]*?v_contract\.verified_at is distinct from p_verified_at/s,
  "installation must serialize writers, converge all unique constraints, and preserve provenance",
);
assert.match(
  registry,
  /create or replace function public\.rotate_saas_offer_contract\([\s\S]*?p_expected_current_price_id text[\s\S]*?'saas-offer-registry-write-v2'[\s\S]*?'saas-offer-route-v1:'[\s\S]*?v_current_price_id is distinct from p_expected_current_price_id/s,
  "rotation must acquire locks in order and compare-and-swap the predecessor route",
);
assert.match(
  registry,
  /offer contract has no matching audit installation/,
  "rotation must require installation audit evidence",
);
assert.match(registry, /drop function public\.rotate_saas_offer_contract\(text, text, uuid\)/);
assert.match(recovery, /stale offer rotation was accepted/);
assert.match(recovery, /conflicting observation timestamp was accepted/);

console.log("verify-saas-offer-registry-hardening: serialized, provenance-bound CAS contracts pass");
