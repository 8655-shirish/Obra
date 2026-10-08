import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import path from "node:path";

const ids = {
  website: "11111111-1111-4111-8111-111111111111",
  profile: "22222222-2222-4222-8222-222222222222",
  actor: "33333333-3333-4333-8333-333333333333",
};
const fixture = {
  connection: {
    id: "connection",
    pipedream_account_id: null,
    connection_revision: 4,
    account_email: null,
    setup_operation_id: "operation-a",
    setup_actor_auth_user_id: ids.actor,
    setup_account_id: "apn_A",
    setup_expected_revision: 4,
    setup_calendar_id: "destination-a",
    setup_calendars: [
      { id: "blocking-a", blocksAvailability: true, receivesBookings: false },
      { id: "destination-a", blocksAvailability: false, receivesBookings: true },
    ],
    setup_purpose: "configuration",
    setup_completed_at: null,
    setup_probe_account_id: "apn_A",
    setup_probe_calendar_id: "destination-a",
    setup_failure_reason: "permissions",
    setup_retry_at: new Date().toISOString(),
  },
  actor: ids.actor,
  owner: true,
  pro: true,
  disconnected: false,
  calls: [],
  queries: [],
  probe: null,
  hold: null,
  useServerActions: false,
  rejections: [],
  providerCalls: 0,
  readError: false,
  malformedRead: false,
};

fixture.db = {
  rpc(name, args) {
    assert.equal(name, "get_pending_google_calendar_setup");
    assert.deepEqual(args, {
      p_profile_id: ids.profile,
      p_environment: "test",
      p_expected_revision: fixture.connection?.connection_revision ?? 0,
    });
    return {
      async abortSignal(signal) {
        assert.ok(signal instanceof AbortSignal);
        if (fixture.readError) return { data: null, error: { code: "42501" } };
        if (fixture.malformedRead) return { data: {}, error: null };
        const c = fixture.connection;
        if (
          !c ||
          fixture.disconnected ||
          c.setup_actor_auth_user_id !== ids.actor ||
          c.setup_completed_at ||
          c.setup_expected_revision !== c.connection_revision
        )
          return { data: null, error: null };
        const blockingCalendarIds = c.setup_calendars
          .filter((item) => item.blocksAvailability)
          .map((item) => item.id)
          .sort();
        return {
          data: {
            operationId: c.setup_operation_id,
            accountId: c.setup_account_id,
            connectionRevision: c.setup_expected_revision,
            configurationKey: createHash("sha256")
              .update(
                JSON.stringify([
                  c.setup_operation_id,
                  c.setup_account_id,
                  c.setup_expected_revision,
                  blockingCalendarIds,
                  c.setup_calendar_id,
                ]),
              )
              .digest("hex"),
            blockingCalendarIds,
            destinationCalendarId: c.setup_calendar_id,
            reason: c.setup_failure_reason,
            nextRetryAt: c.setup_retry_at,
          },
          error: null,
        };
      },
    };
  },
  from(table) {
    const query = { table, columns: null, filters: [] };
    fixture.queries.push(query);
    const result = () => {
      assert.ok(query.filters.some(([key, value]) => key === "environment" && value === "test"));
      assert.ok(
        query.filters.some(
          ([key, value]) =>
            key === (table === "profiles" ? "id" : "profile_id") && value === ids.profile,
        ),
      );
      if (table === "calendar_connections")
        return { data: structuredClone(fixture.connection), error: null };
      if (table === "calendar_selections") return { data: [], error: null };
      if (table === "pipedream_bindings") return { data: null, error: null };
      throw new Error(`Unexpected raw setup authority read: ${table}`);
    };
    const chain = {
      select(columns) {
        query.columns = columns;
        return chain;
      },
      eq(key, value) {
        query.filters.push([key, value]);
        return chain;
      },
      in(key, value) {
        query.filters.push([key, value]);
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle: async () => result(),
      then(resolve, reject) {
        return Promise.resolve().then(result).then(resolve, reject);
      },
    };
    return chain;
  },
};

fixture.authorize = (websiteId, mutation = false) => {
  assert.equal(websiteId, ids.website);
  if (!fixture.owner || fixture.actor !== ids.actor) throw new Error("Owner required");
  if (mutation && !fixture.pro) throw new Error("Pro required");
  return {
    profile: { id: ids.profile },
    website: { id: ids.website, environment: "test" },
    authUserId: fixture.actor,
    supabaseAdmin: fixture.db,
  };
};

async function bundle(entry, mocks) {
  const result = await build({
    entryPoints: [path.resolve(entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: { "@": path.resolve("src") },
    plugins: [
      {
        name: "code-only-boundaries",
        setup(api) {
          api.onResolve({ filter: /.*/ }, ({ path: specifier }) =>
            Object.hasOwn(mocks, specifier) ? { path: specifier, namespace: "fixture" } : undefined,
          );
          api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: specifier }) => ({
            contents: mocks[specifier],
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

// Execute real handlers and the real tenant setup-resume adapter, with no HTTP server or browser.
const globals = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  document: globalThis.document,
};
let networkCalls = 0;
globalThis.__pendingSetupTest = fixture;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error("Network forbidden");
};
try {
  const server = await bundle("src/lib/booking-provider.functions.ts", {
    "@tanstack/react-start": `export const createServerFn=()=>({validator:validate=>({handler:fn=>({data})=>fn({data:validate(data)})})});`,
    "@tanstack/react-start/server": `export const setResponseHeader=()=>{throw Error('No cookies expected')};`,
    "@/lib/auth/cookies.server": `export const getCookie=()=>null; export const serializeCookie=()=>{throw Error('No cookies expected')};`,
    "@/integrations/supabase/client.server": `export const supabaseAdmin=globalThis.__pendingSetupTest.db;`,
    "@/lib/provider-authorization.server": `
      const f=globalThis.__pendingSetupTest;
      export const providerOwnerContext=id=>f.authorize(id);
      export const providerMutationContext=id=>f.authorize(id,true);
      export const hasCurrentActiveConfirmedPro=()=>f.pro;
      export const sharedProviderDisconnectEnabled=()=>false;
      export const assertNoOtherActiveProWebsiteNeedsSharedProviders=()=>{throw Error('No disconnect expected')};`,
    "@/lib/google-calendar-state.server": `
      const f=globalThis.__pendingSetupTest;
      export class GoogleCalendarStateError extends Error {}
      export const googleCalendarLifetimeRpc=async(name,args)=>{
        f.calls.push({action:name,data:args});
        if(name==='authorize_google_calendar_setup_read') return f.authorizeSetup(args);
        if(name==='request_google_calendar_verification') return true;
        if(name==='claim_google_calendar_setup_probe') {
          if(f.disconnected || f.connection.setup_completed_at || f.connection.setup_expected_revision!==f.connection.connection_revision) return null;
          return f.probe;
        }
        if(name==='claim_saved_google_calendar_verification') return null;
        throw Error('Unexpected mutation '+name);
      };
      export const requireGoogleCalendarSettlement=value=>{if(!value)throw Error('Fence lost')};
      export const runGoogleCalendarSetupProbe=async({probe})=>{
        f.calls.push({action:'resume-probe',data:probe}); return {persisted:false,writeVerified:false};
      };
      export const reserveGoogleCalendarSetupProbe=()=>{throw Error('Cannot create a new setup')};`,
    "@/lib/pipedream.server": `
      export { PipedreamError, PipedreamRequestError, isGoogleCalendarOneOffEvent } from ${JSON.stringify(path.resolve("src/lib/pipedream.server.ts"))};
      const forbidden=()=>{globalThis.__pendingSetupTest.providerCalls++;throw Error('No provider calls permitted')};
      export const classifyPipedreamFailure=forbidden,configurePipedreamTriggerWebhook=forbidden,
        deletePipedreamAccount=forbidden,deletePipedreamTrigger=forbidden,deployPipedreamTrigger=forbidden,
        getDeployedPipedreamTrigger=forbidden,getPipedreamTriggerWebhook=forbidden,hasGoogleCalendarBookingScopes=forbidden,
        listDeployedPipedreamTriggers=forbidden,listGoogleAccounts=forbidden,listGoogleCalendars=forbidden,
        listGoogleCalendarTriggers=forbidden,pipedreamTriggerWebhookUrl=forbidden,retrievePipedreamTrigger=forbidden,
         verifyGoogleCalendarFreeBusy=forbidden,withPipedreamDeadline=forbidden;`,
  });
  const data = { websiteId: ids.website };
  fixture.authorizeSetup = async (args) => {
    assert.equal(args.p_profile_id, ids.profile);
    assert.equal(args.p_environment, "test");
    // Model the SQL boundary with keys from the actual DTO reader, not invented fixture keys.
    const current = await server.loadGoogleCalendarConfiguration({ data });
    if (
      args.p_expected_revision !== current.connectionRevision ||
      (args.p_expected_setup_key ?? null) !== (current.pendingSetup?.configurationKey ?? null)
    ) {
      fixture.rejections.push(structuredClone(args));
      throw new Error("Google calendar configuration changed; reload your selections");
    }
    return true;
  };
  const config = await server.loadGoogleCalendarConfiguration({ data });
  assert.equal(config.accountId, null);
  assert.deepEqual(config.blockingCalendarIds, []);
  assert.equal(config.destinationCalendarId, null);
  assert.equal(config.pendingSetup.accountId, "apn_A");
  assert.deepEqual(config.pendingSetup.blockingCalendarIds, ["blocking-a"]);
  assert.equal(config.pendingSetup.destinationCalendarId, "destination-a");
  assert.deepEqual(Object.keys(config.pendingSetup).sort(), [
    "accountId",
    "blockingCalendarIds",
    "configurationKey",
    "connectionRevision",
    "destinationCalendarId",
    "nextRetryAt",
    "operationId",
    "reason",
  ]);
  assert.equal(config.pendingSetup.connectionRevision, 4);
  assert.equal(
    config.pendingSetup.configurationKey,
    createHash("sha256")
      .update('["operation-a","apn_A",4,["blocking-a"],"destination-a"]')
      .digest("hex"),
    "the DTO uses the lifecycle's exact ordered, compact JSON key contract",
  );
  fixture.actor = "different-owner";
  await assert.rejects(server.loadGoogleCalendarConfiguration({ data }), /Owner required/);
  fixture.actor = ids.actor;
  fixture.readError = true;
  await assert.rejects(
    server.loadGoogleCalendarConfiguration({ data }),
    /Unable to load pending Google Calendar setup/,
  );
  fixture.readError = false;
  fixture.malformedRead = true;
  await assert.rejects(
    server.loadGoogleCalendarConfiguration({ data }),
    /Unable to load pending Google Calendar setup/,
  );
  fixture.malformedRead = false;
  fixture.disconnected = true;
  assert.equal((await server.loadGoogleCalendarConfiguration({ data })).pendingSetup, null);
  fixture.disconnected = false;
  fixture.connection.setup_completed_at = new Date().toISOString();
  assert.equal((await server.loadGoogleCalendarConfiguration({ data })).pendingSetup, null);
  fixture.connection.setup_completed_at = null;
  fixture.owner = false;
  await assert.rejects(server.loadGoogleCalendarConfiguration({ data }), /Owner required/);
  await assert.rejects(server.refreshGoogleCalendarConnection({ data }), /Owner required/);
  fixture.owner = true;
  fixture.probe = {
    id: "operation-a",
    account_id: "apn_A",
    profile_id: ids.profile,
    environment: "test",
    connection_revision: 4,
  };
  assert.deepEqual(await server.refreshGoogleCalendarConnection({ data }), { checked: false });
  assert.deepEqual(
    fixture.calls.map(({ action }) => action),
    [
      "request_google_calendar_verification",
      "claim_google_calendar_setup_probe",
      "resume-probe",
      "claim_saved_google_calendar_verification",
    ],
  );
  for (const call of fixture.calls.filter(({ action }) => action !== "resume-probe")) {
    assert.equal(call.data.p_profile_id, ids.profile);
    assert.equal(call.data.p_environment, "test");
  }
  fixture.calls = [];
  fixture.probe.profile_id = "another-tenant";
  await assert.rejects(server.refreshGoogleCalendarConnection({ data }));
  assert.equal(
    fixture.calls.some(({ action }) => action === "resume-probe"),
    false,
  );
  fixture.calls = [];
  fixture.probe.profile_id = ids.profile;
  fixture.disconnected = true;
  await server.refreshGoogleCalendarConnection({ data });
  assert.equal(
    fixture.calls.some(({ action }) => action === "resume-probe"),
    false,
  );
  fixture.disconnected = false;
  console.log(
    "PASS: owner GET exposes current pending choices only; refresh resumes only the tenant's existing claim",
  );

  if (!process.argv.includes("--server-only")) {
    // Small hook runner invokes the actual StepTwoCard and its callback props. No DOM/renderer/E2E.
    let hooks = [],
      cursor = 0,
      effects = [],
      layout = [],
      dirty = false,
      tree;
    const same = (a, b) =>
      a?.length === b?.length && a?.every((value, index) => Object.is(value, b[index]));
    fixture.hooks = {
      useState(initial) {
        const index = cursor++;
        hooks[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          hooks[index].value,
          (next) => {
            const value = typeof next === "function" ? next(hooks[index].value) : next;
            if (!Object.is(value, hooks[index].value)) {
              hooks[index].value = value;
              dirty = true;
            }
          },
        ];
      },
      useRef(initial) {
        const index = cursor++;
        return (hooks[index] ??= { current: initial });
      },
      useCallback(fn, deps) {
        const index = cursor++;
        if (!same(hooks[index]?.deps, deps)) hooks[index] = { deps, fn };
        return hooks[index].fn;
      },
      effect(fn, deps, queue) {
        const index = cursor++;
        if (!same(hooks[index]?.deps, deps))
          queue.push(() => {
            hooks[index]?.cleanup?.();
            hooks[index] = { deps, cleanup: fn() };
          });
      },
    };
    fixture.hooks.useEffect = (fn, deps) => fixture.hooks.effect(fn, deps, effects);
    fixture.hooks.useLayoutEffect = (fn, deps) => fixture.hooks.effect(fn, deps, layout);
    fixture.uiConfig = config;
    fixture.calls = [];
    fixture.invoke = async (action, input) => {
      fixture.calls.push({ action, data: input?.data });
      if (action === "configuration") return structuredClone(fixture.uiConfig);
      if (fixture.useServerActions && (action === "discover" || action === "save"))
        return action === "discover"
          ? server.discoverGoogleCalendars(input)
          : server.saveGoogleCalendarSelection(input);
      if (action === "discover") {
        assert.equal(
          input.data.expectedSetupKey,
          fixture.uiConfig.pendingSetup?.configurationKey ?? null,
        );
        if (fixture.hold) await fixture.hold;
        return {
          calendars: [
            { id: "blocking-a", summary: "Blocking calendar", accessRole: "reader" },
            { id: "extra", summary: "Extra conflicts", accessRole: "reader" },
            { id: "destination-a", summary: "Booking destination", accessRole: "owner" },
          ],
        };
      }
      if (action === "check") return server.refreshGoogleCalendarConnection(input);
      if (action === "save") {
        assert.equal(input.data.accountId, fixture.uiConfig.pendingSetup.accountId);
        assert.equal(input.data.expectedRevision, fixture.uiConfig.pendingSetup.connectionRevision);
        assert.equal(input.data.expectedSetupKey, fixture.uiConfig.pendingSetup.configurationKey);
        return { saved: true };
      }
      if (action === "connect" || action === "complete")
        throw new Error("No new authorization expected");
    };
    const components = await bundle("src/components/purchaser/SetupStepCards.tsx", {
      react: `export const {useState,useRef,useCallback,useEffect,useLayoutEffect}=globalThis.__pendingSetupTest.hooks;`,
      "react/jsx-runtime": `export const jsx=(type,props,key)=>({type,props:{...props},key});export const jsxs=jsx;export const Fragment='Fragment';`,
      "lucide-react": `export const CheckCircle2='CheckCircle2';`,
      "@/components/booking/AvailabilityEditor": `export const AvailabilityEditor='AvailabilityEditor';`,
      "@/components/ui/badge": `export const Badge='Badge';`,
      "@/components/ui/alert": `export const Alert='Alert',AlertDescription='AlertDescription',AlertTitle='AlertTitle';`,
      "@/components/ui/button": `export const Button='Button';`,
      "@/components/ui/card": `export const Card='Card',CardHeader='CardHeader',CardTitle='CardTitle',CardDescription='CardDescription',CardContent='CardContent';`,
      "@/lib/booking-setup.functions": `export const getBookingSetup=()=>{throw Error('No availability action expected')};`,
      "@/lib/stripe-connect.functions": `export const getStripeConnectStatus=()=>{},openStripeExpressDashboard=()=>{},reconcileStripeConnect=()=>{},startStripeConnectOnboarding=()=>{};`,
      "@/lib/booking-provider.functions": `const f=globalThis.__pendingSetupTest;
      export const discoverGoogleCalendarAccounts=()=>{throw Error('No account discovery expected')};
      export const loadGoogleCalendarConfiguration=input=>f.invoke('configuration',input);
      export const refreshGoogleCalendarConnection=input=>f.invoke('check',input);
      export const discoverGoogleCalendars=input=>f.invoke('discover',input);
      export const saveGoogleCalendarSelection=input=>f.invoke('save',input);
      export const startGoogleCalendarConnect=input=>f.invoke('connect',input);
      export const completeGoogleCalendarConnection=input=>f.invoke('complete',input);`,
    });
    globalThis.window = { confirm: () => true };
    const readiness = {
      websiteId: ids.website,
      profileId: ids.profile,
      environment: "test",
      plan: "pro",
      orderConfirmed: true,
      entitlementUnavailable: false,
      calendar: "pending",
      bookingAdmission: false,
      calendarAccountEmail: null,
      calendarConnection: {
        accountId: null,
        connectionRevision: 4,
        pendingSetup: {
          configurationKey: config.pendingSetup.configurationKey,
          reason: "permissions",
          nextRetryAt: config.pendingSetup.nextRetryAt,
        },
        configured: false,
        healthState: "not_connected",
        reason: null,
        reconnectReason: null,
        lastVerifiedAt: null,
        triggerState: null,
        lastHealthAt: null,
        nextRetryAt: null,
      },
    };
    let props = {
      websiteId: ids.website,
      userId: ids.profile,
      readiness,
      isOwner: true,
      statusUnknown: false,
      connect: undefined,
      onChanged: () => {
        fixture.calls.push({ action: "overview" });
      },
      onConnectConsumed: () => {
        fixture.calls.push({ action: "consume" });
      },
    };
    function render() {
      cursor = 0;
      effects = [];
      layout = [];
      dirty = false;
      tree = components.StepTwoCard(props);
      for (const effect of layout) effect();
      for (const effect of effects) effect();
    }
    async function settle() {
      for (let pass = 0; pass < 20; pass++) {
        await new Promise((resolve) => setImmediate(resolve));
        if (dirty) render();
      }
    }
    function text(node) {
      if (Array.isArray(node)) return node.map(text).join("");
      if (node && typeof node === "object") return text(node.props?.children);
      return typeof node === "string" ? node : "";
    }
    function nodes(node = tree) {
      if (Array.isArray(node)) return node.flatMap(nodes);
      if (!node || typeof node !== "object") return [];
      return [node, ...nodes(node.props?.children ?? null)];
    }
    const button = (name) => nodes().find((node) => node.type === "Button" && text(node) === name);
    const input = (name) =>
      nodes().find((node) => node.type === "label" && text(node) === name)?.props.children[0];
    function resetProps(next = {}) {
      for (const hook of hooks) hook?.cleanup?.();
      hooks = [];
      props = { ...props, ...next };
      render();
    }
    render();
    await settle();
    assert.equal(button("Review calendars").props.disabled, false);
    assert.equal(button("Check status").props.disabled, false);
    assert.equal(button("Connect to different account").props.disabled, false);
    assert.ok(text(tree).includes("Setup pending"));
    assert.ok(!text(tree).includes("Calendar checks current"));
    assert.equal(
      fixture.calls.some(({ action }) => ["check", "connect", "complete"].includes(action)),
      false,
    );
    button("Review calendars").props.onClick();
    await settle();
    assert.deepEqual(fixture.calls.find(({ action }) => action === "discover").data, {
      websiteId: ids.website,
      accountId: "apn_A",
      expectedRevision: 4,
      expectedSetupKey: config.pendingSetup.configurationKey,
    });
    assert.equal(input("Blocking calendar").props.checked, true);
    assert.equal(nodes().find((node) => node.type === "select").props.value, "destination-a");
    input("Extra conflicts").props.onChange({ target: { checked: true } });
    await settle();
    button("Check status").props.onClick();
    await settle();
    assert.equal(fixture.calls.filter(({ action }) => action === "resume-probe").length, 1);
    assert.equal(input("Extra conflicts").props.checked, true);
    assert.equal(readiness.calendarConnection.configured, false);
    assert.equal(readiness.calendarConnection.accountId, null);
    assert.equal(readiness.bookingAdmission, false);
    button("Save calendars").props.onClick();
    await settle();
    assert.deepEqual(fixture.calls.find(({ action }) => action === "save").data, {
      websiteId: ids.website,
      accountId: "apn_A",
      expectedRevision: 4,
      expectedSetupKey: config.pendingSetup.configurationKey,
      blockingCalendarIds: ["blocking-a", "extra"],
      destinationCalendarId: "destination-a",
    });
    console.log(
      "PASS: initial setup exposes review/check without a fake saved account, booking readiness, or new authorization",
    );

    const originalConnection = structuredClone(fixture.connection);
    for (const action of ["discover", "save"]) {
      fixture.connection = structuredClone(originalConnection);
      fixture.uiConfig = config;
      resetProps({ readiness });
      await settle();
      if (action === "save") {
        button("Review calendars").props.onClick();
        await settle();
        input("Extra conflicts").props.onChange({ target: { checked: true } });
        await settle();
      }
      // Replace pending A in storage without changing the revision or refreshing this view.
      fixture.connection = {
        ...originalConnection,
        setup_account_id: "apn_B",
        setup_calendar_id: "destination-b",
        setup_calendars: [
          { id: "blocking-b", blocksAvailability: true, receivesBookings: false },
          { id: "destination-b", blocksAvailability: false, receivesBookings: true },
        ],
      };
      fixture.uiConfig = await server.loadGoogleCalendarConfiguration({ data });
      assert.equal(fixture.uiConfig.connectionRevision, config.connectionRevision);
      assert.notEqual(
        fixture.uiConfig.pendingSetup.configurationKey,
        config.pendingSetup.configurationKey,
      );
      const before = structuredClone(fixture.connection);
      const rejected = fixture.rejections.length;
      fixture.useServerActions = true;
      button(action === "discover" ? "Review calendars" : "Save calendars").props.onClick();
      await settle();
      fixture.useServerActions = false;
      const request = fixture.calls.filter((call) => call.action === action).at(-1).data;
      assert.equal(request.accountId, "apn_A");
      assert.equal(request.expectedRevision, 4);
      assert.equal(request.expectedSetupKey, config.pendingSetup.configurationKey);
      assert.equal(fixture.rejections.length, rejected + 1);
      assert.equal(
        fixture.rejections.at(-1).p_expected_setup_key,
        config.pendingSetup.configurationKey,
      );
      assert.deepEqual(
        fixture.connection,
        before,
        "rejected stale input cannot overwrite pending B",
      );
      assert.equal(
        fixture.providerCalls,
        0,
        "the server rejects before any provider read or reservation",
      );
      if (action === "save") {
        assert.ok(text(tree).includes("Unable to save these calendars"));
        assert.equal(input("Extra conflicts").props.checked, true);
        assert.equal(button("Save calendars").props.disabled, true);
      } else {
        assert.ok(text(tree).includes("Unable to list calendars"));
      }
      for (const expectedSetupKey of [undefined, null]) {
        await assert.rejects(
          (action === "discover"
            ? server.discoverGoogleCalendars
            : server.saveGoogleCalendarSelection)({
            data: { ...request, expectedSetupKey },
          }),
          /configuration changed/,
        );
        assert.deepEqual(fixture.connection, before);
      }
    }
    fixture.connection = originalConnection;
    fixture.uiConfig = config;
    resetProps({ readiness });
    await settle();
    console.log(
      "PASS: unobserved pending A-to-B discovery/save sends A's key and the real handler rejects it without overwrite",
    );

    button("Review calendars").props.onClick();
    await settle();
    input("Extra conflicts").props.onChange({ target: { checked: true } });
    await settle();
    const staleSave = button("Save calendars").props.onClick;
    fixture.uiConfig = {
      ...config,
      connectionRevision: 5,
      pendingSetup: {
        ...config.pendingSetup,
        accountId: "apn_B",
        connectionRevision: 5,
        configurationKey: "pending-b-key",
      },
    };
    props = {
      ...props,
      readiness: {
        ...readiness,
        calendarConnection: {
          ...readiness.calendarConnection,
          connectionRevision: 5,
          pendingSetup: {
            ...readiness.calendarConnection.pendingSetup,
            configurationKey: "pending-b-key",
          },
        },
      },
    };
    render();
    await settle();
    assert.ok(text(tree).includes("Your unsaved choices"));
    assert.equal(input("Extra conflicts").props.checked, true);
    assert.equal(button("Save calendars").props.disabled, true);
    const saves = fixture.calls.filter(({ action }) => action === "save").length;
    button("Save calendars").props.onClick();
    await settle();
    assert.equal(fixture.calls.filter(({ action }) => action === "save").length, saves);
    // Even a retained callback from A must not submit after B is the current view.
    staleSave();
    await settle();
    assert.equal(fixture.calls.filter(({ action }) => action === "save").length, saves);
    button("Review calendars").props.onClick();
    await settle();
    assert.equal(
      fixture.calls.filter(({ action }) => action === "discover").at(-1).data.accountId,
      "apn_B",
    );
    assert.equal(button("Save calendars").props.disabled, false);
    console.log(
      "PASS: pending revision/account B conflicts with editor A and cannot overwrite its newer view",
    );

    input("Extra conflicts").props.onChange({ target: { checked: true } });
    await settle();
    const sameRevisionSave = button("Save calendars").props.onClick;
    fixture.uiConfig.pendingSetup = {
      ...fixture.uiConfig.pendingSetup,
      blockingCalendarIds: ["blocking-a", "extra"],
      configurationKey: "pending-b-new-choices",
    };
    props = {
      ...props,
      readiness: {
        ...props.readiness,
        calendarConnection: {
          ...props.readiness.calendarConnection,
          pendingSetup: {
            ...props.readiness.calendarConnection.pendingSetup,
            configurationKey: "pending-b-new-choices",
          },
        },
      },
    };
    render();
    await settle();
    assert.equal(button("Save calendars").props.disabled, true);
    assert.equal(input("Extra conflicts").props.checked, true);
    sameRevisionSave();
    await settle();
    assert.equal(fixture.calls.filter(({ action }) => action === "save").length, saves);

    let release;
    fixture.hold = new Promise((resolve) => {
      release = resolve;
    });
    button("Review calendars").props.onClick();
    await settle();
    fixture.uiConfig.pendingSetup = {
      ...fixture.uiConfig.pendingSetup,
      configurationKey: "pending-c",
      accountId: "apn_C",
    };
    props = {
      ...props,
      readiness: {
        ...props.readiness,
        calendarConnection: {
          ...props.readiness.calendarConnection,
          pendingSetup: {
            ...props.readiness.calendarConnection.pendingSetup,
            configurationKey: "pending-c",
          },
        },
      },
    };
    render();
    await settle();
    release();
    fixture.hold = null;
    await settle();
    assert.ok(text(tree).includes("Review the current calendars again"));
    assert.equal(button("Save calendars").props.disabled, true);
    assert.equal(input("Extra conflicts").props.checked, true);
    console.log(
      "PASS: same-revision pending choices conflict, and late discovery cannot adopt a superseded account",
    );

    fixture.calls = [];
    resetProps({
      isOwner: false,
      connect: "success",
      readiness: { ...props.readiness, calendarAccountEmail: "private@example.test" },
    });
    await settle();
    assert.equal(button("Review calendars"), undefined);
    assert.equal(button("Check status"), undefined);
    assert.ok(!text(tree).includes("private@example.test"));
    assert.deepEqual(
      fixture.calls.map(({ action }) => action),
      ["consume"],
    );
    fixture.calls = [];
    fixture.uiConfig.canConfigure = false;
    resetProps({
      isOwner: true,
      connect: "success",
      readiness: { ...props.readiness, entitlementUnavailable: true },
    });
    await settle();
    assert.equal(button("Review calendars"), undefined);
    assert.equal(button("Check status"), undefined);
    assert.equal(
      fixture.calls.some(({ action }) => action === "complete" || action === "save"),
      false,
    );
    console.log(
      "PASS: nonowners and ineligible Pro views cannot complete or select; no account email leaks",
    );
  }
  assert.equal(networkCalls, 0);
  assert.equal(fixture.providerCalls, 0);
  console.log(
    "test-google-calendar-pending-setup: passed; code-only, zero browser/network/provider execution",
  );
} finally {
  globalThis.fetch = globals.fetch;
  if (globals.window === undefined) delete globalThis.window;
  else globalThis.window = globals.window;
  if (globals.document === undefined) delete globalThis.document;
  else globalThis.document = globals.document;
  delete globalThis.__pendingSetupTest;
}
