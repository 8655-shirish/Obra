import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [
  checkpoint,
  execute,
  siteConfig,
  runtime,
  baseSql,
  hardeningSql,
  generator,
  inputs,
  preferences,
] = await Promise.all([
  read("src/lib/jobs/site-generation-checkpoint.ts"),
  read("src/lib/jobs/execute.server.ts"),
  read("src/lib/agent/site-config.server.ts"),
  read("src/lib/site-validation/bucket1-headless-runtime.server.ts"),
  read("supabase/migrations/20260828120000_bucket1_server_owned_generation.sql"),
  read("supabase/migrations/20260828121000_bucket1_production_durability_hardening.sql"),
  read("src/lib/agent/website-generator.server.ts"),
  read("src/lib/agent/unified-site-agent-inputs.ts"),
  read("src/lib/agent/design-preferences.server.ts"),
]);

assert.match(checkpoint, /sourceMedia: FrozenSourceMediaRow\[\]/);
assert.match(checkpoint, /sourcePresent: policy\.sourcePresent/);
assert.match(checkpoint, /designPreferences\?: DesignPreferences/);
assert.match(checkpoint, /parseDesignPreferences\(raw\.designPreferences\)/);
assert.doesNotMatch(checkpoint, /https:\/\/frozen\.obra\.invalid\/\$\{storagePath/);
assert.doesNotMatch(execute, /jsonEqual\(checkpoint\.input, job\.generation_input_snapshot\)/);
assert.match(execute, /mediaManifest: manifest,\n\s+candidateSourceHash/);
assert.match(execute, /candidateConfig = normalizeWebsiteGenerationCandidate\(candidateConfig\)/);
assert.match(siteConfig, /p_config_json: configJson as Json/);
assert.match(execute, /writerRepairDefects: checkpoint\.defects/);
assert.match(execute, /normalizeDesignPreferences\(\{/);
assert.match(execute, /instruction: ""/);
assert.doesNotMatch(execute, /Generation instruction rejected/);
assert.doesNotMatch(execute, /instruction: checkpoint\.input\.instruction/);
assert.doesNotMatch(execute, /sourceInstructionSha256: sha256\(checkpoint\.input\.instruction\)/);
assert.doesNotMatch(checkpoint, /designPreferences source instruction hash mismatch/);
assert.match(execute, /isInvalidGenerationCheckpointError/);
assert.match(execute, /settleInvalidGenerationCheckpoint/);
assert.match(execute, /overlayStoredEvidenceOnFrozenEnrichment/);
assert.match(execute, /overlayStoragePathByUrl/);
assert.doesNotMatch(execute, /persistFrozenEnrichment/);
assert.doesNotMatch(
  execute,
  /async function executeGenerationContext[\s\S]*?persistScrapedSiteMedia/,
);
assert.match(execute, /sourceEvidenceOnly: false/);
assert.doesNotMatch(
  execute,
  /sourceEvidenceOnly: checkpoint\.input\.generationKind === "regeneration"/,
);
assert.doesNotMatch(
  execute,
  /interrupt_site_generation_epoch[\s\S]{0,400}parseSiteGenerationCheckpoint/,
);
assert.match(execute, /designPreferences: checkpoint\.designPreferences/);
assert.match(execute, /candidateRevision: checkpoint\.candidateRevision/);
assert.match(execute, /nextCheckpoint\(checkpoint, "persistence"/);
assert.doesNotMatch(execute, /createBucket1HeadlessRuntime/);
assert.doesNotMatch(execute, /infrastructure \|\| repairExhausted/);
assert.doesNotMatch(generator, /frozenContext\?\.instruction/);
assert.match(generator, /designPreferences,/);
assert.match(
  generator,
  /no-generated-imagery design preference requires evidence-only media slots/,
);
assert.match(generator, /Required authorized photo \$\{requiredPhotoId\}/);
assert.match(generator, /no-motion design preference was violated/);
assert.match(inputs, /raw acceptance prose is withheld/);
assert.match(inputs, /Normalized designPreferences/);
assert.match(preferences, /bucket1-design-preferences-v1/);
assert.match(preferences, /required_photo_unauthorized/);
assert.match(preferences, /instruction_unsafe/);
assert.ok(generator.includes("WRITER_REPAIR_NOTE_MAX_BYTES = 16 * 1024"));
assert.doesNotMatch(runtime, /props\.enableMotion = false/);
assert.doesNotMatch(runtime, /props\.canSubmitLead = false/);
assert.match(baseSql, /generation_contract_epoch in \(1,2\)/);
assert.match(
  hardeningSql,
  /drop function if exists public\.claim_site_generation_stage\(uuid,text,timestamptz\)/,
);
assert.match(baseSql, /and owner_token = p_owner_token[\s\S]*?select \* into generation_job/);
assert.match(baseSql, /generation_request_hash is distinct from owned_trace\.request_payload_hash/);
assert.match(baseSql, /grant execute on function public\.interrupt_site_generation_epoch/);
assert.match(hardeningSql, /generation_contract_epoch>=2/);
assert.match(hardeningSql, /effect_certainty=p_effect_certainty/);
assert.match(hardeningSql, /effect_certainty='definite_success'/);
assert.match(hardeningSql, /checkpoint->'candidateConfig' is distinct from p_config_json/);
assert.match(hardeningSql, /name='BUCKET1_ATTESTATION_SECRET'/);
assert.match(hardeningSql, /extensions\.hmac/);
assert.match(hardeningSql, /candidateConfigHash' is distinct from public\.bucket1_canonical_hash/);
assert.match(hardeningSql, /values\(p_website_id,next_number,p_config_json,new_variant_key/);
assert.match(hardeningSql, /status in \('running','completed'\)/);
assert.match(hardeningSql, /p_budget_type='writer_repair' and current_job\.repair_attempts\+1>=3/);
assert.match(hardeningSql, /generation_terminal_message_payload=case when p_status='failed'/);
assert.match(baseSql, /'kind','site-generation-terminal','status','cancelled'/);
console.log("verify-bucket1-cross-layer: ok");
