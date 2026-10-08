import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";

// Invoke actual components and callbacks with in-memory hooks. No DOM or browser renderer.
const originals = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  document: globalThis.document,
  FormData: globalThis.FormData,
};
const fixture = { calls: [], timers: new Map(), nextTimer: 0, redirects: [], listeners: new Map() };
globalThis.__bookingUiRecovery = fixture;
let active;
const same = (a, b) => a?.length === b?.length && a?.every((value, i) => Object.is(value, b[i]));
fixture.hooks = {
  useState(initial) {
    const instance = active;
    const index = instance.cursor++;
    const slot = (instance.hooks[index] ??= {
      value: typeof initial === "function" ? initial() : initial,
    });
    return [
      slot.value,
      (next) => {
        if (!instance.mounted) {
          instance.lateWrites++;
          return;
        }
        const value = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) {
          slot.value = value;
          instance.dirty = true;
        }
      },
    ];
  },
  useRef(initial) {
    return (active.hooks[active.cursor++] ??= { current: initial });
  },
  useMemo(fn, deps) {
    const index = active.cursor++;
    if (!same(active.hooks[index]?.deps, deps)) active.hooks[index] = { deps, value: fn() };
    return active.hooks[index].value;
  },
  useCallback(fn, deps) {
    return fixture.hooks.useMemo(() => fn, deps);
  },
  effect(fn, deps, layout) {
    const instance = active;
    const index = instance.cursor++;
    if (!same(instance.hooks[index]?.deps, deps))
      (layout ? instance.layout : instance.effects).push(() => {
        instance.hooks[index]?.cleanup?.();
        instance.hooks[index] = {
          deps,
          cleanup: instance.presentationOnly ? undefined : fn(),
        };
      });
  },
  useEffect(fn, deps) {
    fixture.hooks.effect(fn, deps, false);
  },
  useLayoutEffect(fn, deps) {
    fixture.hooks.effect(fn, deps, true);
  },
};

function mount(component, props = {}, presentationOnly = false) {
  const instance = {
    component,
    props,
    presentationOnly,
    hooks: [],
    mounted: true,
    lateWrites: 0,
    render(next = instance.props) {
      instance.props = next;
      instance.cursor = 0;
      instance.effects = [];
      instance.layout = [];
      instance.dirty = false;
      active = instance;
      instance.tree = component(next);
      active = null;
      for (const effect of instance.layout) effect();
      for (const effect of instance.effects) effect();
    },
    async flush() {
      for (let pass = 0; pass < 20; pass++) {
        await new Promise((resolve) => setImmediate(resolve));
        if (instance.mounted && instance.dirty) instance.render();
      }
    },
    unmount() {
      instance.mounted = false;
      for (const hook of instance.hooks) hook?.cleanup?.();
    },
  };
  instance.render();
  return instance;
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object") return text(node.props?.children);
  return typeof node === "string" ? node : "";
}
const button = (instance, label) =>
  nodes(instance.tree).find(
    (node) => ["Button", "button"].includes(node.type) && text(node) === label,
  );
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const componentStub = (...names) => names.map((name) => `export const ${name}='${name}';`).join("");
const commonMocks = {
  react: `export const {useState,useRef,useMemo,useCallback,useEffect,useLayoutEffect}=globalThis.__bookingUiRecovery.hooks;
    export const lazy=load=>({load});export const Suspense='Suspense';`,
  "react/jsx-runtime": `export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;export const Fragment='Fragment';`,
  "@tanstack/react-start": `export const createServerFn=()=>({validator:validate=>({handler:handle=>({data})=>handle({data:validate(data)})})});`,
  "@tanstack/react-router": `export const Link='Link';export const redirect=value=>value;
    export const useRouter=()=>globalThis.__bookingUiRecovery.router;
    export const createFileRoute=()=>options=>({...options,
      useLoaderData:()=>globalThis.__bookingUiRecovery.loader,
      useSearch:()=>globalThis.__bookingUiRecovery.search,
      useMatch:({select})=>select({id:globalThis.__bookingUiRecovery.matchId})});`,
  "@/components/ui/button": componentStub("Button"),
  "@/components/ui/badge": componentStub("Badge"),
  "@/components/ui/alert": componentStub("Alert", "AlertTitle", "AlertDescription"),
  "@/components/ui/card": componentStub(
    "Card",
    "CardHeader",
    "CardContent",
    "CardTitle",
    "CardDescription",
  ),
  "@/components/ui/dialog": componentStub(
    "Dialog",
    "DialogContent",
    "DialogHeader",
    "DialogTitle",
    "DialogDescription",
  ),
  "@/components/ui/input": componentStub("Input"),
  "@/components/ui/label": componentStub("Label"),
  "@/components/ui/checkbox": componentStub("Checkbox"),
  "@/components/ui/switch": componentStub("Switch"),
  "@/components/ui/tooltip": componentStub(
    "Tooltip",
    "TooltipContent",
    "TooltipProvider",
    "TooltipTrigger",
  ),
  "lucide-react": componentStub(
    "ArrowDownRight",
    "ArrowRight",
    "Check",
    "CheckCircle2",
    "ChevronDown",
    "Copy",
    "Droplet",
    "Gauge",
    "Info",
    "Menu",
    "Phone",
    "Plus",
    "Quote",
    "ShieldCheck",
    "Trash2",
    "Waves",
    "Wrench",
    "X",
  ),
  "motion/react": `export const useReducedMotion=()=>true;`,
  "@/lib/booking-attachments.functions": `export const getBookingAttachmentCapability=async()=>({enabled:false});
    export const issueBookingAttachmentDownload=()=>{throw Error('Unexpected attachment download')};`,
  "@/lib/booking-live.functions": `export const getLiveBookingSlots=input=>globalThis.__bookingUiRecovery.slots(input);
    export const createLiveBookingCheckout=input=>globalThis.__bookingUiRecovery.checkout(input);`,
};
let moduleId = 0;
async function bundle(entry, overrides = {}) {
  const mocks = { ...commonMocks, ...overrides };
  const result = await build({
    entryPoints: [path.resolve(entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    alias: { "@": path.resolve("src") },
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "code-only-ui-boundaries",
        setup(api) {
          api.onResolve({ filter: /.*/ }, ({ path: specifier }) =>
            Object.hasOwn(mocks, specifier) ? { path: specifier, namespace: "fixture" } : undefined,
          );
          api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: specifier }) => ({
            contents: mocks[specifier],
            loader: "js",
          }));
        },
      },
    ],
  });
  const code = result.outputFiles[0].text + `\n//# sourceURL=${path.basename(entry)}.code-only.mjs`;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${moduleId++}`
  );
}

const websiteId = "11111111-1111-4111-8111-111111111111";
const otherWebsiteId = "33333333-3333-4333-8333-333333333333";
const profileId = "22222222-2222-4222-8222-222222222222";
const connection = {
  accountId: null,
  connectionRevision: 1,
  pendingSetup: null,
  configured: false,
  healthState: "not_connected",
  reason: null,
  reconnectReason: null,
  lastVerifiedAt: null,
  nextRetryAt: null,
  triggerState: null,
  lastHealthAt: null,
};

async function testCompletion() {
  fixture.configuration = {
    accountId: null,
    connectionRevision: 1,
    pendingSetup: null,
    canConfigure: true,
    blockingCalendarIds: [],
    destinationCalendarId: null,
  };
  const { StepTwoCard, StepFourCard } = await bundle(
    "src/components/purchaser/SetupStepCards.tsx",
    {
      "@/components/booking/AvailabilityEditor": componentStub("AvailabilityEditor"),
      "@/lib/booking-setup.functions": `export const getBookingSetup=()=>{throw Error('Unexpected availability read')};`,
      "@/lib/booking-provider.functions": `const f=globalThis.__bookingUiRecovery;
      export const loadGoogleCalendarConfiguration=async()=>{
        if(f.configLoadError)throw Error('Configuration read unavailable');
        return structuredClone(f.configuration);
      };
      export const completeGoogleCalendarConnection=input=>f.complete(input);
      export const startGoogleCalendarConnect=()=>{throw Error('Fresh OAuth forbidden')};
      export const refreshGoogleCalendarConnection=()=>{throw Error('Unexpected provider refresh')};
      export const discoverGoogleCalendarAccounts=()=>{throw Error('Unexpected account discovery')};
      export const discoverGoogleCalendars=()=>{throw Error('Unexpected discovery')};
      export const saveGoogleCalendarSelection=()=>{throw Error('Unexpected save')};`,
      "@/lib/stripe-connect.functions": `export const getStripeConnectStatus=async()=>({environmentError:'Wrong environment',canOnboard:true,connected:true});
      const forbidden=()=>{throw Error('Stripe action forbidden')};
      export const openStripeExpressDashboard=forbidden,reconcileStripeConnect=forbidden,startStripeConnectOnboarding=forbidden;`,
    },
  );
  let calls = 0,
    consumed = 0;
  const props = {
    websiteId,
    userId: profileId,
    isOwner: true,
    statusUnknown: false,
    connect: "success",
    readiness: {
      environment: "test",
      plan: "pro",
      orderConfirmed: true,
      entitlementUnavailable: false,
      calendar: "not_configured",
      calendarAccountEmail: null,
      calendarConnection: connection,
    },
    onChanged: async () => {},
    onConnectConsumed: () => consumed++,
  };
  fixture.complete = async ({ data }) => {
    assert.deepEqual(data, { websiteId });
    calls++;
    throw new Error("Transient calendar discovery failure before setup reservation");
  };
  let instance = mount(StepTwoCard, props);
  await instance.flush();
  assert.equal(calls, 1);
  assert.equal(consumed, 0);
  assert.equal(button(instance, "Retry completion").props.disabled, false);
  instance.render({ ...props, readiness: structuredClone(props.readiness) });
  await instance.flush();
  assert.equal(calls, 1, "display refresh cannot repeat completion");
  const pending = deferred();
  fixture.complete = async () => {
    calls++;
    return pending.promise;
  };
  const retry = button(instance, "Retry completion").props.onClick;
  retry();
  retry();
  await instance.flush();
  assert.equal(calls, 2, "one completion at a time, even before React commits busy state");
  pending.resolve({ completed: true });
  await instance.flush();
  assert.equal(consumed, 1);
  assert.equal(button(instance, "Retry completion"), undefined);
  instance.unmount();

  calls = consumed = 0;
  fixture.complete = async () => {
    calls++;
    throw new Error("Google Connect operation changed or expired");
  };
  instance = mount(StepTwoCard, props);
  await instance.flush();
  for (let attempt = 0; attempt < 2; attempt++) {
    button(instance, "Retry completion").props.onClick();
    await instance.flush();
  }
  assert.equal(calls, 3);
  assert.equal(consumed, 0);
  assert.equal(button(instance, "Retry completion").props.disabled, true);
  button(instance, "Retry completion").props.onClick();
  instance.render();
  await instance.flush();
  assert.equal(calls, 3, "invalid/unknown completion cannot loop or restart OAuth");
  instance.unmount();

  for (const patch of [
    { isOwner: false },
    { readiness: { ...props.readiness, plan: "starter" } },
    { readiness: { ...props.readiness, entitlementUnavailable: true } },
    { connect: "error" },
  ]) {
    calls = consumed = 0;
    instance = mount(StepTwoCard, { ...props, ...patch });
    await instance.flush();
    assert.equal(calls, 0);
    assert.equal(consumed, 1);
    assert.equal(button(instance, "Retry completion"), undefined);
    if (patch.connect === "error") assert.match(text(instance.tree), /connection was cancelled/);
    instance.unmount();
  }

  calls = consumed = 0;
  fixture.configLoadError = true;
  instance = mount(StepTwoCard, { ...props, connect: "error" });
  await instance.flush();
  assert.equal(calls, 0);
  assert.equal(consumed, 1, "genuine cancellation is consumed even when the config GET fails");
  assert.match(text(instance.tree), /connection was cancelled/);
  instance.unmount();
  fixture.configLoadError = false;

  calls = consumed = 0;
  instance = mount(StepTwoCard, { ...props, statusUnknown: true });
  await instance.flush();
  assert.equal(calls, 0);
  assert.equal(consumed, 0, "unknown facts retain the return marker");
  const oldCompletion = deferred();
  fixture.complete = () => oldCompletion.promise;
  instance.render(props);
  await instance.flush();
  instance.render({ ...props, websiteId: otherWebsiteId, connect: undefined });
  await instance.flush();
  oldCompletion.reject(new Error("Old workspace failed"));
  await instance.flush();
  assert.equal(consumed, 0);
  assert.equal(button(instance, "Retry completion"), undefined);
  assert.doesNotMatch(text(instance.tree), /could not be confirmed/);
  instance.unmount();
  assert.equal(instance.lateWrites, 0);

  instance = mount(StepFourCard, {
    websiteId,
    userId: profileId,
    locked: false,
    onboardingReady: true,
    connect: "return",
    onChanged: async () => {},
    onConnectConsumed: () => {},
  });
  await instance.flush();
  assert.match(text(instance.tree), /Wrong environment/);
  assert.equal(button(instance, "Connect Stripe"), undefined);
  assert.equal(button(instance, "My Payments"), undefined);
  instance.unmount();
  console.log(
    "PASS R18: same-action manual retry, marker retention, bounded attempts, owner/Pro/unknown gates, cancellation and workspace cleanup; Stripe guard preserved",
  );
}

async function testExplicitAccountChoice() {
  const accounts = [
    { id: "apn_A", name: "Original account", healthy: true },
    { id: "apn_B", name: "Newly authorized account B", healthy: true },
    { id: "apn_C", name: "Account C", healthy: true },
    { id: "apn_bad", name: "Unavailable account", healthy: false },
  ];
  const calendarResult = (accountId) => ({
    account: accounts.find((account) => account.id === accountId),
    calendars: [
      { id: `${accountId}-conflicts`, summary: `${accountId} conflicts`, accessRole: "reader" },
      { id: `${accountId}-destination`, summary: `${accountId} destination`, accessRole: "owner" },
    ],
  });
  const { StepTwoCard } = await bundle("src/components/purchaser/SetupStepCards.tsx", {
    "@/components/booking/AvailabilityEditor": componentStub("AvailabilityEditor"),
    "@/lib/booking-setup.functions": `export const getBookingSetup=()=>{throw Error('Unexpected availability read')};`,
    "@/lib/booking-provider.functions": `const f=globalThis.__bookingUiRecovery;
      export const loadGoogleCalendarConfiguration=async()=>{
        if(f.accountConfigError)throw Error('Configuration read failed');
        return structuredClone(f.accountConfig);
      };
      export const discoverGoogleCalendarAccounts=input=>f.accounts(input);
      export const discoverGoogleCalendars=input=>f.calendars(input);
      export const saveGoogleCalendarSelection=input=>f.saveCalendars(input);
      const forbidden=()=>{throw Error('No OAuth/completion/provider refresh permitted')};
      export const completeGoogleCalendarConnection=forbidden,startGoogleCalendarConnect=forbidden,refreshGoogleCalendarConnection=forbidden;`,
    "@/lib/stripe-connect.functions": `export const getStripeConnectStatus=()=>{},openStripeExpressDashboard=()=>{},reconcileStripeConnect=()=>{},startStripeConnectOnboarding=()=>{};`,
  });
  const accountSelect = (instance) =>
    nodes(instance.tree)
      .find((node) => node.type === "label" && text(node).startsWith("Connected Google account"))
      ?.props.children.find((node) => node?.type === "select");
  const destinationSelect = (instance) =>
    nodes(instance.tree)
      .find((node) => node.type === "label" && text(node).startsWith("Booking destination"))
      ?.props.children.find((node) => node?.type === "select");
  const checkbox = (instance, name) =>
    nodes(instance.tree).find((node) => node.type === "label" && text(node) === name)?.props
      .children[0];
  let calls;
  fixture.accounts = async ({ data }) => {
    calls.push({ action: "accounts", data });
    return { accounts: structuredClone(accounts) };
  };
  fixture.saveCalendars = async ({ data }) => {
    calls.push({ action: "save", data: structuredClone(data) });
    return { saved: true, triggerPending: true };
  };
  for (const pending of [true, false]) {
    calls = [];
    const key = pending ? "a".repeat(64) : null;
    const selection = {
      accountId: "apn_A",
      connectionRevision: 4,
      blockingCalendarIds: ["apn_A-conflicts"],
      destinationCalendarId: "apn_A-destination",
    };
    fixture.accountConfig = {
      ...selection,
      accountId: pending ? null : "apn_A",
      accountEmail: pending ? null : "owner@example.test",
      pendingSetup: pending
        ? { ...selection, configurationKey: key, reason: "permissions", nextRetryAt: null }
        : null,
      canConfigure: true,
    };
    const props = {
      websiteId,
      userId: profileId,
      isOwner: true,
      statusUnknown: false,
      connect: undefined,
      readiness: {
        environment: "test",
        plan: "pro",
        orderConfirmed: true,
        entitlementUnavailable: false,
        calendar: pending ? "pending" : "ready",
        calendarAccountEmail: fixture.accountConfig.accountEmail,
        calendarConnection: {
          ...connection,
          connectionRevision: 4,
          accountId: pending ? null : "apn_A",
          configured: !pending,
          healthState: pending ? "not_connected" : "healthy",
          triggerState: "active",
          pendingSetup: pending
            ? { configurationKey: key, reason: "permissions", nextRetryAt: null }
            : null,
        },
      },
      onChanged: async () => {},
      onConnectConsumed: () => {},
    };
    fixture.calendars = async ({ data }) => {
      calls.push({ action: "calendars", data: structuredClone(data) });
      return calendarResult(data.accountId);
    };
    const instance = mount(StepTwoCard, props);
    await instance.flush();
    assert.deepEqual(calls, [], "no account or calendar is selected on mount");
    button(instance, "Review calendars").props.onClick();
    await instance.flush();
    assert.equal(checkbox(instance, "apn_A conflicts").props.checked, true);
    button(instance, "Choose connected account").props.onClick();
    await instance.flush();
    assert.equal(calls.at(-1).action, "accounts");
    assert.deepEqual(calls.at(-1).data, { websiteId });
    assert.equal(accountSelect(instance).props.value, "");
    assert.equal(
      nodes(accountSelect(instance)).find((node) => node.props.value === "apn_bad").props.disabled,
      true,
    );
    const before = calls.length;
    accountSelect(instance).props.onChange({ target: { value: "apn_bad" } });
    await instance.flush();
    assert.equal(calls.length, before);
    const pendingB = deferred();
    fixture.calendars = ({ data }) => {
      calls.push({ action: "calendars", data: structuredClone(data) });
      return pendingB.promise;
    };
    // B is chosen only through the rendered select handler, never by editing component state.
    accountSelect(instance).props.onChange({ target: { value: "apn_B" } });
    await instance.flush();
    assert.deepEqual(calls.at(-1).data, {
      websiteId,
      accountId: "apn_B",
      expectedRevision: 4,
      expectedSetupKey: key,
    });
    assert.equal(
      checkbox(instance, "apn_A conflicts").props.checked,
      true,
      "old editor survives discovery",
    );
    assert.equal(button(instance, "Save calendars").props.disabled, true);
    pendingB.resolve(calendarResult("apn_B"));
    await instance.flush();
    assert.match(text(instance.tree), /apn_A-conflicts/);
    assert.match(text(instance.tree), /apn_A-destination/);
    assert.match(text(instance.tree), /Account: Newly authorized account B/);
    assert.equal(checkbox(instance, "apn_B conflicts").props.checked, false);
    assert.equal(destinationSelect(instance).props.value, "");
    assert.equal(button(instance, "Save calendars").props.disabled, true);
    button(instance, "Save calendars").props.onClick();
    await instance.flush();
    assert.ok(!calls.some((call) => call.action === "save"));
    checkbox(instance, "apn_B conflicts").props.onChange({ target: { checked: true } });
    destinationSelect(instance).props.onChange({ target: { value: "apn_B-destination" } });
    await instance.flush();
    assert.equal(
      button(instance, "Save calendars").props.disabled,
      false,
      "B replaces A deliberately, not an editor conflict",
    );
    const staleSave = button(instance, "Save calendars").props.onClick;
    const staleChoose = button(instance, "Choose connected account").props.onClick;
    const staleConnect = button(instance, "Connect to different account").props.onClick;
    instance.render({
      ...props,
      readiness: {
        ...props.readiness,
        calendarConnection: {
          ...props.readiness.calendarConnection,
          reason: "verification_unknown",
        },
      },
    });
    await instance.flush();
    assert.equal(button(instance, "Save calendars").props.disabled, true);
    assert.equal(checkbox(instance, "apn_B conflicts").props.checked, true);
    assert.equal(destinationSelect(instance).props.value, "apn_B-destination");
    const unknownCalls = calls.length;
    staleSave();
    staleChoose();
    staleConnect();
    button(instance, "Retry calendar status").props.onClick();
    await instance.flush();
    assert.equal(
      calls.length,
      unknownCalls,
      "unknown status and stale callbacks permit only fact/config GETs",
    );
    instance.render(props);
    await instance.flush();
    assert.equal(button(instance, "Save calendars").props.disabled, false);
    button(instance, "Save calendars").props.onClick();
    await instance.flush();
    assert.deepEqual(calls.find((call) => call.action === "save").data, {
      websiteId,
      accountId: "apn_B",
      expectedRevision: 4,
      expectedSetupKey: key,
      blockingCalendarIds: ["apn_B-conflicts"],
      destinationCalendarId: "apn_B-destination",
    });

    button(instance, "Choose connected account").props.onClick();
    await instance.flush();
    const slowB = deferred(),
      fastC = deferred();
    fixture.calendars = ({ data }) => {
      calls.push({ action: "calendars", data: structuredClone(data) });
      return data.accountId === "apn_B" ? slowB.promise : fastC.promise;
    };
    accountSelect(instance).props.onChange({ target: { value: "apn_B" } });
    await instance.flush();
    assert.equal(accountSelect(instance).props.disabled, false);
    accountSelect(instance).props.onChange({ target: { value: "apn_C" } });
    await instance.flush();
    fastC.resolve(calendarResult("apn_C"));
    await instance.flush();
    slowB.resolve(calendarResult("apn_B"));
    await instance.flush();
    assert.match(text(instance.tree), /Account: Account C/);
    assert.equal(checkbox(instance, "apn_B conflicts"), undefined);
    assert.equal(destinationSelect(instance).props.value, "");
    const currentCalls = calls.length;
    staleSave();
    await instance.flush();
    assert.equal(
      calls.length,
      currentCalls,
      "B's old save callback cannot replace the explicitly chosen C",
    );
    const oldSelect = accountSelect(instance).props.onChange;
    fixture.accountConfig = { ...fixture.accountConfig, connectionRevision: 5 };
    instance.render({
      ...props,
      readiness: {
        ...props.readiness,
        calendarConnection: { ...props.readiness.calendarConnection, connectionRevision: 5 },
      },
    });
    await instance.flush();
    const fencedCalls = calls.length;
    oldSelect({ target: { value: "apn_B" } });
    staleSave();
    await instance.flush();
    assert.equal(calls.length, fencedCalls, "stale selection/save cannot cross revision changes");
    assert.equal(accountSelect(instance).props.disabled, true);
    instance.unmount();
    assert.equal(instance.lateWrites, 0);

    fixture.accountConfig = { ...fixture.accountConfig, connectionRevision: 4 };
    for (const patch of [
      { isOwner: false },
      { statusUnknown: true },
      { readiness: { ...props.readiness, entitlementUnavailable: true } },
      { readiness: { ...props.readiness, plan: "starter" } },
    ]) {
      const blocked = mount(StepTwoCard, { ...props, ...patch });
      await blocked.flush();
      const entry = button(blocked, "Choose connected account");
      assert.ok(!entry || entry.props.disabled);
      const count = calls.length;
      entry?.props.onClick();
      await blocked.flush();
      assert.equal(calls.length, count);
      blocked.unmount();
    }
  }
  console.log(
    "PASS R2: explicit account B selection from pending/saved A, empty new choices, manual save carries A fences, B/C race and stale/owner/Pro/unknown guards",
  );
}

async function testScheduleRecovery() {
  const { StepThreeCard } = await bundle("src/components/purchaser/SetupStepCards.tsx", {
    "@/lib/booking-setup.functions": `export const getBookingSetup=input=>globalThis.__bookingUiRecovery.setup(input);
      export const saveBookingAvailability=input=>globalThis.__bookingUiRecovery.saveAvailability(input);`,
    "@/lib/booking-provider.functions": `const forbidden=()=>{throw Error('Google actions forbidden in schedule recovery')};
      export const completeGoogleCalendarConnection=forbidden,discoverGoogleCalendarAccounts=forbidden,
        discoverGoogleCalendars=forbidden,loadGoogleCalendarConfiguration=forbidden,
        refreshGoogleCalendarConnection=forbidden,saveGoogleCalendarSelection=forbidden,startGoogleCalendarConnect=forbidden;`,
    "@/lib/stripe-connect.functions": `const forbidden=()=>{throw Error('Stripe actions forbidden in schedule recovery')};
      export const getStripeConnectStatus=forbidden,openStripeExpressDashboard=forbidden,
        reconcileStripeConnect=forbidden,startStripeConnectOnboarding=forbidden;`,
  });
  const configuration = {
    serviceRevision: 2,
    scheduleRevision: 3,
    service: {
      name: "Saved consultation",
      description: "Existing service details",
      durationMinutes: 60,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      minimumNoticeMinutes: 1440,
      bookingHorizonDays: 60,
      locationType: "customer_address",
      locationInstructions: "Use the front entrance",
      amountMinor: 12550,
      currency: "USD",
      paymentPolicy: "full_amount",
    },
    timeZone: "America/Los_Angeles",
    intervals: [{ weekday: 1, localStart: "09:00", localEnd: "17:00", sortOrder: 0 }],
    overrides: [],
  };
  const calls = [];
  const saves = [];
  let changed = 0;
  const onChanged = async () => changed++;
  fixture.saveAvailability = async ({ data }) => {
    saves.push(structuredClone(data));
    return {
      configuration: {
        ...configuration,
        ...data,
        serviceRevision: data.serviceRevision + 1,
        scheduleRevision: data.scheduleRevision + 1,
      },
    };
  };
  // Reconcile the real child by its actual type/key, including removal and unmount cleanup.
  function mountCard(props) {
    const card = mount(StepThreeCard, props);
    const render = card.render,
      flush = card.flush,
      unmount = card.unmount;
    card.editor = null;
    card.render = (next = card.props) => {
      render(next);
      const element = nodes(card.tree).find((node) => node.type?.name === "AvailabilityEditor");
      if (!element || element.type !== card.editor?.component || element.key !== card.editorKey) {
        card.editor?.unmount();
        card.editor = null;
      }
      if (element) {
        if (card.editor) card.editor.render(element.props);
        else card.editor = mount(element.type, element.props);
        card.editorKey = element.key;
      }
    };
    card.flush = async () => {
      await flush();
      await card.editor?.flush();
      await flush();
      await card.editor?.flush();
    };
    card.unmount = () => {
      card.editor?.unmount();
      unmount();
    };
    card.render();
    return card;
  }
  const field = (editor, id) => nodes(editor.tree).find((node) => node.props.id === id);
  const hours = (editor) =>
    nodes(editor.tree).find((node) => node.props["aria-label"] === "Monday start");
  const notice = (editor) => {
    const element = nodes(editor.tree).find(
      (node) => node.type?.name === "NumberField" && node.props.label === "Minimum notice (hours)",
    );
    return nodes(element.type(element.props)).find((node) => node.type === "Input");
  };
  const fieldset = (editor) => nodes(editor.tree).find((node) => node.type === "fieldset");
  const edit = (editor, id, value) => field(editor, id).props.onChange({ target: { value } });
  fixture.setup = async ({ data }) => {
    calls.push(data);
    throw new Error("Transient schedule read failure");
  };
  const props = { websiteId, locked: false, onChanged };
  const instance = mountCard(props);
  assert.match(text(instance.tree), /Loading schedule/);
  await instance.flush();
  assert.deepEqual(calls, [{ websiteId }]);
  assert.match(text(instance.tree), /Unable to load the schedule\. Saved settings are unchanged/);
  assert.doesNotMatch(text(instance.tree), /Loading schedule/);
  assert.equal(instance.editor, null);
  instance.render({ ...props });
  await instance.flush();
  assert.equal(calls.length, 1, "an overview rerender cannot retry a failed schedule read");

  const retry = deferred();
  fixture.setup = ({ data }) => {
    calls.push(data);
    return retry.promise;
  };
  button(instance, "Retry schedule").props.onClick();
  await instance.flush();
  assert.deepEqual(calls, [{ websiteId }, { websiteId }]);
  assert.match(text(instance.tree), /Loading schedule/);
  assert.equal(button(instance, "Retry schedule"), undefined);
  retry.resolve({ configuration });
  await instance.flush();
  assert.doesNotMatch(text(instance.tree), /Unable to load the schedule|Loading schedule/);
  const editor = instance.editor;
  assert.equal(editor.component.name, "AvailabilityEditor");
  assert.equal(editor.props.websiteId, websiteId);
  assert.equal(
    editor.props.initial,
    configuration,
    "saved revisions, hours and price pass through intact",
  );
  assert.equal(field(editor, "service-name").props.value, configuration.service.name);
  assert.equal(field(editor, "price").props.value, "125.50");
  assert.equal(hours(editor).props.value, "09:00");
  assert.equal(editor.tree.type, "TooltipProvider");
  assert.equal(editor.tree.props.delayDuration, 200);
  assert.equal(notice(editor).props.value, 24, "saved minutes display as hours");
  assert.equal(notice(editor).props.min, "0");
  assert.equal(notice(editor).props.step, "1");
  assert.ok(!nodes(editor.tree).some((node) => /^Buffer /.test(node.props.label ?? "")));
  assert.match(text(instance.tree), /Save hours and price to unlock Stripe/);
  assert.match(
    text(editor.tree),
    /These changes will show on your live website for your customers\. You can come back and change them here anytime\./,
  );
  assert.match(
    text(editor.tree),
    /Calendar conflicts are not shown in this provider-independent preview\./,
  );
  assert.doesNotMatch(text(editor.tree), /Google Calendar is verified/);
  for (const [value, expected] of [
    ["1.4", 1],
    ["1.5", 2],
    ["-1", 0],
    ["not-a-number", 0],
    ["Infinity", 0],
    ["", 0],
    ["0", 0],
    ["24", 24],
  ]) {
    notice(editor).props.onChange({ target: { value } });
    await instance.flush();
    assert.equal(notice(editor).props.value, expected, `whole-hour notice conversion: ${value}`);
    assert.ok(Number.isInteger(notice(editor).props.value));
  }
  assert.equal(fieldset(editor).props.disabled, false);
  assert.equal(button(editor, "Save and continue").props.disabled, true);
  assert.equal(changed, 0, "loading settings is not a save");
  instance.render({ ...props });
  await instance.flush();
  assert.equal(calls.length, 2, "successful settings are not refetched on rerender");
  const locked = mountCard({ ...props, locked: true });
  await locked.flush();
  assert.equal(locked.tree.props["aria-disabled"], "true");
  assert.match(text(locked.tree), /Hours and price stay locked until Step 2 is connected/);
  assert.doesNotMatch(text(locked.tree), /buffers/);
  assert.equal(calls.length, 2, "locked setup cannot load a schedule");
  assert.equal(locked.editor, null, "never-loaded locked setup stays unchanged");
  locked.unmount();

  edit(editor, "service-name", "Keep this unsaved appointment");
  edit(editor, "price", "175.");
  hours(editor).props.onChange({ target: { value: "10:15" } });
  await instance.flush();
  const oldSave = button(editor, "Save and continue").props.onClick;
  const toggleMonday = nodes(editor.tree).find(
    (node) => node.type === "Switch" && node.props["aria-label"] === "Enable Monday",
  ).props.onCheckedChange;
  instance.render({ ...props, locked: true });
  await instance.flush();
  assert.equal(
    instance.editor,
    editor,
    "completed disconnect must not unmount the availability draft",
  );
  assert.equal(fieldset(editor).props.disabled, true);
  assert.equal(button(editor, "Save and continue").props.disabled, true);
  assert.equal(
    field(editor, "price").props.value,
    "175.",
    "editing text, including the decimal point, is retained",
  );
  oldSave();
  toggleMonday(false);
  await instance.flush();
  assert.equal(saves.length, 0);
  assert.equal(hours(editor).props.value, "10:15");
  const reloaded = deferred();
  fixture.setup = ({ data }) => {
    calls.push(data);
    return reloaded.promise;
  };
  instance.render(props);
  await instance.flush();
  assert.equal(instance.editor, editor);
  assert.equal(
    fieldset(editor).props.disabled,
    true,
    "unlock cannot save with the pre-reload revision",
  );
  oldSave();
  await instance.flush();
  assert.equal(saves.length, 0);
  const newer = {
    ...structuredClone(configuration),
    serviceRevision: 4,
    scheduleRevision: 5,
    service: { ...configuration.service, name: "Changed elsewhere", amountMinor: 20000 },
  };
  reloaded.resolve({ configuration: newer });
  await instance.flush();
  assert.equal(field(editor, "service-name").props.value, "Keep this unsaved appointment");
  assert.equal(field(editor, "price").props.value, "175.");
  assert.equal(hours(editor).props.value, "10:15");
  assert.match(text(editor.tree), /Settings changed.*Your edits are still here/);
  assert.equal(fieldset(editor).props.disabled, false);
  fixture.saveAvailability = async ({ data }) => {
    saves.push(structuredClone(data));
    throw Error("REVISION_CONFLICT");
  };
  button(editor, "Save and continue").props.onClick();
  await instance.flush();
  assert.equal(
    saves.at(-1).serviceRevision,
    2,
    "a dirty draft must not silently rebase onto new authority",
  );
  assert.equal(saves.at(-1).scheduleRevision, 3);
  assert.equal(saves.at(-1).service.amountMinor, 17500);
  assert.equal(saves.at(-1).service.bufferBeforeMinutes, 0);
  assert.equal(saves.at(-1).service.bufferAfterMinutes, 0);
  assert.equal(changed, 0);
  assert.match(text(editor.tree), /Settings changed/);

  instance.render({ ...props, locked: true });
  await instance.flush();
  fixture.setup = async () => {
    throw Error("Schedule unavailable again");
  };
  instance.render(props);
  await instance.flush();
  assert.equal(instance.editor, editor);
  assert.equal(fieldset(editor).props.disabled, true);
  assert.equal(field(editor, "price").props.value, "175.");
  assert.match(text(instance.tree), /Unable to load the schedule/);
  const recover = deferred();
  fixture.setup = () => recover.promise;
  button(instance, "Retry schedule").props.onClick();
  await instance.flush();
  assert.equal(fieldset(editor).props.disabled, true);
  recover.resolve({ configuration: newer });
  await instance.flush();
  assert.equal(instance.editor, editor);
  assert.equal(field(editor, "price").props.value, "175.");
  assert.equal(fieldset(editor).props.disabled, false);
  // Returning to pristine permits the fresh server configuration, not a stale remount baseline.
  edit(editor, "service-name", configuration.service.name);
  edit(editor, "price", "125.50");
  hours(editor).props.onChange({ target: { value: "09:00" } });
  await instance.flush();
  assert.equal(field(editor, "service-name").props.value, newer.service.name);
  assert.equal(field(editor, "price").props.value, "200.00");
  assert.equal(button(editor, "Save and continue").props.disabled, true);
  assert.doesNotMatch(text(editor.tree), /Settings changed/);

  const pristineReload = deferred();
  instance.render({ ...props, locked: true });
  await instance.flush();
  fixture.setup = () => pristineReload.promise;
  instance.render(props);
  await instance.flush();
  assert.equal(fieldset(editor).props.disabled, true);
  const latest = {
    ...newer,
    serviceRevision: 6,
    scheduleRevision: 7,
    service: { ...newer.service, name: "Current consultation", amountMinor: 22525 },
  };
  pristineReload.resolve({ configuration: latest });
  await instance.flush();
  assert.equal(field(editor, "service-name").props.value, latest.service.name);
  assert.equal(field(editor, "price").props.value, "225.25");
  edit(editor, "service-name", "Normal saved appointment");
  edit(editor, "price", "250.75");
  notice(editor).props.onChange({ target: { value: "36" } });
  await instance.flush();
  const saved = deferred();
  fixture.saveAvailability = ({ data }) => {
    saves.push(structuredClone(data));
    return saved.promise;
  };
  const normalSave = button(editor, "Save and continue").props.onClick;
  normalSave();
  normalSave();
  await instance.flush();
  assert.equal(saves.length, 2, "normal save is single-flight");
  assert.equal(fieldset(editor).props.disabled, true);
  assert.deepEqual(saves.at(-1), {
    websiteId,
    serviceRevision: 6,
    scheduleRevision: 7,
    service: {
      ...latest.service,
      name: "Normal saved appointment",
      amountMinor: 25075,
      minimumNoticeMinutes: 2160,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    },
    timeZone: latest.timeZone,
    intervals: latest.intervals,
    overrides: latest.overrides,
  });
  const stored = {
    ...latest,
    serviceRevision: 7,
    scheduleRevision: 8,
    service: saves.at(-1).service,
  };
  saved.resolve({ configuration: stored });
  await instance.flush();
  assert.equal(changed, 1);
  assert.equal(text(nodes(editor.tree).find((node) => node.type === "AlertTitle")), "Saved");
  assert.match(text(editor.tree), /Your booking settings are saved\./);
  assert.equal(field(editor, "price").props.value, "250.75");
  assert.equal(notice(editor).props.value, 36, "saved notice minutes round-trip back to hours");
  assert.equal(latest.service.bufferBeforeMinutes, 15, "legacy settings are not mutated in place");
  assert.equal(latest.service.bufferAfterMinutes, 15);
  assert.equal(button(editor, "Save and continue").props.disabled, true);
  instance.render(props);
  await instance.flush();
  assert.equal(
    field(editor, "service-name").props.value,
    stored.service.name,
    "parent's old initial must not roll back the save result",
  );

  const nextSite = deferred();
  fixture.setup = () => nextSite.promise;
  instance.render({ ...props, websiteId: otherWebsiteId });
  assert.equal(instance.editor, null, "site switch must not show or save the other site's initial");
  assert.equal(editor.mounted, false);
  oldSave();
  normalSave();
  assert.equal(saves.length, 2);
  nextSite.resolve({ configuration });
  await instance.flush();
  assert.notEqual(instance.editor, editor);
  assert.equal(instance.editor.props.websiteId, otherWebsiteId);
  assert.equal(field(instance.editor, "price").props.value, "125.50");
  instance.unmount();
  assert.equal(editor.lateWrites, 0);

  const obsoleteLoad = deferred(),
    currentLoad = deferred();
  fixture.setup = () => obsoleteLoad.promise;
  const racing = mountCard(props);
  racing.render({ ...props, locked: true });
  await racing.flush();
  assert.equal(racing.editor, null);
  fixture.setup = () => currentLoad.promise;
  racing.render(props);
  await racing.flush();
  currentLoad.resolve({ configuration: latest });
  await racing.flush();
  const currentEditor = racing.editor;
  obsoleteLoad.resolve({ configuration });
  await racing.flush();
  assert.equal(racing.editor, currentEditor);
  assert.equal(field(currentEditor, "service-name").props.value, latest.service.name);
  assert.equal(field(currentEditor, "price").props.value, "225.25");
  racing.unmount();

  const late = deferred();
  fixture.setup = () => late.promise;
  const gone = mountCard(props);
  gone.unmount();
  late.resolve({ configuration });
  await gone.flush();
  assert.equal(gone.lateWrites, 0);
  for (const outcome of ["saved", "error", "saved-reload-required", "status-error"]) {
    fixture.setup = async () => ({ configuration });
    const status = deferred();
    const card = mountCard({ ...props, onChanged: () => status.promise });
    await card.flush();
    edit(card.editor, "price", "300.");
    await card.flush();
    const pendingSave = deferred();
    fixture.saveAvailability = () => pendingSave.promise;
    button(card.editor, "Save and continue").props.onClick();
    await card.flush();
    const child = card.editor;
    if (outcome === "status-error") {
      pendingSave.resolve({ configuration: stored });
      await card.flush();
    }
    card.unmount();
    if (outcome === "saved") pendingSave.resolve({ configuration: stored });
    else if (outcome === "status-error") status.reject(Error("Overview unavailable"));
    else
      pendingSave.reject(
        Error(
          outcome === "saved-reload-required"
            ? "AVAILABILITY_SAVED_RELOAD_REQUIRED"
            : "Save unavailable",
        ),
      );
    await child.flush();
    assert.equal(child.lateWrites, 0, outcome);
    assert.equal(card.lateWrites, 0, outcome);
  }
  fixture.setup = async () => ({ configuration });
  const failedSave = mountCard(props);
  await failedSave.flush();
  edit(failedSave.editor, "price", "300.");
  await failedSave.flush();
  fixture.saveAvailability = async () => {
    throw Error("Save unavailable");
  };
  button(failedSave.editor, "Save and continue").props.onClick();
  await failedSave.flush();
  assert.equal(field(failedSave.editor, "price").props.value, "300.");
  assert.equal(fieldset(failedSave.editor).props.disabled, false);
  assert.match(text(failedSave.editor.tree), /Unable to save/);
  fixture.saveAvailability = async () => {
    throw Error("AVAILABILITY_SAVED_RELOAD_REQUIRED");
  };
  button(failedSave.editor, "Save and continue").props.onClick();
  await failedSave.flush();
  assert.equal(field(failedSave.editor, "price").props.value, "300.");
  assert.equal(fieldset(failedSave.editor).props.disabled, true);
  assert.match(text(failedSave.editor.tree), /Saved; reload required/);
  failedSave.unmount();
  assert.equal(fixture.listeners.get("beforeunload")?.size ?? 0, 0);
  console.log(
    "PASS H5/Step 3: drafts survive lock/retry/conflicts; pristine revisions reconcile; tooltip boundary, whole-hour notice round-trip/invalid input, zero legacy buffers and saved copy; site/unmount fences preserved",
  );
}

async function testOverviewRefresh() {
  const { PurchaserOverview } = await bundle("src/components/purchaser/PurchaserOverview.tsx", {
    "@tanstack/react-router": `export const Link='Link',useNavigate=()=>()=>{throw Error('Navigation forbidden')};`,
    "@/lib/template-purchase.functions": `export const getPurchaserOverview=input=>globalThis.__bookingUiRecovery.overview(input);
      export const getActiveTemplatePersonalization=()=>{throw Error('Step 1 action forbidden')},runTemplatePersonalization=getActiveTemplatePersonalization;`,
    "@/lib/booking-setup.functions": `export const acknowledgeBookingOrder=()=>{throw Error('Order action forbidden')};`,
    "@/lib/jobs.functions": `export const getJobProgress=()=>{throw Error('Job read forbidden')};`,
    "@/lib/agent/fetch-agent-message": `export const fetchAgentMessage=()=>{throw Error('Agent action forbidden')};`,
    "@/lib/supabase-browser": `export const supabaseBrowser={auth:{signOut:()=>{throw Error('Sign out forbidden')}}};`,
    "./EngagementCards": componentStub("AppointmentsCard", "BookingsCard"),
    "./SetupStepCards": componentStub("StepTwoCard", "StepThreeCard", "StepFourCard"),
  });
  const overview = {
    mode: "contractor",
    plan: "pro",
    orderConfirmed: true,
    profile: { businessName: "Saved business", licenseNumber: "FIXTURE" },
    liveUrl: `/lp/${websiteId}`,
    draft: { exists: true },
    readiness: {
      websiteId,
      profileId,
      environment: "test",
      plan: "pro",
      orderConfirmed: true,
      calendar: "restricted",
      availability: "configured",
      payments: "ready",
      reasonCodes: ["booking_readiness_unknown"],
      calendarConnection: {
        ...connection,
        accountId: "apn_A",
        configured: true,
        reason: "verification_unknown",
      },
    },
  };
  const timers = new Map(),
    visibilityListeners = new Set();
  const originalTimeout = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  let reads = 0;
  fixture.overview = async ({ data }) => {
    assert.deepEqual(data, { websiteId });
    reads++;
    return structuredClone(overview);
  };
  // Plain listener records and visibility state, not a DOM or browser renderer.
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (name, fn) => {
      assert.equal(name, "visibilitychange");
      visibilityListeners.add(fn);
    },
    removeEventListener: (name, fn) => {
      assert.equal(name, "visibilitychange");
      visibilityListeners.delete(fn);
    },
  };
  globalThis.window.location.hash = "";
  globalThis.setTimeout = (fn, ms) => {
    assert.equal(ms, 10_000);
    const id = {};
    timers.set(id, fn);
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  let instance;
  try {
    instance = mount(PurchaserOverview, { userId: profileId, websiteId });
    await instance.flush();
    const step = (name) => nodes(instance.tree).find((node) => node.type === name);
    const prior = nodes(instance.tree).find((node) => node.props.overview).props.overview;
    assert.equal(reads, 1);
    assert.equal(step("StepTwoCard").props.statusUnknown, true);
    assert.equal(step("StepThreeCard").props.locked, false);
    assert.equal(step("StepFourCard").props.onboardingReady, false);
    assert.equal(timers.size, 1, "partial Google facts retain bounded display polling");
    const failure = deferred();
    fixture.overview = () => {
      reads++;
      return failure.promise;
    };
    for (const listener of fixture.listeners.get("focus")) {
      listener();
      listener();
    }
    await instance.flush();
    assert.equal(reads, 2, "focus reads remain single-flight");
    failure.reject(Error("Entitlement read failed"));
    await instance.flush();
    assert.equal(nodes(instance.tree).find((node) => node.props.overview).props.overview, prior);
    assert.equal(step("StepTwoCard").props.statusUnknown, true);
    document.visibilityState = "hidden";
    for (const listener of visibilityListeners) listener();
    await instance.flush();
    assert.equal(reads, 2);
    document.visibilityState = "visible";
    const ready = {
      ...overview,
      readiness: {
        ...overview.readiness,
        calendar: "ready",
        reasonCodes: [],
        calendarConnection: {
          ...overview.readiness.calendarConnection,
          healthState: "healthy",
          reason: null,
          triggerState: "active",
        },
      },
    };
    fixture.overview = async () => {
      reads++;
      return ready;
    };
    for (const listener of visibilityListeners) listener();
    await instance.flush();
    assert.equal(reads, 3);
    assert.equal(step("StepTwoCard").props.statusUnknown, false);
    assert.equal(step("StepFourCard").props.onboardingReady, true);
    assert.equal(timers.size, 0);
    const late = deferred();
    fixture.overview = () => late.promise;
    for (const listener of fixture.listeners.get("focus")) listener();
    instance.unmount();
    late.reject(Error("Unmounted overview failed"));
    await instance.flush();
    assert.equal(instance.lateWrites, 0);
    assert.equal(visibilityListeners.size, 0);
    assert.equal(fixture.listeners.get("focus").size, 0);
    assert.equal(timers.size, 0);
  } finally {
    if (instance?.mounted) instance.unmount();
    globalThis.setTimeout = originalTimeout;
    globalThis.clearTimeout = originalClear;
    delete globalThis.document;
  }
  console.log(
    "PASS H5/R16: actual overview unknown props, focus/visibility GET refresh, prior state on authority failure, recovery and unmount cleanup; no DOM",
  );
}

const available = {
  slots: [
    {
      startAt: "2026-10-01T10:00:00Z",
      endAt: "2026-10-01T11:00:00Z",
      localDate: "2026-10-01",
      localStart: "10:00",
    },
  ],
  observedAt: "2026-09-11T10:00:00Z",
  availabilityGeneration: 4,
  calendarSetHash: "a".repeat(64),
  timeZone: "UTC",
  service: { name: "Visit", amountMinor: 12000, currency: "USD" },
};

async function testSlots() {
  const shared = await build({
    entryPoints: [path.resolve("src/lib/booking-checkout.ts")],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    alias: { "@": path.resolve("src") },
  });
  assert.ok(
    Object.keys(shared.metafile.inputs).every(
      (file) => !/\.server\.|\.functions\.|node:/.test(file),
    ),
    "shared checkout schemas must be browser-safe, with no server helper import",
  );
  const { LiveBookingDialog } = await bundle("src/components/booking/LiveBookingDialog.tsx", {
    "@/lib/booking-attachments.functions": `export const getBookingAttachmentCapability=async()=>({enabled:true});`,
  });
  let reads = 0,
    closes = 0;
  fixture.slots = async () => {
    reads++;
    throw new Error("Temporary availability failure");
  };
  const props = { websiteId, open: true, onOpenChange: () => closes++ };
  const instance = mount(LiveBookingDialog, props);
  assert.doesNotMatch(text(instance.tree), /No appointments/);
  await instance.flush();
  assert.equal(reads, 1);
  assert.match(text(instance.tree), /could not be loaded/);
  assert.doesNotMatch(text(instance.tree), /No appointments/);
  const pending = deferred();
  fixture.slots = async ({ data }) => {
    reads++;
    assert.equal(data.websiteId, websiteId);
    assert.equal(data.dayCount, 14);
    return pending.promise;
  };
  const retry = button(instance, "Retry available times").props.onClick;
  retry();
  retry();
  await instance.flush();
  assert.equal(reads, 2);
  assert.equal(button(instance, "Refresh available times").props.disabled, true);
  retry();
  await instance.flush();
  assert.equal(reads, 2, "a retained retry callback cannot supersede the active slot read");
  pending.resolve(available);
  await instance.flush();
  assert.doesNotMatch(text(instance.tree), /could not be loaded/);
  const slot = nodes(instance.tree).find((node) => node.key === available.slots[0].startAt);
  slot.props.onClick();
  await instance.flush();
  assert.ok(nodes(instance.tree).some((node) => node.type === "form"));
  instance.render(props);
  await instance.flush();
  assert.equal(reads, 2, "form rerenders never fetch slots or replace customer fields");
  assert.equal(button(instance, "Refresh available times"), undefined);
  assert.equal(nodes(instance.tree).find((node) => node.type === "fieldset").props.disabled, false);
  button(instance, "Back").props.onClick();
  await instance.flush();
  assert.ok(
    !nodes(instance.tree).some((node) => node.type === "form"),
    "before dispatch the customer can change time",
  );
  slot.props.onClick();
  await instance.flush();

  const checkout = deferred();
  const requests = [];
  fixture.checkout = async ({ data }) => {
    requests.push(structuredClone(data));
    return checkout.promise;
  };
  const image = new File(["fixture-image"], "original.png", { type: "image/png" });
  const readImage = image.arrayBuffer.bind(image);
  let imageReads = 0;
  image.arrayBuffer = () => {
    imageReads++;
    return readImage();
  };
  const formValues = {
    name: "Customer Name",
    email: "customer@example.test",
    phone: "5551234567",
    line1: "10 Test St",
    city: "Test City",
    region: "CA",
    postalCode: "90000",
    notes: "Keep my details",
    bookingConsent: "accepted",
    attachments: [image],
  };
  const event = { preventDefault() {}, currentTarget: formValues };
  const submit = nodes(instance.tree).find((node) => node.type === "form").props.onSubmit;
  const back = button(instance, "Back").props.onClick;
  for (const invalid of [
    { name: "x" },
    { name: "  " },
    { name: "x".repeat(121) },
    { phone: "123" },
    { phone: "x".repeat(41) },
    { email: "not-an-email" },
    { line1: "x" },
    { city: "x" },
    { region: "x" },
    { postalCode: "x" },
    { notes: "x".repeat(2001) },
    { bookingConsent: null },
  ]) {
    await submit({ ...event, currentTarget: { ...formValues, ...invalid } });
    await instance.flush();
    assert.equal(requests.length, 0, "shared validation rejects before dispatch");
    assert.equal(imageReads, 0, "invalid input is caught before file preparation");
    assert.equal(
      nodes(instance.tree).find((node) => node.type === "fieldset").props.disabled,
      false,
    );
    assert.equal(button(instance, "Back").props.disabled, false);
    assert.match(text(instance.tree), /booking request was not sent/);
    assert.doesNotMatch(text(instance.tree), /may already have been received/);
  }
  void submit(event);
  void submit(event);
  await instance.flush();
  assert.equal(requests.length, 1);
  assert.equal(imageReads, 1);
  assert.equal(requests[0].attachments[0].filename, "original.png");
  assert.equal(nodes(instance.tree).find((node) => node.type === "fieldset").props.disabled, true);
  back();
  nodes(instance.tree)
    .find((node) => node.type === "Dialog")
    .props.onOpenChange(false);
  await instance.flush();
  assert.equal(closes, 0);
  assert.ok(nodes(instance.tree).some((node) => node.type === "form"));
  checkout.reject(new Error("Checkout response lost"));
  await instance.flush();
  assert.match(text(instance.tree), /same booking request/);
  assert.match(text(instance.tree), /may already have been received/);
  assert.doesNotMatch(text(instance.tree), /go back to choose another/);
  assert.equal(nodes(instance.tree).find((node) => node.type === "fieldset").props.disabled, true);
  assert.equal(button(instance, "Back").props.disabled, true);
  assert.equal(button(instance, "Retry secure payment").props.disabled, false);
  assert.ok(
    !nodes(nodes(instance.tree).find((node) => node.type === "fieldset")).some(
      (node) => node.props.type === "submit",
    ),
    "retry must remain outside the disabled inputs",
  );
  back();
  slot.props.onClick();
  retry();
  await instance.flush();
  assert.equal(reads, 2, "a lost reply cannot refresh the slot or start a new request");
  nodes(instance.tree)
    .find((node) => node.type === "Dialog")
    .props.onOpenChange(false);
  assert.equal(closes, 1, "closing an idle ambiguous dialog is allowed, not cancellation");
  instance.render({ ...props, open: false });
  await instance.flush();
  instance.render(props);
  await instance.flush();
  assert.equal(reads, 2, "reopening preserves the admitted request rather than reloading slots");
  assert.equal(
    nodes(instance.tree).find((node) => node.props.name === "notes").props.defaultValue,
    formValues.notes,
  );
  fixture.checkout = async ({ data }) => {
    requests.push(structuredClone(data));
    return {
      status: "checkout_ready",
      checkoutUrl: "https://checkout.example.test/recovered",
      expiresAt: "2026-10-01T10:30:00.000Z",
    };
  };
  await nodes(instance.tree)
    .find((node) => node.type === "form")
    .props.onSubmit({
      ...event,
      currentTarget: {
        ...formValues,
        notes: "Attempted later edit",
        email: "changed@example.test",
        bookingConsent: null,
        attachments: [new File(["different-image"], "changed.png", { type: "image/png" })],
      },
    });
  await instance.flush();
  assert.deepEqual(
    requests[1],
    requests[0],
    "request ID, evidence, customer and consent survive retry",
  );
  assert.equal(
    imageReads,
    1,
    "retry reuses already prepared file bytes as well as booking identity",
  );
  assert.equal(fixture.redirects.at(-1), "https://checkout.example.test/recovered");
  assert.equal(reads, 2);
  await nodes(instance.tree)
    .find((node) => node.type === "form")
    .props.onSubmit(event);
  assert.equal(requests.length, 2, "navigation handoff keeps checkout single flight until leaving");
  instance.unmount();

  for (const first of [
    undefined,
    null,
    {},
    { status: "not_attempted" },
    { status: "not_attempted", code: "unknown_code" },
    { status: "not_attempted", code: "slot_unavailable", extra: "not part of the contract" },
    { status: "checkout_ready", checkoutUrl: "https://checkout.example.test/malformed" },
    new Error("That time is no longer available"),
  ]) {
    fixture.slots = async () => available;
    const sent = [];
    fixture.checkout = async ({ data }) => {
      sent.push(structuredClone(data));
      if (first instanceof Error) throw first;
      return first;
    };
    const unknown = mount(LiveBookingDialog, props);
    await unknown.flush();
    nodes(unknown.tree)
      .find((node) => node.key === available.slots[0].startAt)
      .props.onClick();
    await unknown.flush();
    const send = (values = formValues) =>
      nodes(unknown.tree)
        .find((node) => node.type === "form")
        .props.onSubmit({ preventDefault() {}, currentTarget: values });
    const redirects = fixture.redirects.length;
    await send();
    await unknown.flush();
    assert.equal(
      fixture.redirects.length,
      redirects,
      "empty/malformed replies are unknown, never a successful handoff",
    );
    assert.equal(nodes(unknown.tree).find((node) => node.type === "fieldset").props.disabled, true);
    assert.match(text(unknown.tree), /may already have been received/);
    for (const code of ["slot_unavailable", "booking_unavailable"]) {
      fixture.checkout = async ({ data }) => {
        sent.push(structuredClone(data));
        return { status: "not_attempted", code };
      };
      await send({
        ...formValues,
        name: "Edited",
        notes: "Must not replace original",
        bookingConsent: null,
      });
      await unknown.flush();
      assert.equal(
        nodes(unknown.tree).find((node) => node.type === "fieldset").props.disabled,
        true,
      );
      assert.equal(button(unknown, "Back").props.disabled, true);
      assert.match(text(unknown.tree), /earlier request may still be processing/);
      assert.doesNotMatch(text(unknown.tree), /No reservation was made/);
      assert.deepEqual(sent.at(-1), sent[0]);
    }
    unknown.unmount();
  }
  for (const code of ["slot_unavailable", "booking_unavailable"]) {
    fixture.slots = async () => available;
    const sent = [];
    fixture.checkout = async ({ data }) => {
      sent.push(structuredClone(data));
      return { status: "not_attempted", code };
    };
    const rejected = mount(LiveBookingDialog, props);
    await rejected.flush();
    nodes(rejected.tree)
      .find((node) => node.key === available.slots[0].startAt)
      .props.onClick();
    await rejected.flush();
    const send = (values) =>
      nodes(rejected.tree)
        .find((node) => node.type === "form")
        .props.onSubmit({ preventDefault() {}, currentTarget: values });
    await send(formValues);
    await rejected.flush();
    assert.match(text(rejected.tree), /No reservation was made/);
    assert.equal(
      nodes(rejected.tree).find((node) => node.type === "fieldset").props.disabled,
      false,
    );
    assert.equal(button(rejected, "Back").props.disabled, false);
    assert.equal(button(rejected, "Retry secure payment"), undefined);
    fixture.checkout = async ({ data }) => {
      sent.push(structuredClone(data));
      return {
        status: "checkout_ready",
        checkoutUrl: "https://checkout.example.test/corrected",
        expiresAt: "2026-10-01T10:30:00.000Z",
      };
    };
    await send({ ...formValues, notes: "Safe edit after refusal" });
    await rejected.flush();
    assert.equal(sent[1].customer.notes, "Safe edit after refusal");
    assert.equal(fixture.redirects.at(-1), "https://checkout.example.test/corrected");
    rejected.unmount();
  }

  const old = deferred();
  fixture.slots = () => old.promise;
  const switched = mount(LiveBookingDialog, props);
  await switched.flush();
  fixture.slots = async () => ({ ...available, slots: [] });
  switched.render({ ...props, websiteId: otherWebsiteId });
  await switched.flush();
  old.resolve(available);
  await switched.flush();
  assert.match(text(switched.tree), /No appointments/);
  assert.ok(!nodes(switched.tree).some((node) => node.key === available.slots[0].startAt));
  const gone = deferred();
  fixture.slots = () => gone.promise;
  button(switched, "Refresh available times").props.onClick();
  await switched.flush();
  switched.unmount();
  gone.resolve(available);
  await switched.flush();
  assert.equal(switched.lateWrites, 0);
  for (const boundary of ["unmount", "site-switch"]) {
    fixture.slots = async () => available;
    const pendingCheckout = deferred();
    let dispatched = 0;
    fixture.checkout = () => {
      dispatched++;
      return pendingCheckout.promise;
    };
    const active = mount(LiveBookingDialog, props);
    await active.flush();
    nodes(active.tree)
      .find((node) => node.key === available.slots[0].startAt)
      .props.onClick();
    await active.flush();
    const oldSubmit = nodes(active.tree).find((node) => node.type === "form").props.onSubmit;
    const sending = oldSubmit(event);
    await active.flush();
    assert.equal(dispatched, 1);
    if (boundary === "unmount") active.unmount();
    else {
      active.render({ ...props, websiteId: otherWebsiteId });
      await active.flush();
    }
    pendingCheckout.reject(Error("Old checkout response lost"));
    await sending;
    await oldSubmit(event);
    await active.flush();
    assert.equal(active.lateWrites, 0);
    assert.equal(
      dispatched,
      1,
      "old request callbacks cannot dispatch from a different or unmounted site",
    );
    if (active.mounted) {
      assert.doesNotMatch(text(active.tree), /may already have been received/);
      assert.ok(!nodes(active.tree).some((node) => node.type === "form"));
      active.unmount();
    }
  }
  console.log(
    "PASS R19 slots: validation and first definite refusal allow correction; lost/malformed responses stay frozen through later refusal, exact retry and scope cleanup preserved",
  );
}

function publicSite(template) {
  return {
    config: {
      kind: "template",
      templateSlug: template,
      identity: {
        businessName: "Test Business",
        licenseNumber: "MOCK",
        city: "Oakland",
        phone: "+15551234567",
        email: "owner@example.test",
      },
      text: {
        heroTitle: `Fixture ${template} services`,
        heroSub: "Schedule a visit with our local team.",
      },
      media: {},
      reviews: [],
      blogs: [],
      contact: {
        phone: "+15551234567",
        email: "owner@example.test",
        area: "Oakland",
        hours: "Weekdays",
      },
    },
    websiteId,
    versionId: "version-a",
    templateMedia: {},
    showBookingPay: false,
    liveBooking: false,
    showBuyCta: false,
    showDemoChrome: false,
    bookingConfigurationPending: false,
    bookingRetryAvailable: true,
    entitlementUnavailable: false,
    showLeadForm: true,
    isLive: true,
    hasLicenseConfigured: true,
  };
}

async function testPublicSite() {
  const moldNames = {
    landscape: "LandscapeTemplatePage",
    plumber: "PlumberTemplatePage",
    painter: "PainterTemplatePage",
    painter1: "PainterOneTemplatePage",
    painter2: "PainterTwoTemplatePage",
    painter3: "PainterThreeTemplatePage",
    painter4: "PainterFourTemplatePage",
    painter5: "PainterFiveTemplatePage",
    painter6: "PainterSixTemplatePage",
    painter7: "PainterSevenTemplatePage",
    painter8: "PainterEightTemplatePage",
    painter10: "PainterTenTemplatePage",
    painter11: "PainterElevenTemplatePage",
    painter12: "PainterTwelveTemplatePage",
    painter13: "PainterThirteenTemplatePage",
    painter14: "PainterFourteenTemplatePage",
    painter15: "PainterFifteenTemplatePage",
    painter16: "PainterSixteenTemplatePage",
    painter17: "PainterSeventeenTemplatePage",
    painter18: "PainterEighteenTemplatePage",
  };
  const { TEMPLATE_PURCHASE_SLUGS } = await bundle("src/lib/template-content/overlay.ts");
  const { resolveTemplatePageView } = await bundle("src/lib/template-content/templates.ts");
  // Exercise the actual registry's lazy selection without importing unrelated mold UI.
  const registry = await bundle(
    "src/components/templates/molds.tsx",
    Object.fromEntries(Object.values(moldNames).map((name) => [`./${name}`, componentStub(name)])),
  );
  assert.deepEqual(
    Object.keys(registry.MOLD_COMPONENTS).sort(),
    [...TEMPLATE_PURCHASE_SLUGS].sort(),
  );
  fixture.molds = {};
  for (const slug of TEMPLATE_PURCHASE_SLUGS) {
    const selected = registry.moldComponentFor(slug);
    assert.equal(selected, registry.MOLD_COMPONENTS[slug]);
    const { default: name } = await selected.load();
    assert.equal(name, moldNames[slug], `registry chooses the ${slug} mold, not another template`);
    fixture.molds[slug] = name;
  }
  assert.equal(registry.moldComponentFor("not-purchased"), null);

  const { Route } = await bundle("src/routes/lp/$websiteId.tsx", {
    "@/components/templates/molds": `export const moldComponentFor=slug=>{
      const f=globalThis.__bookingUiRecovery;f.selectedSlugs.push(slug);return f.molds[slug]??null;
    };`,
    "@/components/site-renderer/DemoLicenseGate": componentStub("DemoLicenseGate"),
    "@/components/site-renderer/DemoLpChrome": componentStub("DemoLpChrome"),
    "@/components/site-renderer/ContractorSiteView": componentStub("ContractorSiteView"),
    "@/components/site-renderer/SiteBookingPayDemo": componentStub("SiteBookingPayDemo"),
    "@/integrations/supabase/client.server": `export const supabaseAdmin={from(){throw Error('DB forbidden')}};`,
    "@/lib/auth/preview-token.server": `export const isValidOwnerPreviewToken=()=>{throw Error('Token lookup forbidden')};`,
    "@/lib/media/site-media.server": `export const resolveSiteMediaInConfig=()=>{throw Error('Media lookup forbidden')};`,
    "@/lib/template-purchase.server": `export const resolveTemplateOverlayMedia=()=>{throw Error('Overlay lookup forbidden')};`,
    "@/lib/booking-availability.server": `export const loadPublicBookingReadiness=()=>{throw Error('Only router invalidation is allowed')};`,
  });
  for (const slug of TEMPLATE_PURCHASE_SLUGS) {
    fixture.loader = publicSite(slug);
    fixture.matchId = `lp/${slug}/version-a`;
    fixture.selectedSlugs = [];
    const view = resolveTemplatePageView(fixture.loader.config, fixture.loader.templateMedia);
    assert.equal(view.slug, slug);
    assert.equal(view.content.text.heroTitle, fixture.loader.config.text.heroTitle);
    assert.equal(view.content.businessName, fixture.loader.config.identity.businessName);
    assert.equal(view.content.phone, fixture.loader.config.contact.phone);
    assert.equal(view.content.email, fixture.loader.config.contact.email);
    const instance = mount(Route.component);
    await instance.flush();
    assert.ok(fixture.selectedSlugs.length > 0);
    assert.ok(fixture.selectedSlugs.every((selected) => selected === slug));
    const mold = nodes(instance.tree).find((node) => node.type === moldNames[slug]);
    assert.deepEqual(mold.props.content, view.content);
    assert.equal(mold.props.bookingMode, "disabled");
    assert.equal(typeof mold.props.onOpenBooking, "function");
    assert.ok(!nodes(instance.tree).some((node) => node.type === "ContractorSiteView"));
    assert.equal(
      instance.tree.props.className,
      "min-h-dvh",
      "template pages retain document scrolling",
    );
    instance.unmount();
  }
  for (const config of [
    { businessName: "Unified website" },
    { ...publicSite("plumber").config, templateSlug: "not-purchased" },
  ]) {
    assert.equal(resolveTemplatePageView(config, {}), null);
    fixture.loader = { ...publicSite("plumber"), config };
    fixture.selectedSlugs = [];
    const instance = mount(Route.component);
    await instance.flush();
    assert.deepEqual(
      fixture.selectedSlugs,
      [],
      "non-template/unknown content never guesses a mold",
    );
    assert.equal(instance.tree.props.className, "flex h-dvh min-h-0 flex-col overflow-hidden");
    assert.ok(nodes(instance.tree).some((node) => node.type === "ContractorSiteView"));
    instance.unmount();
  }
  console.log(
    "PASS #139: every purchased slug selects its registry mold and content; template page scrolling and unified fallback preserved",
  );

  const bookingControls = (instance) =>
    nodes(instance.tree).flatMap((node) => {
      if (node.type === "button" && node.props.onClick?.name === "openBooking") return [node];
      if (typeof node.type === "function" && node.type.name === "PlumberSectionCta")
        return nodes(node.type(node.props)).filter((child) => child.type === "button");
      return [];
    });
  for (const template of ["plumber", "painter11"]) {
    // Keep the real two booking-aware molds separate from the route's registry seam.
    const componentName = moldNames[template];
    const actual = await bundle(`src/components/templates/${componentName}.tsx`, {
      "@/components/site-renderer/SiteBookingPayDemo": componentStub("SiteBookingPayDemo"),
    });
    const Mold = actual[componentName];
    fixture.loader = publicSite(template);
    fixture.matchId = "lp/site-a/version-a";
    let invalidations = 0;
    const recovery = deferred();
    fixture.router = {
      invalidate(options) {
        invalidations++;
        assert.equal(options.sync, true);
        assert.equal(options.filter({ id: fixture.matchId }), true);
        for (const id of ["__root__", "lp/site-b/version-a", "lp/site-a/version-b"])
          assert.equal(options.filter({ id }), false);
        return recovery.promise;
      },
    };
    const instance = mount(Route.component);
    await instance.flush();
    assert.match(text(instance.tree), /temporarily unavailable/);
    const moldElement = nodes(instance.tree).find((node) => node.type === componentName);
    assert.equal(moldElement.props.bookingMode, "disabled");
    const disabled = mount(Mold, moldElement.props, true);
    const title = nodes(disabled.tree).find((node) => node.props["data-tkey"] === "text.heroTitle");
    assert.ok(text(title).startsWith(fixture.loader.config.text.heroTitle));
    assert.equal(
      text(nodes(disabled.tree).find((node) => node.props["data-tkey"] === "text.heroSub")),
      fixture.loader.config.text.heroSub,
    );
    const brand = nodes(disabled.tree).find((node) =>
      template === "plumber" ? node.type?.name === "Mark" : node.props.className === "p11-brand",
    );
    const brandedLink = typeof brand.type === "function" ? brand.type(brand.props) : brand;
    assert.ok(text(brandedLink).includes("Test Business"));
    assert.ok(brandedLink.props["aria-label"].includes("Test Business"));
    assert.doesNotMatch(text(disabled.tree), /TRUE COAT SUPPLY|Leak Geeks/);
    assert.ok(
      nodes(disabled.tree).some(
        (node) => node.type === "a" && node.props.href === "tel:+15551234567",
      ),
    );
    assert.ok(
      nodes(disabled.tree).some(
        (node) => node.type === "a" && node.props.href === "mailto:owner@example.test",
      ),
    );
    assert.ok(bookingControls(disabled).length > 5);
    for (const control of bookingControls(disabled)) {
      assert.equal(control.props.disabled, true);
      control.props.onClick({ currentTarget: { focus() {} } });
    }
    await disabled.flush();
    assert.ok(!nodes(disabled.tree).some((node) => node.type === "SiteBookingPayDemo"));
    disabled.unmount();
    const retry = button(instance, "Retry booking").props.onClick;
    retry();
    retry();
    await instance.flush();
    assert.equal(invalidations, 1);
    assert.equal(button(instance, "Checking booking...").props.disabled, true);
    fixture.loader = {
      ...fixture.loader,
      liveBooking: true,
      showBookingPay: true,
      bookingRetryAvailable: false,
    };
    recovery.resolve();
    await instance.flush();
    assert.equal(button(instance, "Retry booking"), undefined);
    const liveMold = nodes(instance.tree).find((node) => node.type === componentName);
    assert.equal(liveMold.props.bookingMode, "live");
    assert.equal(
      nodes(instance.tree).find((node) => node.type?.name === "LiveBookingDialog").props.open,
      false,
      "disabled mold callbacks did not open the parent dialog",
    );
    const mold = mount(Mold, liveMold.props, true);
    const controls = bookingControls(mold);
    assert.ok(controls.length > 5);
    for (const control of controls) {
      assert.equal(control.props.disabled, false);
      control.props.onClick({ currentTarget: { focus() {} } });
    }
    await instance.flush();
    const liveDialog = nodes(instance.tree).find((node) => node.type?.name === "LiveBookingDialog");
    assert.equal(liveDialog.props.open, true);
    assert.equal(liveDialog.props.websiteId, websiteId);
    assert.equal(liveDialog.key, websiteId);
    assert.ok(!nodes(mold.tree).some((node) => node.type === "SiteBookingPayDemo"));
    mold.unmount();
    instance.unmount();

    const demo = mount(Mold, {}, true);
    assert.ok(text(demo.tree).includes(template === "plumber" ? "Leak Geeks" : "TRUE COAT SUPPLY"));
    const demoTrigger = nodes(demo.tree).find(
      (node) => node.type === "button" && node.props.onClick?.name === "openBooking",
    );
    demoTrigger.props.onClick({ currentTarget: { focus() {} } });
    await demo.flush();
    assert.equal(
      nodes(demo.tree).find((node) => node.type === "SiteBookingPayDemo").props.open,
      true,
    );
    demo.unmount();
    for (const props of [{ content: moldElement.props.content }, { bookingMode: "live" }]) {
      const standalone = mount(Mold, props, true);
      for (const control of bookingControls(standalone)) {
        assert.equal(control.props.disabled, true);
        control.props.onClick({ currentTarget: { focus() {} } });
      }
      await standalone.flush();
      assert.ok(!nodes(standalone.tree).some((node) => node.type === "SiteBookingPayDemo"));
      standalone.unmount();
    }
  }

  for (const patch of [
    { bookingRetryAvailable: false, bookingConfigurationPending: true },
    { showDemoChrome: true },
    { entitlementUnavailable: true },
    { isLive: false },
  ]) {
    fixture.loader = { ...publicSite("plumber"), ...patch };
    const instance = mount(Route.component);
    await instance.flush();
    assert.equal(button(instance, "Retry booking"), undefined);
    instance.unmount();
  }
  fixture.loader = publicSite("plumber");
  fixture.router = {
    invalidate: async () => {
      throw new Error("Status still unavailable");
    },
  };
  const failed = mount(Route.component);
  await failed.flush();
  button(failed, "Retry booking").props.onClick();
  await failed.flush();
  assert.match(text(failed.tree), /still unavailable/);
  assert.equal(
    nodes(failed.tree).find((node) => node.type === moldNames.plumber).props.bookingMode,
    "disabled",
  );
  assert.equal(
    nodes(failed.tree).some((node) => node.type?.name === "LiveBookingDialog"),
    false,
  );
  failed.unmount();
  fixture.loader = publicSite("plumber");
  fixture.matchId = "lp/site-a/version-a";
  const old = deferred();
  fixture.router = { invalidate: () => old.promise };
  const instance = mount(Route.component);
  await instance.flush();
  button(instance, "Retry booking").props.onClick();
  await instance.flush();
  fixture.matchId = "lp/site-b/version-b";
  fixture.loader = { ...publicSite("plumber"), websiteId: otherWebsiteId };
  instance.render();
  await instance.flush();
  old.reject(new Error("Old route failed"));
  await instance.flush();
  assert.doesNotMatch(text(instance.tree), /still unavailable/);
  assert.equal(button(instance, "Retry booking").props.disabled, false);
  instance.unmount();
  assert.equal(instance.lateWrites, 0);
  console.log(
    "PASS R19 LP/molds: exact-match invalidation, single flight, real live callbacks after recovery, nested text/branding/demo/contact preservation, ineligible gates and stale reply cleanup",
  );
}

async function testReceipt() {
  fixture.search = { reference: websiteId };
  const { Route } = await bundle("src/routes/booking.confirmation.tsx", {
    "@/lib/booking-confirmation.functions": `export const consumeBookingConfirmation=async()=>structuredClone(globalThis.__bookingUiRecovery.receipt);`,
  });
  const base = {
    reference: websiteId,
    startAt: available.slots[0].startAt,
    timeZone: "UTC",
    updatedAt: new Date().toISOString(),
    appointmentState: "cancelled",
    appointmentReason: "contractor_cancelled",
    paymentState: "paid",
    refundState: "succeeded",
    calendarState: "cancel_failed",
    reviewState: "calendar_reconciliation",
    statusCode: "refund_succeeded",
  };
  for (const [patch, paymentCopy, calendarCopy] of [
    [{}, /refund has completed/, /Calendar removal needs attention/],
    [
      { refundState: "pending", calendarState: "cancel_pending" },
      /refund is in progress/,
      /Calendar removal is pending/,
    ],
    [
      { refundState: "failed", calendarState: "cancel_failed" },
      /refund needs attention/,
      /Calendar removal needs attention/,
    ],
    [
      {
        appointmentState: "confirmed",
        appointmentReason: "late_payment_recovered",
        refundState: "not_requested",
        calendarState: "create_failed",
      },
      /time was still free/,
      /Calendar delivery needs attention/,
    ],
    [
      {
        appointmentState: "confirmed",
        appointmentReason: "late_payment_recovered",
        refundState: "not_requested",
        calendarState: "create_pending",
      },
      /time was still free/,
      /Calendar delivery is pending/,
    ],
    [
      {
        appointmentState: "confirmed",
        appointmentReason: null,
        refundState: "not_requested",
        calendarState: "created",
      },
      /appointment and payment are confirmed/,
      /Invitation delivery to your inbox is not confirmed/,
    ],
    [{ calendarState: "cancelled" }, /refund has completed/, /event has been removed/],
    [
      {
        appointmentReason: "late_payment_arbitration",
        refundState: "not_requested",
        calendarState: "not_required",
        statusCode: "settling",
      },
      /checking whether your appointment/,
      /No calendar delivery is currently required/,
    ],
  ]) {
    fixture.receipt = { ...base, ...patch };
    const instance = mount(Route.component);
    await instance.flush();
    assert.match(text(instance.tree), paymentCopy);
    assert.match(text(instance.tree), calendarCopy);
    assert.doesNotMatch(text(instance.tree), /contractor has been notified/);
    instance.unmount();
    assert.equal(fixture.timers.size, 0);
  }
  for (const paymentState of ["paid", "disputed"])
    for (const appointmentReason of [null, "late_payment_recovered"])
      for (const calendarState of ["created", "create_pending", "create_failed"]) {
        fixture.receipt = {
          ...base,
          appointmentState: "confirmed",
          paymentState,
          appointmentReason,
          refundState: "not_requested",
          calendarState,
          statusCode: "confirmed_calendar_failed",
        };
        const instance = mount(Route.component);
        await instance.flush();
        assert.match(text(instance.tree), /appointment is confirmed/);
        if (paymentState === "disputed") {
          assert.match(text(instance.tree), /Payment is disputed/);
          assert.doesNotMatch(
            text(instance.tree),
            /appointment and payment are confirmed|Payment arrived after/,
          );
        } else {
          assert.doesNotMatch(text(instance.tree), /Payment is disputed/);
          assert.match(
            text(instance.tree),
            appointmentReason ? /time was still free/ : /appointment and payment are confirmed/,
          );
        }
        assert.match(
          text(instance.tree),
          calendarState === "create_failed"
            ? /Calendar delivery needs attention/
            : calendarState === "create_pending"
              ? /Calendar delivery is pending/
              : /Invitation delivery to your inbox is not confirmed/,
        );
        instance.unmount();
      }
  for (const [refundState, copy] of [
    ["not_requested", /This booking is cancelled/],
    ["pending", /remaining refund is in progress/],
    ["succeeded", /refund has completed/],
    ["failed", /refund needs attention/],
  ]) {
    fixture.receipt = { ...base, paymentState: "disputed", refundState };
    const instance = mount(Route.component);
    await instance.flush();
    assert.match(text(instance.tree), copy);
    assert.match(text(instance.tree), /Payment is disputed/);
    assert.match(text(instance.tree), /Calendar removal needs attention/);
    instance.unmount();
  }
  console.log(
    "PASS R20: disputed money is independent of appointment/refund/calendar copy, late-payment and confirmed-paid controls preserved; poll cleanup preserved",
  );
}

function bookingRow(id) {
  return {
    id,
    website_id: websiteId,
    public_reference: websiteId,
    start_at: available.slots[0].startAt,
    end_at: available.slots[0].endAt,
    time_zone: "UTC",
    customer_snapshot: { name: id },
    service_snapshot: { name: "Visit" },
    booking_attachments: [],
    booking_payments: [],
    appointment_state: "confirmed",
    payment_state: "paid",
    refund_state: "not_requested",
    calendar_state: "created",
    review_state: "none",
    amount_minor: 12000,
    currency: "USD",
    created_at: available.observedAt,
    cancelled_at: null,
  };
}

async function testBookingViews() {
  const { Route } = await bundle("src/routes/bookings.tsx", {
    "@/lib/bookings.functions": `export const getBookingsPage=input=>globalThis.__bookingUiRecovery.bookings(input);
      export const cancelBooking=()=>{throw Error('Cancellation forbidden')};`,
  });
  const cursor = { startAt: available.slots[0].startAt, id: websiteId };
  fixture.loader = {
    rows: [bookingRow("Future Customer")],
    view: "future",
    nextCursor: cursor,
    profileId,
    availabilityWebsiteId: websiteId,
  };
  const old = deferred();
  const calls = [];
  fixture.bookings = ({ data }) => {
    calls.push(data);
    return old.promise;
  };
  let instance = mount(Route.component);
  await instance.flush();
  const future = instance;
  nodes(instance.tree)
    .find((node) => node.key === "Future Customer")
    .props.onClick();
  await instance.flush();
  assert.equal(nodes(instance.tree).find((node) => node.type === "Dialog").props.open, true);
  const more = button(instance, "Load more bookings").props.onClick;
  more();
  more();
  await instance.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].view, "future");
  assert.equal(Route.remountDeps({ search: { view: "future" } }), "future");
  assert.equal(Route.remountDeps({ search: { view: "past" } }), "past");
  // Apply the actual route's changed remount key, as TanStack does on search navigation.
  instance.unmount();
  fixture.loader = {
    ...fixture.loader,
    rows: [bookingRow("Past Customer")],
    view: "past",
    nextCursor: null,
  };
  instance = mount(Route.component);
  await instance.flush();
  assert.match(text(instance.tree), /Past Customer/);
  assert.doesNotMatch(text(instance.tree), /Future Customer/);
  assert.equal(nodes(instance.tree).find((node) => node.type === "Dialog").props.open, false);
  assert.equal(button(instance, "Load more bookings"), undefined);
  old.resolve({
    rows: [bookingRow("Late Future Page")],
    nextCursor: cursor,
    view: "future",
    profileId,
  });
  await instance.flush();
  assert.equal(future.lateWrites, 0, "old pagination must not even update its unmounted view");
  assert.doesNotMatch(text(instance.tree), /Late Future Page/);
  more();
  assert.equal(calls.length, 1, "retained callbacks from the old view cannot issue another read");
  instance.unmount();

  fixture.loader = { ...fixture.loader, nextCursor: cursor };
  fixture.bookings = async () => ({
    rows: [bookingRow("Wrong View")],
    nextCursor: null,
    view: "future",
    profileId,
  });
  instance = mount(Route.component);
  await instance.flush();
  button(instance, "Load more bookings").props.onClick();
  await instance.flush();
  assert.match(text(instance.tree), /More bookings could not be loaded/);
  assert.doesNotMatch(text(instance.tree), /Wrong View/);
  instance.unmount();
  console.log(
    "PASS R21: real remount key resets list/detail/cursor; stale, duplicate and wrong-view pagination cannot append",
  );
}

let networkCalls = 0;
try {
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network forbidden in code-only UI tests");
  };
  globalThis.window = {
    confirm: () => true,
    location: { assign: (url) => fixture.redirects.push(url) },
    setTimeout(fn) {
      fixture.timers.set(++fixture.nextTimer, fn);
      return fixture.nextTimer;
    },
    clearTimeout: (id) => fixture.timers.delete(id),
    addEventListener(name, listener) {
      if (!fixture.listeners.has(name)) fixture.listeners.set(name, new Set());
      fixture.listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      fixture.listeners.get(name)?.delete(listener);
    },
  };
  delete globalThis.document;
  globalThis.FormData = class {
    constructor(values) {
      this.values = values;
    }
    get(key) {
      return this.values[key] ?? null;
    }
    getAll(key) {
      return this.values[key] ?? [];
    }
  };
  await testCompletion();
  await testExplicitAccountChoice();
  await testScheduleRecovery();
  await testOverviewRefresh();
  await testSlots();
  await testPublicSite();
  await testReceipt();
  await testBookingViews();
  assert.equal(networkCalls, 0);
  assert.equal(fixture.timers.size, 0);
  console.log(
    "test-booking-ui-recovery: passed; no DOM/browser/provider/DB/cron execution or generated files",
  );
} finally {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  delete globalThis.__bookingUiRecovery;
}
