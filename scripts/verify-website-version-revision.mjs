import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const baseSql = read("supabase/migrations/20260823120000_add_video_database_foundation.sql");
const publishSql = read(
  "supabase/migrations/20260828171000_bucket1_transactional_publish_attestation.sql",
);
const sql = baseSql + "\n" + publishSql;
const publish = read("src/lib/agent/publish.server.ts");
const fork = read("src/lib/agent/edit-draft.server.ts");
const onboarding = read("src/lib/agent/onboarding.server.ts");
const addVideoWorker = read("src/lib/jobs/add-video-worker.server.ts");
const siteConfig = read("src/lib/agent/site-config.server.ts");
const agentFunctions = read("src/lib/agent.functions.ts");
const uploadFunctions = read("src/lib/upload.functions.ts");
const templateEdit = read("src/lib/template-edit.functions.ts");
const editMode = read("src/components/purchaser/EditModePage.tsx");
const jobs = read("src/lib/jobs.functions.ts");
const agentRun = read("src/lib/agent/agent-run.server.ts");
const toolSchemas = read("src/lib/agent/tools/schemas.ts");
const handlers = read("src/lib/agent/tools/handlers.server.ts");
const types = read("src/integrations/supabase/types.ts");

function effectiveFunction(name) {
  const create =
    name === "publish_website_version_atomic" ? "create(?: or replace)?" : "create or replace";
  const pattern = create + " function public\\." + name + "\\([\\s\\S]*?^\\$\\$;";
  const source = name === "publish_website_version_atomic" ? publishSql : baseSql;
  const matches = [...source.matchAll(new RegExp(pattern, "gm"))];
  assert.ok(matches.length, "missing " + name);
  return matches.at(-1)[0];
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

assert.match(
  sql,
  /alter table public\.website_versions add column revision bigint not null default 0/,
);
assert.match(types, /website_versions: \{[\s\S]*?Row: \{[\s\S]*?revision: number;/);

const genericEdit = effectiveFunction("update_website_version_config_atomic");
assert.match(genericEdit, /p_expected_revision bigint/);
assert.match(genericEdit, /status in \('draft', 'selected'\) and revision = p_expected_revision/);
assert.equal(count(genericEdit, /revision = revision \+ 1/g), 1);
assert.equal(count(genericEdit, /insert into public\.website_edit_events/g), 1);

const finalizer = effectiveFunction("commit_add_video_to_version");
assert.ok(
  finalizer.indexOf("where id = p_job_id for update") <
    finalizer.indexOf("where id = p_target_version_id and website_id = p_website_id for update"),
);
assert.match(finalizer, /target_version\.revision <> p_expected_revision/);
assert.equal(count(finalizer, /revision = revision \+ 1/g), 1);
assert.doesNotMatch(finalizer, /set[\s\S]*version_number\s*=/);

const enqueue = effectiveFunction("enqueue_add_video_job");
assert.match(enqueue, /source_row\.revision/);
assert.match(
  enqueue,
  /'expectedRevision'.*case when source_row\.status = 'live' then 0 else source_row\.revision end/,
);
assert.match(enqueue, /'selected', 0/);
assert.doesNotMatch(enqueue, /update public\.website_versions/);

const publishRpc = effectiveFunction("publish_website_version_atomic");
assert.match(publishRpc, /p_expected_revision bigint/);
assert.match(publishRpc, /target\.revision <> p_expected_revision/);
assert.equal(count(publishRpc, /revision\s*=\s*revision\s*\+\s*1/g), 1);
assert.match(publishRpc, /revision=p_expected_revision/);
assert.match(publish, /p_validation_attestation: null/);
assert.doesNotMatch(publish, /verifyBucket1ValidationAttestation/);

const selectRpc = effectiveFunction("select_website_version_atomic");
assert.match(selectRpc, /p_expected_revision bigint/);
assert.match(selectRpc, /target\.revision <> p_expected_revision/);
assert.equal(count(selectRpc, /revision = revision \+ 1/g), 1);

const restoreRpc = effectiveFunction("restore_website_version_atomic");
assert.match(restoreRpc, /p_expected_revision bigint/);
assert.match(restoreRpc, /status = 'discarded' and revision = p_expected_revision/);
assert.match(restoreRpc, /return next_revision/);
assert.equal(count(restoreRpc, /revision = revision \+ 1/g), 1);

const discardRpc = effectiveFunction("discard_website_versions_atomic");
assert.match(discardRpc, /p_expected_versions jsonb/);
assert.match(discardRpc, /for update/);
assert.match(discardRpc, /version\.revision = \(expected->>'revision'\)::bigint/);
assert.equal(count(discardRpc, /revision = version\.revision \+ 1/g), 1);

const forkRpc = effectiveFunction("fork_website_version_with_media");
assert.match(forkRpc, /p_expected_revision bigint/);
assert.match(forkRpc, /source_row\.revision <> p_expected_revision/);
assert.match(forkRpc, /'selected', 0/);
assert.doesNotMatch(forkRpc, /update public\.website_versions/);

const generated = effectiveFunction("insert_generated_website_version");
assert.match(generated, /status, revision/);
assert.match(generated, /'draft', 0/);
const generatedWithSlots = effectiveFunction("insert_generated_website_version_with_slots");
assert.match(generatedWithSlots, /status <> 'running'/);
assert.match(generatedWithSlots, /attempts <> p_job_attempts/);

assert.match(publish, /expectedRevision: number/);
assert.match(publish, /version\.revision !== expectedRevision/);
assert.match(publish, /p_expected_revision: expectedRevision/);
assert.match(publish, /rpc\("select_website_version_atomic"/);
assert.doesNotMatch(publish, /\.from\("website_versions"\)[\s\S]{0,120}\.update\(/);
assert.match(fork, /p_expected_revision: liveVersion\.revision/);
assert.doesNotMatch(fork, /\.from\("website_versions"\)[\s\S]{0,120}\.update\(/);
assert.match(onboarding, /rpc\("discard_website_versions_atomic"/);
assert.match(onboarding, /Website version revision conflict/);
assert.match(addVideoWorker, /Website version revision conflict/);
assert.match(addVideoWorker, /throw new Error\("revision_conflict"\)/);
assert.doesNotMatch(onboarding, /\.from\("website_versions"\)[\s\S]{0,120}\.update\(/);
assert.match(siteConfig, /insert_generated_website_version_with_slots/);
assert.match(siteConfig, /insert_generated_website_version/);

for (const signature of [
  "publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb)",
  "select_website_version_atomic(uuid, uuid, bigint)",
  "restore_website_version_atomic(uuid, uuid, bigint)",
  "discard_website_versions_atomic(uuid, jsonb)",
  "fork_website_version_with_media(uuid, uuid, bigint)",
]) {
  assert.ok(
    sql.includes(
      "revoke all on function public." +
        signature +
        (signature.startsWith("publish_website_version_atomic")
          ? "\n  from public,anon,authenticated"
          : " from public, anon, authenticated"),
    ),
  );
  assert.ok(
    sql.includes(
      "grant execute on function public." +
        signature +
        (signature.startsWith("publish_website_version_atomic")
          ? "\n  to service_role"
          : " to service_role"),
    ),
  );
}

assert.match(
  types,
  /publish_website_version_atomic: \{[\s\S]*?p_expected_revision: number[\s\S]*?p_validation_attestation: Json(?: \| null)?[\s\S]*?Returns: number/,
);
assert.match(types, /select_website_version_atomic: \{[\s\S]*?p_expected_revision: number/);
assert.match(
  types,
  /restore_website_version_atomic: \{[\s\S]*?p_expected_revision: number[\s\S]*?Returns: number/,
);
assert.match(types, /discard_website_versions_atomic: \{[\s\S]*?p_expected_versions: Json/);
assert.match(types, /fork_website_version_with_media: \{[\s\S]*?p_expected_revision: number/);
assert.match(types, /enqueue_add_video_job: \{[\s\S]*?p_expected_revision: number/);

assert.match(agentFunctions, /versionMutationSchema[\s\S]*expectedRevision/);
assert.match(agentFunctions, /approveWebsiteVersion/);
assert.match(agentFunctions, /data\.expectedRevision/);
assert.match(uploadFunctions, /export const uploadSiteMedia/);
assert.doesNotMatch(uploadFunctions, /expectedRevision/);
assert.match(templateEdit, /expectedRevision: z\.number\(\)\.int\(\)\.nonnegative\(\)/);
assert.match(editMode, /expectedRevision: revision/);
assert.equal(exists("src/lib/agent/apply-config-patch.server.ts"), false);
const templatePatch = read("src/lib/agent/apply-template-patch.server.ts");
assert.match(templatePatch, /variant_key, revision/);
assert.match(templatePatch, /version\.revision !== expectedRevision/);
assert.match(templatePatch, /Website version revision conflict/);
assert.match(templatePatch, /p_expected_revision: targetExpectedRevision/);
assert.match(templatePatch, /update_website_version_config_atomic/);
assert.match(templatePatch, /update_website_version_config_owned/);
assert.match(templatePatch, /Edit did not change the template overlay/);
const noOpGuardAt = templatePatch.indexOf("Edit did not change the template overlay");
const firstUpdateRpcAt = templatePatch.indexOf("update_website_version_config_", noOpGuardAt);
assert.ok(
  noOpGuardAt >= 0 && firstUpdateRpcAt > noOpGuardAt,
  "no-op template patches are rejected before either atomic update RPC",
);
assert.doesNotMatch(jobs, /p_expected_revision: data\.expectedRevision|enqueueAddVideo/);
assert.match(addVideoWorker, /p_expected_revision: args\.expectedRevision/);
assert.match(agentRun, /sourceRevision: resolvedIntent.expectedRevision \?\? null/);
assert.match(toolSchemas, /publishToLpInput[\s\S]*expectedRevision/);
assert.match(toolSchemas, /applyTemplatePatchInput[\s\S]*expectedRevision/);
assert.match(handlers, /input\.versionId,\s*input\.expectedRevision/);
assert.match(enqueue, /source_row\.revision <> p_expected_revision/);

assert.match(siteConfig, /CROSS_WEBSITE_LAYOUT_SAMPLE_CAP = 12/);
assert.match(siteConfig, /\.rpc\("list_cross_website_layout_fingerprints"/);
assert.match(siteConfig, /row\.layout_fingerprint\?\.trim\(\)/);
assert.match(siteConfig, /priorLayoutFingerprints\(storedPriors\)/);
assert.equal(/priorIntentTuples\(crossWebsite/.test(siteConfig), false);

console.log("verify-website-version-revision: ok");
