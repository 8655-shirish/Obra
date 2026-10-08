import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GACHA_FAMILIES,
  drawGacha,
  gachaMayEnqueuePhotoScrape,
  parseGachaFilter,
} from "../src/lib/agent/gacha.ts";
import { GACHA_PACKS, HERO_TREATMENTS, allGachaPacks } from "../src/lib/agent/gacha-packs.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packs = allGachaPacks();

assert.equal(HERO_TREATMENTS.length, 15);
assert.equal(new Set(HERO_TREATMENTS).size, 15);
assert.equal(packs.length, 600);
assert.equal(GACHA_PACKS.length, 600);
assert.equal(new Set(packs.map((pack) => pack.id)).size, 600);
assert.equal(new Set(GACHA_FAMILIES).size, 10);
assert.equal(new Set(packs.map((pack) => pack.heroTreatment)).size, 15);
assert.equal(
  new Set(
    packs.map(
      (pack) =>
        pack.mediaRecipe.atmosphereStills.find((still) => still.slotId === "atmosphere-hero")
          ?.promptTemplate,
    ),
  ).size,
  15,
);
assert.doesNotMatch(
  packs.map((pack) => pack.id).join("\n"),
  /(^|-)(overlay|split|stacked|gallery|type-led)(-|$)/m,
);
assert.ok(packs.every((pack) => pack.version === 1));
assert.ok(
  packs.every((pack) =>
    pack.mediaRecipe.atmosphereStills.some((still) => still.promptTemplate.includes("{{trade}}")),
  ),
);

const sameSeed = drawGacha(packs, { seed: "job-a", evidenceStillCount: 0 });
assert.equal(drawGacha(packs, { seed: "job-a", evidenceStillCount: 0 }).id, sameSeed.id);

const regen = drawGacha(packs, {
  seed: "job-b",
  evidenceStillCount: 2,
  recentGachaIds: [sameSeed.id],
});
assert.notEqual(regen.id, sameSeed.id);

const requested = drawGacha(packs, {
  seed: "ignored",
  evidenceStillCount: 0,
  requestedId: "editorial-billboard-balanced",
});
assert.equal(requested.id, "editorial-billboard-balanced");

assert.throws(
  () => drawGacha(packs, { seed: "x", evidenceStillCount: 0, requestedId: "not-a-pack" }),
  {
    message: "Unknown gachaId",
  },
);

const premium = drawGacha(packs, {
  seed: "filter",
  evidenceStillCount: 0,
  tags: ["premium"],
});
assert.ok(premium.tags.includes("premium"));

const ignoredUnknown = parseGachaFilter(["premium", "not-a-tag", "minimal"]);
assert.deepEqual(ignoredUnknown, ["premium", "minimal"]);

const emptyDrum = drawGacha(packs, {
  seed: "fallback",
  evidenceStillCount: 0,
  tags: ["photo-led"],
  lookAndFeel: "professional",
  recentGachaIds: packs.map((pack) => pack.id),
});
assert.ok(emptyDrum.id);
assert.equal(
  packs.some((pack) => pack.id === emptyDrum.id),
  true,
);

assert.equal(
  gachaMayEnqueuePhotoScrape({ generationKind: "regeneration", researchStatus: "complete" }),
  false,
);
assert.equal(
  gachaMayEnqueuePhotoScrape({ generationKind: "regeneration", researchStatus: "partial" }),
  false,
);
assert.equal(
  gachaMayEnqueuePhotoScrape({ generationKind: "initial", researchStatus: "complete" }),
  false,
);
assert.equal(
  gachaMayEnqueuePhotoScrape({ generationKind: "initial", researchStatus: "partial" }),
  true,
);
assert.equal(gachaMayEnqueuePhotoScrape({ generationKind: "initial", researchStatus: null }), true);

const photoLed = packs.filter((pack) => pack.minEvidenceStills >= 2);
assert.ok(photoLed.length > 0);
assert.ok(photoLed.every((pack) => pack.id.includes("-spine-") || pack.id.includes("-chorus-")));
const dispatch = packs.find((pack) => pack.id === "portfolio-dispatch-balanced");
assert.equal(dispatch?.minEvidenceStills, 0);
assert.equal(dispatch?.mediaRecipe.proofStripRequired, false);
assert.equal(dispatch?.tags.includes("photo-led"), false);
const chorus = packs.find((pack) => pack.id === "editorial-chorus-balanced");
assert.equal(chorus?.mediaRecipe.proofSlots?.length, 3);
const spine = packs.find((pack) => pack.id === "editorial-spine-balanced");
assert.equal(spine?.mediaRecipe.proofSlots?.length, 3);
const zeroPhoto = drawGacha(packs, { seed: "zero", evidenceStillCount: 0 });
assert.equal(zeroPhoto.minEvidenceStills, 0);

assert.throws(() => drawGacha([], { seed: "x", evidenceStillCount: 0 }), {
  message: "Gacha drum is empty",
});

const enqueue = fs.readFileSync(path.join(root, "src/lib/jobs/enqueue.server.ts"), "utf8");
assert.doesNotMatch(enqueue, /enqueueSiteGenerationChain|generationContractVersion: 3/);
assert.ok(enqueue.includes("enqueueEnrichmentChain"));

const generator = fs.readFileSync(
  path.join(root, "src/lib/agent/website-generator.server.ts"),
  "utf8",
);
assert.ok(generator.includes("Picking a look…"));
assert.ok(generator.includes("drawGacha"));
assert.ok(generator.includes("packToPlan"));

const execute = fs.readFileSync(path.join(root, "src/lib/jobs/execute.server.ts"), "utf8");
assert.ok(execute.includes("Picking a look…"));
assert.ok(execute.includes("joinAttested"));
assert.ok(execute.includes("resumeGachaLock"));
assert.ok(execute.includes('"pending", "running", "finalizing"'));

assert.ok(generator.includes("if (evidenceInventory.length < requiredEvidence && !gachaId)"));
assert.ok(generator.includes("gachaMayEnqueuePhotoScrape"));
assert.ok(generator.includes('generationKind === "initial"'));
assert.ok(execute.includes("generationKind: checkpoint.input.generationKind"));

const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260831180000_gacha_generation_admission.sql"),
  "utf8",
);
assert.ok(migration.includes("p_stage in ('planning','media')"));
assert.ok(migration.includes("generationContractVersion',current_job.generation_contract_version"));
const finalYieldMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260901100000_restore_gacha_yield_after_lovable_alias.sql"),
  "utf8",
);
assert.ok(finalYieldMigration.includes("p_stage in ('planning','media')"));
assert.ok(
  finalYieldMigration.includes(
    "generationContractVersion',current_job.generation_contract_version",
  ),
);

const identityMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260831200000_admit_gacha_generation_identity.sql"),
  "utf8",
);
assert.match(identityMigration, /generation_contract_version in \(2, 3\)/);
assert.doesNotMatch(identityMigration, /and generation_contract_version = 2/);
assert.match(
  identityMigration,
  /drop constraint if exists background_jobs_generation_identity_check/,
);
assert.match(identityMigration, /validate constraint background_jobs_generation_identity_check/);

const migrationsDir = path.join(root, "supabase/migrations");
const identityBodies = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .flatMap((name) => {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    return [
      ...sql.matchAll(
        /add constraint background_jobs_generation_identity_check check \(([\s\S]*?)\) not valid;/g,
      ),
    ].map((match) => match[1]);
  });
assert.ok(identityBodies.length > 0);
const liveIdentity = identityBodies.at(-1) ?? "";
assert.match(liveIdentity, /generation_contract_version in \(2, 3\)/);
assert.doesNotMatch(liveIdentity, /generation_contract_version = 2/);

assert.doesNotMatch(enqueue, /rpcAdmissionDetail|rpcAdmissionLogFields/);
assert.doesNotMatch(enqueue, /background_jobs_generation_identity_check/);
assert.doesNotMatch(enqueue, /enqueueSiteGenerationChain/);

const publicError = fs.readFileSync(path.join(root, "src/lib/agent/public-error.ts"), "utf8");
assert.match(publicError, /did not match the current generation contract/);
assert.match(publicError, /This site rebuild could not be queued/);

const checkpoint = fs.readFileSync(
  path.join(root, "src/lib/jobs/site-generation-checkpoint.ts"),
  "utf8",
);
assert.ok(checkpoint.includes('"gachaLock"'));
assert.match(checkpoint, /invalid\("stage gachaLock"\)/);
assert.doesNotMatch(checkpoint, /planCheckpoint/);
assert.doesNotMatch(execute, /planCheckpoint/);
assert.doesNotMatch(generator, /onUnifiedBriefAccepted/);

const prompts = fs.readFileSync(path.join(root, "src/lib/agent/prompts.ts"), "utf8");
assert.match(prompts, /never generate, regenerate/);
assert.doesNotMatch(prompts, /Call generateVariants/);

console.log("verify-gacha: ok");
