import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(
  path.join(here, "../supabase/migrations/20260823120000_add_video_database_foundation.sql"),
  "utf8",
);
const currentAdmission = fs.readFileSync(
  path.join(here, "../supabase/migrations/20260828122000_bucket1_add_video_v4_admission.sql"),
  "utf8",
);
const applyTemplatePatch = fs.readFileSync(
  path.join(here, "../src/lib/agent/apply-template-patch.server.ts"),
  "utf8",
);
const types = fs.readFileSync(path.join(here, "../src/integrations/supabase/types.ts"), "utf8");
const finalizer = sql.match(
  /create or replace function public\.commit_add_video_to_version[\s\S]*?^\$\$;/m,
)?.[0];
assert.ok(finalizer, "commit_add_video_to_version must exist");
assert.match(sql, /job_type in \('enrichment_platform', 'site_generation', 'add_video'\)/);
assert.match(sql, /foreign key \(source_version_id, website_id\)[\s\S]*on delete restrict/);
assert.match(
  sql,
  /create unique index background_jobs_add_video_request_uk[\s\S]*\(website_id, source_version_id, request_id\)[\s\S]*where job_type = 'add_video'/,
);
assert.match(sql, /background_jobs_one_active_add_video_source_uk/);
assert.match(sql, /background_jobs_one_active_add_video_target_uk[\s\S]*target_version_id/);
assert.match(sql, /Cannot prove proof eligibility for historical proof attachments/);
assert.match(sql, /add column revision bigint not null default 0/);
assert.match(sql, /add column proof_eligible boolean/);
assert.match(sql, /provider_create_count between 0 and 2/);
assert.match(sql, /job_type not in \('site_generation', 'add_video'\)/);
assert.match(sql, /create or replace function public\.enqueue_add_video_job/);
assert.match(sql, /create or replace function public\.cancel_add_video_job/);
assert.match(sql, /create or replace function public\.update_website_version_config_atomic/);
assert.match(finalizer, /security definer set search_path = public/);
assert.match(finalizer, /where id = p_job_id for update/);
assert.match(finalizer, /job_type <> 'add_video'/);
assert.match(finalizer, /payload_json->>'expectedRevision'.*p_expected_revision::text/);
assert.match(
  finalizer,
  /status = 'completed'[\s\S]*candidateHash[\s\S]*return claimed_job\.result_json/,
);
assert.match(finalizer, /candidate hash idempotency conflict/);
assert.match(
  finalizer,
  /status in \('failed', 'cancelled'\)[\s\S]*return coalesce\(claimed_job\.result_json/,
);
assert.match(finalizer, /status <> 'running'.*attempts <> p_job_attempts/);
assert.match(finalizer, /where id = p_target_version_id and website_id = p_website_id for update/);
assert.match(finalizer, /target_version\.revision <> p_expected_revision/);
assert.match(finalizer, /where id = p_media_slot_id for update/);
assert.match(finalizer, /status <> 'ready'.*claim_attempt <> p_job_attempts/);
assert.match(finalizer, /byte_size not between 1 and 12582912/);
assert.match(finalizer, /duration_ms not between 3000 and 5000/);
assert.match(finalizer, /source_slot_id <> media_slot\.poster_slot_id/);
assert.match(finalizer, /slot_id = media_slot\.slot_id or asset_id = media_slot\.asset_id/);
assert.match(finalizer, /Candidate manifest does not exactly match the attachment snapshot/);
assert.match(finalizer, /insert into public\.website_version_media_slots/);
assert.match(finalizer, /revision = revision \+ 1/);
assert.match(finalizer, /insert into public\.website_edit_events/);
assert.match(finalizer, /status = 'attached'/);
assert.match(finalizer, /status = 'completed', progress_pct = 100/);
assert.match(finalizer, /'selectedSectionType'.*'slotId'.*'candidateHash'/s);
assert.ok(
  finalizer.indexOf("insert into public.website_version_media_slots") <
    finalizer.indexOf("update public.website_versions set config_json") &&
    finalizer.indexOf("update public.website_versions set config_json") <
      finalizer.indexOf("insert into public.website_edit_events") &&
    finalizer.indexOf("insert into public.website_edit_events") <
      finalizer.indexOf("update public.site_generation_media_slots set status = 'attached'") &&
    finalizer.indexOf("update public.site_generation_media_slots set status = 'attached'") <
      finalizer.indexOf("update public.background_jobs set status = 'completed'"),
  "finalizer writes must remain in the specified atomic order",
);
assert.match(
  sql,
  /revoke all on function public\.commit_add_video_to_version\([^;]+from public, anon, authenticated/,
);
assert.match(
  sql,
  /grant execute on function public\.commit_add_video_to_version\([^;]+to service_role/,
);
assert.match(
  types,
  /commit_add_video_to_version: \{[\s\S]*p_candidate_hash: string;[\s\S]*p_expected_revision: number;[\s\S]*p_job_attempts: number;[\s\S]*p_media_slot_id: string;[\s\S]*Returns: Json;/,
);
assert.match(applyTemplatePatch, /variant_key, revision/);
assert.match(applyTemplatePatch, /supabase\.rpc\(\s*"update_website_version_config_atomic"/);
assert.match(applyTemplatePatch, /p_expected_revision: targetExpectedRevision/);
assert.match(applyTemplatePatch, /version.revision !== expectedRevision/);
assert.match(applyTemplatePatch, /Website version revision conflict/);
assert.doesNotMatch(applyTemplatePatch, /\.from\("website_edit_events"\)/);
assert.match(sql, /grant execute on function public\.enqueue_add_video_job[\s\S]*to service_role/);
assert.doesNotMatch(sql, /owner_type/);
assert.match(currentAdmission, /perform public\.assert_add_video_source_eligible/);
assert.match(currentAdmission, /acceptedExpectedRevision/);
assert.match(currentAdmission, /replay_revision is distinct from p_expected_revision/);
assert.match(currentAdmission, /source_row\.revision<>p_expected_revision/);
assert.match(
  currentAdmission,
  /revoke all on function public\.enqueue_add_video_job_unchecked[\s\S]*service_role/,
);
assert.doesNotMatch(currentAdmission, /generatorSchemaVersion'\s*=\s*'3'/);
assert.match(currentAdmission, /generatorSchemaVersion' is distinct from '4'/);
assert.match(
  currentAdmission,
  /revoke all on function public\.commit_add_video_to_version_historical_body[\s\S]*service_role/,
);
console.log("verify-add-video-foundation: ok");
