import assert from "node:assert/strict";

import {
  assertSaasCheckoutChargingEnabled,
  billingEnvironment,
  saasCheckoutAvailable,
} from "@/lib/stripe.server";

const ENV_KEYS = [
  "SAAS_CHECKOUT_ENABLED",
  "SAAS_BILLING_ENVIRONMENT",
  "SAAS_LIVE_CHARGING_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PRO",
] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

type Scenario = {
  name: string;
  checkout?: string;
  environment?: string;
  key?: string;
  liveOptIn?: string;
  expected?: "test" | "live";
};

function setEnv(name: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function runScenario(scenario: Scenario) {
  setEnv("SAAS_CHECKOUT_ENABLED", scenario.checkout);
  setEnv("SAAS_BILLING_ENVIRONMENT", scenario.environment);
  setEnv("STRIPE_SECRET_KEY", scenario.key);
  setEnv("SAAS_LIVE_CHARGING_ENABLED", scenario.liveOptIn);
  process.env.STRIPE_PRICE_STARTER = "price_starter_79";
  process.env.STRIPE_PRICE_PRO = "price_pro_129";

  if (scenario.expected) {
    assert.equal(
      assertSaasCheckoutChargingEnabled(),
      scenario.expected,
      `${scenario.name}: charging gate returned the wrong environment`,
    );
    assert.equal(billingEnvironment(), scenario.expected);
    assert.equal(saasCheckoutAvailable(), true);
    return;
  }

  assert.throws(
    () => assertSaasCheckoutChargingEnabled(),
    undefined,
    `${scenario.name}: charging unexpectedly enabled`,
  );
  assert.equal(
    saasCheckoutAvailable(),
    false,
    `${scenario.name}: checkout advertised as available`,
  );
}

try {
  for (const checkout of [undefined, "", "false", "TRUE", "1", " true "]) {
    runScenario({
      name: `test mode rejects non-exact checkout flag ${JSON.stringify(checkout)}`,
      checkout,
      environment: "test",
      key: "sk_test_example",
      liveOptIn: "true",
    });
  }
  runScenario({
    name: "test mode accepts exact checkout flag without live opt-in",
    checkout: "true",
    environment: "test",
    key: "sk_test_example",
    liveOptIn: undefined,
    expected: "test",
  });

  for (const environment of [undefined, "", "production", "TEST"]) {
    runScenario({
      name: `explicit billing environment required: ${JSON.stringify(environment)}`,
      checkout: "true",
      environment,
      key: "sk_test_example",
      liveOptIn: "true",
    });
  }
  for (const [environment, key] of [
    ["test", "sk_live_example"],
    ["live", "sk_test_example"],
    ["test", "rk_test_example"],
    ["live", "rk_live_example"],
    ["test", "pk_test_example"],
    ["test", undefined],
  ] as const) {
    runScenario({
      name: `${environment} deployment rejects key ${JSON.stringify(key)}`,
      checkout: "true",
      environment,
      key,
      liveOptIn: "true",
    });
  }

  for (const liveOptIn of [undefined, "", "false", "TRUE", "1", " true "]) {
    runScenario({
      name: `live mode rejects non-exact opt-in ${JSON.stringify(liveOptIn)}`,
      checkout: "true",
      environment: "live",
      key: "sk_live_example",
      liveOptIn,
    });
  }
  runScenario({
    name: "live mode requires and accepts both exact opt-ins",
    checkout: "true",
    environment: "live",
    key: "sk_live_example",
    liveOptIn: "true",
    expected: "live",
  });

  process.env.STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_STARTER;
  assert.equal(saasCheckoutAvailable(), false, "duplicate plan prices keep checkout unavailable");

  console.log("SaaS checkout deployment/key/live opt-in gate matrix passed");
} finally {
  for (const key of ENV_KEYS) setEnv(key, original[key]);
}
