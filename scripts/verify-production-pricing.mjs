import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { importWithMocks } from "./lib/import-with-mocks.mjs";

const planBundle = await importWithMocks(path.resolve("src/lib/plans.ts"), {});
try {
  const {
    LOWEST_MONTHLY_PRICE_USD,
    PLANS,
    PLANS_BY_ID,
    PLAN_COMPARISON_COPY,
    PLAN_SEO_DESCRIPTION,
    planMonthlyLabel,
  } = planBundle.subject;

  assert.deepEqual(Object.keys(PLANS_BY_ID), ["starter", "pro"]);
  assert.deepEqual(
    PLANS.map(({ id, name, monthlyPriceUsd, price }) => ({ id, name, monthlyPriceUsd, price })),
    [
      { id: "starter", name: "Starter", monthlyPriceUsd: 79, price: "$79" },
      { id: "pro", name: "Pro", monthlyPriceUsd: 129, price: "$129" },
    ],
    "the exported plan catalog is the canonical $79/$129 monthly pair",
  );
  assert.strictEqual(PLANS[0], PLANS_BY_ID.starter);
  assert.strictEqual(PLANS[1], PLANS_BY_ID.pro);
  assert.equal(LOWEST_MONTHLY_PRICE_USD, 79);
  assert.equal(planMonthlyLabel("starter"), "$79/month");
  assert.equal(planMonthlyLabel("pro"), "$129/month");

  const starterFeatures = PLANS_BY_ID.starter.features.join(" ").toLowerCase();
  const proFeatures = PLANS_BY_ID.pro.features.join(" ").toLowerCase();
  assert.match(starterFeatures, /lead capture/);
  assert.match(PLANS_BY_ID.starter.summary, /website leads/i);
  assert.match(proFeatures, /website leads/);
  assert.match(proFeatures, /google calendar/);
  assert.match(proFeatures, /stripe connect/);
  assert.doesNotMatch(starterFeatures, /google calendar|stripe connect/);
  assert.match(PLANS_BY_ID.pro.summary, /website leads/i);
  assert.match(PLAN_COMPARISON_COPY, /pro[\s\S]*adds[\s\S]*google calendar[\s\S]*stripe connect/i);
  assert.match(PLAN_COMPARISON_COPY, /retaining website leads/i);
  assert.match(PLAN_SEO_DESCRIPTION, /starter \$79\/month or pro \$129\/month/i);
} finally {
  await planBundle.cleanup();
}

const surfaceFiles = [
  "src/components/JourneySteps.tsx",
  "src/components/PricingCards.tsx",
  "src/components/site-renderer/DemoLpChrome.tsx",
  "src/routes/__root.tsx",
  "src/routes/index.tsx",
];
const surfaces = Object.fromEntries(
  await Promise.all(surfaceFiles.map(async (file) => [file, await readFile(file, "utf8")])),
);
const combinedSurfaces = Object.values(surfaces).join("\n");

// Customer-facing and administrative pricing surfaces consume the canonical catalog instead of
// declaring a competing numeric plan contract. Literal prices remain forbidden outside plans.ts.
for (const file of [
  "src/components/PricingCards.tsx",
  "src/components/site-renderer/DemoLpChrome.tsx",
]) {
  assert.match(surfaces[file], /@\/lib\/plans/, `${file} must consume the canonical plan catalog`);
}
assert.ok(surfaces["src/components/PricingCards.tsx"].includes("PLANS.map"));
assert.ok(surfaces["src/components/site-renderer/DemoLpChrome.tsx"].includes("PLANS.map"));
assert.ok(
  surfaces["src/components/site-renderer/DemoLpChrome.tsx"].includes("PLANS_BY_ID[plan].summary"),
);
assert.ok(surfaces["src/components/JourneySteps.tsx"].includes("PLAN_COMPARISON_COPY"));
assert.ok(surfaces["src/routes/index.tsx"].includes("PLAN_SEO_DESCRIPTION"));
assert.ok(surfaces["src/routes/__root.tsx"].includes("PLAN_SEO_DESCRIPTION"));
assert.doesNotMatch(
  combinedSurfaces,
  /\$(?:29|99)(?!\d)/,
  "stale plan prices reached a pricing surface",
);

const [paymentSpec, verificationWorkflow, releaseWorkflow] = await Promise.all([
  readFile("plans/payment.md", "utf8"),
  readFile(".github/workflows/verification.yml", "utf8"),
  readFile(".github/workflows/release-proof.yml", "utf8"),
]);
assert.match(paymentSpec, /starter[^\n]*\$79 usd per month/i);
assert.match(paymentSpec, /pro[^\n]*\$129 usd per month/i);
assert.match(paymentSpec, /no one-time website or setup fee/i);
assert.doesNotMatch(paymentSpec, /\$(?:29|99)(?!\d)/);
for (const [name, workflow] of [
  ["verification", verificationWorkflow],
  ["release-proof", releaseWorkflow],
]) {
  assert.match(
    workflow,
    /pnpm verify:production-pricing/,
    `${name} workflow must run the pricing contract`,
  );
  assert.match(
    workflow,
    /pnpm verify:saas-checkout-security/,
    `${name} workflow must run the checkout security contract`,
  );
}

console.log("verify-production-pricing: canonical additive plan contracts pass");
