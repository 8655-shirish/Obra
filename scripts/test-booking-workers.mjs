import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { runInNewContext } from "node:vm";

const pipedreamFailureMocks = `
  export class PipedreamRequestError extends Error {
    constructor(status, operation = "Pipedream request", reason = null, classification = "temporary") {
      super("provider prose must not be persisted");
      Object.assign(this, { status, operation, reason, classification });
    }
  }
  export const classifyPipedreamFailure = error => error?.classification ?? "temporary";
  export async function withPipedreamDeadline(deadlineAt, work) {
    const s = globalThis.__acceptance;
    (s.deadlines ??= []).push(deadlineAt);
    if (Date.now() >= deadlineAt) throw new PipedreamRequestError(0);
    return work();
  }
`;

const boundedRpcMock = `
  const execute = bookingWorker.rpc;
  bookingWorker.rpc = (...args) => {
    if(globalThis.__acceptance.hangRpc===args[0]) return {
      abortSignal: signal => new Promise(resolve => {
        const timer=setTimeout(() => resolve({data:null,error:{code:"08006"}}),10_000);
        signal.addEventListener("abort",() => {
          clearTimeout(timer);
          globalThis.__acceptance.abortedRpc=true;
          resolve({data:null,error:{code:"08006"}});
        },{once:true});
      })
    };
    const request = execute(...args);
    request.abortSignal = (signal) => {
      (globalThis.__acceptance.rpcSignals ??= []).push(signal);
      return request;
    };
    return request;
  };
`;

function command(type, overrides = {}) {
  return {
    id: "cmd-1",
    profile_id: "profile-1",
    environment: "test",
    appointment_id: "apt-1",
    command_type: type,
    idempotency_key: "booking-" + type + ":apt-1:1",
    effect_generation: 1,
    fencing_token: 7,
    payload: {},
    ...overrides,
  };
}
const appointment = {
  id: "apt-1",
  public_reference: "reference-1",
  start_at: "2030-01-02T17:00:00Z",
  end_at: "2030-01-02T18:00:00Z",
  time_zone: "UTC",
  customer_snapshot: { email: "customer@example.test" },
  service_snapshot: { name: "Repair" },
};
const payment = {
  id: "payment-1",
  profile_id: "profile-1",
  environment: "test",
  stripe_account_id: "acct_1",
  payment_intent_id: "pi_1",
  amount_paid_minor: 10000,
  amount_refunded_minor: 0,
};

async function runOutbox({
  commands,
  contexts,
  refundResult,
  contextError = false,
  environment = "test",
} = {}) {
  globalThis.__acceptance = {
    commands: [...(commands ?? [])],
    contexts: contexts ?? {},
    refundResult,
    refund: null,
    rpc: [],
    google: [],
    notices: [],
    contextError,
  };
  const mocks = {
    "@/integrations/supabase/booking-worker.server":
      'export const bookingWorker={rpc:async(name,args)=>{const s=globalThis.__acceptance;s.rpc.push({name,args});if(name==="claim_due_booking_outbox")return {data:s.commands.length?[s.commands.shift()]:[],error:null};if(name==="get_booking_outbox_context")return s.contextError?{data:null,error:{message:"transient"}}:{data:s.contexts[args.p_command_id],error:null};if(name==="reduce_booking_financial_evidence_v3"){s.reductions=(s.reductions??0)+1;return {data:s.reductions===1?{action:"create",stripeAccountId:"acct_1",paymentIntentId:"pi_1",chargeId:"ch_1",amountMinor:10000,idempotencyKey:"refund-key",paymentId:"payment-1",appointmentId:"apt-1",profileId:"profile-1",environment:"test",generation:1,commandId:"cmd-1"}:{action:"settled",outcome:"refund_submission_succeeded"},error:null}}return {data:true,error:null}}};',
    "@/integrations/supabase/client.server":
      "export const supabaseAdmin={rpc:async(name,args)=>{globalThis.__acceptance.rpc.push({name,args});return {data:true,error:null}}};",
    "@/lib/pipedream.server":
      'export class PipedreamRequestError extends Error{constructor(status){super("pd");this.status=status}};export async function createGoogleBookingEvent(i){globalThis.__acceptance.google.push({kind:"create",input:i});return {id:i.eventId,iCalUID:"ical-1",etag:"etag-1"}};export async function deleteGoogleBookingEvent(i){globalThis.__acceptance.google.push({kind:"delete",input:i})};',
    "@/lib/stripe.server":
      'export const billingEnvironment=()=>"test";export function getStripe(){const s=globalThis.__acceptance;return {paymentIntents:{retrieve:async()=>({id:"pi_1",object:"payment_intent",livemode:false,latest_charge:"ch_1",metadata:{kind:"booking",appointmentId:"apt-1",profileId:"profile-1",environment:"test"}})},charges:{retrieve:async()=>({id:"ch_1",object:"charge",livemode:false,payment_intent:"pi_1",amount:10000,amount_refunded:s.refund?10000:0,currency:"usd"})},refunds:{list:async()=>({data:s.refund?[{id:"re_1",object:"refund",charge:"ch_1",payment_intent:"pi_1",status:"succeeded",amount:10000,currency:"usd",created:123,metadata:s.refund.params.metadata}]:[],has_more:false}),create:async(params,options)=>{s.refund={params,options};return {id:"re_1"}}}}};',
    "@/lib/booking-notifications.server":
      'export async function sendBookingNotification(i){globalThis.__acceptance.notices.push(i);return {notificationId:"email-1"}};',
  };
  const bundle = await importWithMocks(
    path.resolve("src/lib/booking-outbox-worker.server.ts"),
    mocks,
  );
  try {
    return await bundle.subject.processBookingOutbox(environment, 5);
  } finally {
    await bundle.cleanup();
  }
}

await runOutbox({
  commands: [command("refund")],
  contexts: { "cmd-1": { appointment, payment, epoch: null, link: null } },
});
const outboxClaim = globalThis.__acceptance.rpc.find(
  (call) => call.name === "claim_due_booking_outbox",
);
assert.equal(outboxClaim.args.p_environment, "test");
assert.ok(
  globalThis.__acceptance.rpc.filter((call) => call.name === "renew_booking_refund_command_v3")
    .length >= 5,
  "refund provider reads, mutation, and reducer settlement renew the current fence",
);
assert.equal(globalThis.__acceptance.refund.options.stripeAccount, "acct_1");
assert.equal(globalThis.__acceptance.refund.options.idempotencyKey, "refund-key");
assert.equal(globalThis.__acceptance.refund.params.charge, "ch_1");
assert.equal("payment_intent" in globalThis.__acceptance.refund.params, false);
const reductions = globalThis.__acceptance.rpc.filter(
  (call) => call.name === "reduce_booking_financial_evidence_v3",
);
assert.equal(reductions.length, 2, "refund is prepared and converged from complete snapshots");
assert.equal(reductions[0].args.p_provider_snapshot.charge.amount_refunded, 0);
assert.equal(reductions[1].args.p_provider_snapshot.charge.amount_refunded, 10000);
assert.equal(globalThis.__acceptance.refund.params.metadata.kind, "booking_refund");
assert.equal(globalThis.__acceptance.refund.params.metadata.bookingPaymentId, "payment-1");

await runOutbox({ commands: [command("refund")], contexts: {}, contextError: true });
const transientFailure = globalThis.__acceptance.rpc.find(
  (call) => call.name === "fail_booking_refund_command_v3",
);
assert.equal(
  transientFailure.args.p_retryable,
  true,
  "context transport failure remains retryable",
);

await runOutbox({
  commands: [command("refund")],
  contexts: { "cmd-1": { appointment, payment: null, epoch: null, link: null } },
});
const terminalFailure = globalThis.__acceptance.rpc.find(
  (call) => call.name === "fail_booking_refund_command_v3",
);
const terminalClaim = globalThis.__acceptance.rpc.find(
  (call) => call.name === "claim_due_booking_outbox",
);
assert.deepEqual(terminalFailure.args, {
  p_command_id: "cmd-1",
  p_lease_token: terminalClaim.args.p_lease_token,
  p_fencing_token: 7,
  p_retryable: false,
  p_retry_delay_seconds: 0,
  p_safe_error: "Booking refund provider operation failed",
});

await runOutbox({ commands: [command("refund")], contexts: {} });
assert.equal(
  globalThis.__acceptance.rpc.some((call) => call.name === "fail_booking_refund_command_v3"),
  false,
  "successful-null refund context abandons stale ownership without failure settlement",
);

await assert.rejects(
  () =>
    runOutbox({
      commands: [command("refund")],
      contexts: { "cmd-1": { appointment, payment, epoch: null, link: null } },
      environment: "live",
    }),
  /Stripe key mode does not match/,
);
assert.equal(globalThis.__acceptance.rpc.length, 0, "key-mode mismatch performs no database claim");

globalThis.__acceptance = {
  rpc: [],
  rows: [
    {
      id: "inbox-1",
      profile_id: "profile-1",
      environment: "test",
      account_context: "acct_1",
      event_type: "checkout.session.completed",
      fencing_token: 9,
      payload: { data: { object: { id: "cs_1", payment_intent: "pi_1" } } },
    },
  ],
};
const inboxBundle = await importWithMocks(
  path.resolve("src/lib/booking-stripe-inbox-worker.server.ts"),
  {
    "@/integrations/supabase/booking-worker.server":
      'export const bookingWorker={rpc:async(name,args)=>{const s=globalThis.__acceptance;s.rpc.push({name,args});if(name==="claim_due_booking_payment_events")return {data:s.rows.length?[s.rows.shift()]:[],error:null};if(name==="reduce_booking_financial_evidence_v3")return {data:{action:"settled"},error:null};return {data:true,error:null}}};',
    "@/lib/stripe.server":
      'export const billingEnvironment=()=>"test";export const getStripe=()=>({checkout:{sessions:{retrieve:async()=>({id:"cs_1",payment_intent:"pi_1"})}},paymentIntents:{retrieve:async()=>({id:"pi_1",latest_charge:"ch_1"})},charges:{retrieve:async()=>({id:"ch_1",payment_intent:"pi_1",amount_refunded:0})},refunds:{list:async()=>({data:[],has_more:false})}});',
  },
);
assert.deepEqual(await inboxBundle.subject.processBookingStripeInbox("test", 10), {
  processed: 1,
  claimed: 1,
  failed: 0,
  skipped: 0,
  deadlineExceeded: false,
});
const applied = globalThis.__acceptance.rpc.find(
  (call) => call.name === "reduce_booking_financial_evidence_v3",
);
assert.equal(applied.args.p_authority_id, "inbox-1");
assert.equal(applied.args.p_authority_kind, "stripe_event");
assert.equal(applied.args.p_provider_snapshot.stripeAccountId, "acct_1");
assert.equal(applied.args.p_fencing_token, 9);
assert.ok(applied.args.p_lease_token);
assert.ok(
  globalThis.__acceptance.rpc.filter((call) => call.name === "renew_booking_payment_event_v3")
    .length >= 4,
  "booking inbox renews its event fence before provider reads and reducer settlement",
);
await inboxBundle.cleanup();

async function runInboxPagination({ repeatedCursor = false } = {}) {
  globalThis.__acceptance = {
    rpc: [],
    rows: [
      {
        id: "inbox-pages",
        profile_id: "profile-1",
        environment: "test",
        account_context: "acct_1",
        event_type: "charge.refunded",
        fencing_token: 11,
        payload: { data: { object: { id: "ch_1", payment_intent: "pi_1" } } },
      },
    ],
    refundPages: 0,
  };
  const bundle = await importWithMocks(
    path.resolve("src/lib/booking-stripe-inbox-worker.server.ts"),
    {
      "@/integrations/supabase/booking-worker.server":
        'export const bookingWorker={rpc:async(name,args)=>{const s=globalThis.__acceptance;s.rpc.push({name,args});if(name==="claim_due_booking_payment_events")return {data:s.rows.length?[s.rows.shift()]:[],error:null};if(name==="reduce_booking_financial_evidence_v3")return {data:{action:"settled"},error:null};return {data:true,error:null}}};',
      "@/lib/stripe.server":
        'export const billingEnvironment=()=>"test";export const getStripe=()=>({checkout:{sessions:{retrieve:async()=>null}},paymentIntents:{retrieve:async()=>({id:"pi_1",object:"payment_intent",livemode:false,metadata:{kind:"booking",appointmentId:"apt-1"},latest_charge:"ch_1"})},charges:{retrieve:async()=>({id:"ch_1",object:"charge",livemode:false,payment_intent:"pi_1",amount_refunded:100})},refunds:{list:async(args)=>{const s=globalThis.__acceptance;s.refundPages++;if(s.refundPages===1)return {data:[{id:"re_1",object:"refund"}],has_more:true};return {data:[{id:s.repeatedCursor?"re_1":"re_2",object:"refund"}],has_more:s.repeatedCursor}}}});',
    },
  );
  globalThis.__acceptance.repeatedCursor = repeatedCursor;
  const result = await bundle.subject.processBookingStripeInbox("test", 1);
  const reducerCalls = globalThis.__acceptance.rpc.filter(
    (call) => call.name === "reduce_booking_financial_evidence_v3",
  );
  const failCalls = globalThis.__acceptance.rpc.filter(
    (call) => call.name === "fail_booking_payment_event_v3",
  );
  await bundle.cleanup();
  return { result, reducerCalls, failCalls, pages: globalThis.__acceptance.refundPages };
}

const pagedInbox = await runInboxPagination();
assert.equal(pagedInbox.pages, 2);
assert.equal(pagedInbox.reducerCalls.length, 1);
assert.deepEqual(
  pagedInbox.reducerCalls[0].args.p_provider_snapshot.refunds.map((refund) => refund.id),
  ["re_1", "re_2"],
);
const malformedInbox = await runInboxPagination({ repeatedCursor: true });
assert.equal(malformedInbox.reducerCalls.length, 0);
assert.equal(malformedInbox.failCalls.length, 1);
assert.deepEqual(malformedInbox.result, {
  processed: 0,
  claimed: 1,
  failed: 1,
  skipped: 0,
  deadlineExceeded: false,
});

async function runSessionExpiry({ providerFailure = false } = {}) {
  globalThis.__acceptance = {
    rpc: [],
    claimed: false,
    expires: 0,
    retrieves: 0,
    providerFailure,
  };
  const bundle = await importWithMocks(path.resolve("src/lib/booking-reconciliation.server.ts"), {
    "@/integrations/supabase/booking-worker.server":
      'export const bookingWorker={rpc:async(name,args)=>{const s=globalThis.__acceptance;s.rpc.push({name,args});if(name==="claim_booking_calendar_reconciliation"||name==="claim_booking_late_payment_arbitrations"||name==="claim_ambiguous_booking_checkouts")return {data:[],error:null};if(name==="expire_due_booking_holds_v3"||name==="expire_abandoned_booking_checkout_creations_v3")return {data:0,error:null};if(name==="claim_due_booking_session_expiries_v3")return {data:s.claimed?[]:[(s.claimed=true,{id:"payment-expiry",checkout_session_id:"cs_expiry",stripe_account_id:"acct_1",checkout_fencing_token:12})],error:null};if(name==="reduce_booking_financial_evidence_v3")return {data:{action:"settled",outcome:"expiry_unpaid_released"},error:null};return {data:true,error:null}}};' +
      boundedRpcMock,
    "@/lib/pipedream.server":
      pipedreamFailureMocks +
      'export async function getGoogleBookingEvent(){return {state:"absent"}};export async function createGoogleBookingEvent(){return {id:"none"}};export async function deleteGoogleBookingEvent(){};export async function getGoogleCalendarBusyRanges(){return []};',
    "@/lib/stripe.server":
      'export const billingEnvironment=()=>"test";export const getStripe=()=>({checkout:{sessions:{retrieve:async()=>{const s=globalThis.__acceptance;s.retrieves++;if(s.providerFailure){const e=new Error("transport");e.statusCode=503;throw e}return s.expires?{id:"cs_expiry",object:"checkout.session",status:"expired",payment_status:"unpaid",payment_intent:null,amount_total:10000,currency:"usd",metadata:{kind:"booking",appointmentId:"apt-1",profileId:"profile-1",environment:"test"}}:{id:"cs_expiry",object:"checkout.session",status:"open",payment_status:"unpaid",payment_intent:null,expires_at:4102444800,amount_total:10000,currency:"usd",metadata:{kind:"booking",appointmentId:"apt-1",profileId:"profile-1",environment:"test"}}},expire:async()=>{globalThis.__acceptance.expires++;return {id:"cs_expiry",status:"expired",payment_status:"unpaid"}}}},paymentIntents:{retrieve:async()=>null},charges:{retrieve:async()=>null},refunds:{list:async()=>({data:[],has_more:false})}});',
  });
  try {
    return await bundle.subject.reconcileBookingLifecycle("test");
  } finally {
    await bundle.cleanup();
  }
}

const unpaidExpiry = await runSessionExpiry();
assert.equal(
  globalThis.__acceptance.expires,
  1,
  "open provider session is explicitly expired at DB hold cutoff",
);
assert.equal(
  globalThis.__acceptance.retrieves,
  2,
  "expired provider session is re-read before reduction",
);
const expiryReduction = globalThis.__acceptance.rpc.find(
  (call) => call.name === "reduce_booking_financial_evidence_v3",
);
assert.equal(expiryReduction.args.p_authority_kind, "session_expiry");
assert.equal(expiryReduction.args.p_provider_snapshot.checkout.status, "expired");
assert.ok(
  globalThis.__acceptance.rpc.filter((call) => call.name === "renew_booking_session_expiry_v3")
    .length >= 4,
  "session-expiry fence renews before provider mutation and settlement",
);
assert.equal(unpaidExpiry.sessionsArbitrated, 1);
assert.equal(
  globalThis.__acceptance.rpc.filter(
    (call) => call.name === "expire_abandoned_booking_checkout_creations_v3",
  ).length,
  1,
  "core lifecycle dispatches abandoned Checkout creation expiry",
);
assert.equal(
  globalThis.__acceptance.rpc.filter(
    (call) => call.name === "expire_abandoned_booking_checkout_creations_v3",
  ).length,
  1,
  "core lifecycle dispatches abandoned Checkout creation expiry",
);

await runSessionExpiry({ providerFailure: true });
const expiryFailure = globalThis.__acceptance.rpc.find(
  (call) => call.name === "fail_booking_session_expiry_v3",
);
assert.equal(
  expiryFailure.args.p_retryable,
  true,
  "Stripe 5xx expiry failure is retried with backoff",
);

async function runReconciliation({
  calendarState,
  calendarDecision,
  lateClaims = [],
  busyRanges = [],
  readStates = [],
  readEtag = '"calendar-v1"',
  providerFailure,
  readFailure,
  rpcFailure,
  rpcFailureCode = "08006",
  hangRpc,
  staleRenewal = 0,
  stopAfter,
  deadlineAt,
  claimEnvironment = "test",
  claimEpoch = { id: "epoch-1", pipedream_account_id: "apn-1", google_calendar_id: "primary" },
  claimLink = {},
  canContinue = () => !globalThis.__acceptance.stopped,
}) {
  globalThis.__acceptance = {
    rpc: [],
    reads: [],
    writes: [],
    calendarState,
    calendarDecision,
    calendarClaimed: 0,
    lateClaimed: 0,
    lateClaims,
    busyRanges,
    readStates: [...readStates],
    readEtag,
    providerFailure,
    readFailure,
    rpcFailure,
    rpcFailureCode,
    hangRpc,
    staleRenewal,
    renewals: 0,
    stopAfter,
    claimEnvironment,
    claimEpoch,
    claimLink,
  };
  const mocks = {
    "@/integrations/supabase/booking-worker.server":
      `export const bookingWorker={rpc:async(name,args)=>{
      const s=globalThis.__acceptance;s.rpc.push({name,args});
      if (s.stopAfter===name) s.stopped=true;
      if (s.rpcFailure===name) return {data:null,error:{message:"response lost",code:s.rpcFailureCode}};
      if(name==="claim_booking_calendar_reconciliation")return {data:s.calendarDecision&&!s.calendarClaimed++?[{
        link:{id:"link-1",appointment_id:"apt-1",profile_id:"profile-1",environment:s.claimEnvironment,google_event_id:"obra-event",desired_state:s.calendarDecision==="delete"?"absent":"present",desired_generation:3,snapshot_appointment_version:8,reconcile_fencing_token:5,...s.claimLink},
        appointment:{id:"apt-1",public_reference:"ref",start_at:"2030-01-02T17:00:00Z",end_at:"2030-01-02T18:00:00Z",time_zone:"UTC",customer_snapshot:{email:"customer@example.test"},service_snapshot:{name:"Repair"}},
        epoch:s.claimEpoch}]:[],error:null};
      if(name==="renew_booking_calendar_reconciliation_v3")return {data:++s.renewals!==s.staleRenewal,error:null};
      if(name==="record_booking_calendar_observation")return {data:{action:args.p_observed_state==="conflict"?"manual_repair":args.p_phase==="probe"?s.calendarDecision:args.p_observed_state===(s.calendarDecision==="create"?"present":"absent")?"converged":"retry"},error:null};
      if(name==="begin_booking_calendar_effect")return {data:"effect-1",error:null};
       if(name==="claim_booking_late_payment_arbitrations")return {data:s.lateClaimed++?[]:s.lateClaims,error:null};
       if(name==="record_booking_late_payment_observation")return {data:"recovered",error:null};
      if(name==="expire_due_booking_holds_v3"||name==="expire_abandoned_booking_checkout_creations_v3")return {data:0,error:null};
      if(name==="claim_due_booking_session_expiries_v3"||name==="claim_ambiguous_booking_checkouts")return {data:[],error:null};
      return {data:true,error:null};}};` + boundedRpcMock,
    "@/lib/pipedream.server":
      pipedreamFailureMocks +
      `
      function fail(spec) {
        if (spec.programming) throw new ReferenceError("programming error");
        throw new PipedreamRequestError(spec.status,spec.operation,spec.reason,spec.kind);
      }
      export async function getGoogleBookingEvent(i){
        const s=globalThis.__acceptance;s.reads.push(i);
        if(s.stopAfter==="read")s.stopped=true;
        if(s.readFailure)fail(s.readFailure);
        return {state:s.readStates.shift()??s.calendarState,etag:s.readEtag};
      }
      export async function createGoogleBookingEvent(i){
        const s=globalThis.__acceptance;s.writes.push({kind:"create",input:i});
        if(s.stopAfter==="write")s.stopped=true;
        if(s.providerFailure)fail(s.providerFailure);
        return {id:i.eventId};
      }
      export async function deleteGoogleBookingEvent(i){
        const s=globalThis.__acceptance;s.writes.push({kind:"delete",input:i});
        if(s.providerFailure)fail(s.providerFailure);
      };
      export async function getGoogleCalendarBusyRanges(i){
        globalThis.__acceptance.freebusy=i;await i.beforeChunk?.();return globalThis.__acceptance.busyRanges;
      };`,
    "@/lib/stripe.server": `export const billingEnvironment=()=>"test";export const getStripe=()=>({checkout:{sessions:{create:async()=>({})}}});export const publicAppUrl=()=>"https://example.test";`,
  };
  const bundle = await importWithMocks(
    path.resolve("src/lib/booking-reconciliation.server.ts"),
    mocks,
  );
  try {
    return await bundle.subject.reconcileBookingLifecycle("test", canContinue, deadlineAt);
  } finally {
    await bundle.cleanup();
  }
}

await runReconciliation({ calendarState: "absent", calendarDecision: "create" });
assert.equal(globalThis.__acceptance.writes[0].kind, "create");
assert.equal(
  globalThis.__acceptance.reads.length,
  2,
  "create is fenced by GET-before and GET-after",
);
assert.ok(
  globalThis.__acceptance.rpc.some((call) => call.name === "begin_booking_calendar_effect"),
);
assert.ok(
  globalThis.__acceptance.rpc.some((call) => call.name === "record_booking_calendar_effect_result"),
);

await runReconciliation({ calendarState: "present", calendarDecision: "delete" });
assert.equal(globalThis.__acceptance.writes[0].kind, "delete");
assert.equal(globalThis.__acceptance.writes[0].input.ifMatch, '"calendar-v1"');
assert.equal(
  globalThis.__acceptance.reads.length,
  2,
  "delete is identity-proved then outcome-proved",
);
assert.ok(
  globalThis.__acceptance.rpc.filter(
    (call) => call.name === "renew_booking_calendar_reconciliation_v3",
  ).length >= 5,
  "calendar row lease renews before provider reads, mutation, and settlement",
);

await runReconciliation({ calendarState: "conflict", calendarDecision: "manual_repair" });
assert.equal(
  globalThis.__acceptance.writes.length,
  0,
  "identity conflicts are never overwritten or deleted",
);

const lateClaim = {
  arbitration: {
    id: "arb-1",
    profile_id: "profile-1",
    environment: "test",
    snapshot_generation: 2,
    fencing_token: 4,
  },
  appointment: { start_at: "2030-01-02T17:00:00Z", end_at: "2030-01-02T18:00:00Z" },
  provider_context: {
    accountId: "apn-1",
    calendarIds: ["primary", "team"],
    rangeStart: "2030-01-02T16:45:00Z",
    rangeEnd: "2030-01-02T18:15:00Z",
  },
};
await runReconciliation({
  calendarState: "absent",
  calendarDecision: null,
  lateClaims: [lateClaim],
  busyRanges: [{ start: "2030-01-02T17:30:00Z", end: "2030-01-02T17:45:00Z" }],
});
assert.deepEqual(globalThis.__acceptance.freebusy.calendarIds, ["primary", "team"]);
assert.equal(globalThis.__acceptance.freebusy.timeMin, "2030-01-02T16:45:00Z");
assert.equal(globalThis.__acceptance.freebusy.timeMax, "2030-01-02T18:15:00Z");
assert.ok(
  globalThis.__acceptance.rpc
    .filter((call) => call.name === "claim_booking_calendar_reconciliation")
    .every((call) => call.args.p_limit === 1),
);
assert.ok(
  globalThis.__acceptance.rpc
    .filter((call) => call.name === "claim_booking_late_payment_arbitrations")
    .every((call) => call.args.p_limit === 1),
);
const lateObservation = globalThis.__acceptance.rpc.find(
  (call) => call.name === "record_booking_late_payment_observation",
);
assert.equal(lateObservation.args.p_observation_state, "complete");
assert.ok(
  globalThis.__acceptance.rpc.some(
    (call) => call.name === "renew_booking_late_payment_arbitration_v3",
  ),
  "late-payment lease renews before observation settlement",
);
assert.equal(lateObservation.args.p_snapshot_generation, 2);
assert.equal(lateObservation.args.p_fencing_token, 4);

const lifetimeDeadline = Date.now() + 30_000;
const lostInsert = await runReconciliation({
  calendarState: "absent",
  calendarDecision: "create",
  readStates: ["absent", "present"],
  providerFailure: { status: 503, kind: "temporary" },
  deadlineAt: lifetimeDeadline,
});
assert.equal(lostInsert.googleReconciled, 1, "lost INSERT response converges only after readback");
assert.equal(globalThis.__acceptance.writes.length, 1, "no second INSERT after lost response");
assert.ok(globalThis.__acceptance.deadlines.every((value) => value < lifetimeDeadline - 2_000));
assert.ok(
  globalThis.__acceptance.rpcSignals.length === globalThis.__acceptance.rpc.length,
  "all lifecycle RPCs carry invocation-bounded abort signals",
);
await runReconciliation({
  calendarState: "absent",
  calendarDecision: "create",
  readStates: ["absent", "present"],
  rpcFailure: "record_booking_calendar_effect_result",
});
const repeatedEffectResult = globalThis.__acceptance.rpc.filter(
  ({ name }) => name === "record_booking_calendar_effect_result",
);
assert.equal(repeatedEffectResult.length, 3);
assert.deepEqual(repeatedEffectResult[0].args, repeatedEffectResult[1].args);
assert.deepEqual(repeatedEffectResult[0].args, repeatedEffectResult[2].args);
assert.ok(Number.isFinite(Date.parse(repeatedEffectResult[0].args.p_evidence.observedAt)));
for (const input of globalThis.__acceptance.reads) {
  assert.equal(input.accountId, "apn-1");
  assert.equal(input.calendarId, "primary");
  assert.equal(input.eventId, "obra-event");
  assert.equal(input.startAt, appointment.start_at);
  assert.equal(input.endAt, appointment.end_at);
  assert.equal(input.attendeeEmail, appointment.customer_snapshot.email);
}
await runReconciliation({ calendarState: "present", calendarDecision: "converged" });
assert.equal(globalThis.__acceptance.writes.length, 0, "takeover never reinserts a present event");

const retainedDestination = {
  claimEpoch: {
    id: "epoch-retained",
    pipedream_account_id: "apn-retained",
    google_calendar_id: "old-destination",
  },
  claimLink: {
    failure_kind: "permissions",
    failure_code: "calendar_permissions_changed",
    snapshot_connection_revision: null,
    reconcile_attempts: 10,
  },
};
await runReconciliation({
  ...retainedDestination,
  calendarState: "absent",
  calendarDecision: "create",
  readFailure: { status: 403, kind: "permissions" },
});
assert.equal(globalThis.__acceptance.reads[0].accountId, "apn-retained");
assert.equal(
  globalThis.__acceptance.writes.length,
  0,
  "historical permission denial still forbids create until exact GET succeeds",
);
assert.equal(
  globalThis.__acceptance.rpc.find((call) => call.name === "fail_booking_calendar_convergence").args
    .p_failure_kind,
  "permissions",
);
const restoredHistorical = await runReconciliation({
  ...retainedDestination,
  calendarState: "absent",
  calendarDecision: "create",
  readStates: ["absent", "present"],
});
assert.equal(
  restoredHistorical.googleReconciled,
  1,
  "restored historical permission completes delivery without current configuration readiness",
);
assert.equal(globalThis.__acceptance.writes.length, 1);
for (const input of [
  ...globalThis.__acceptance.reads,
  ...globalThis.__acceptance.writes.map((write) => write.input),
]) {
  assert.equal(input.accountId, "apn-retained");
  assert.equal(input.calendarId, "old-destination");
  assert.equal(input.eventId, "obra-event", "recovery never mints a replacement event identity");
  assert.equal(input.startAt, appointment.start_at);
  assert.equal(input.endAt, appointment.end_at);
  assert.equal(input.attendeeEmail, appointment.customer_snapshot.email);
}
assert.ok(
  globalThis.__acceptance.rpc
    .filter((call) => call.name === "record_booking_calendar_observation")
    .every((call) => call.args.p_evidence.destinationEpochId === "epoch-retained"),
);

for (const kind of ["temporary", "platform", "reauthorization", "permissions"]) {
  await runReconciliation({
    calendarState: "absent",
    calendarDecision: "create",
    readFailure: { status: 403, kind },
  });
  const failure = globalThis.__acceptance.rpc.find(
    (call) => call.name === "fail_booking_calendar_convergence",
  );
  assert.equal(
    failure.args.p_failure_kind,
    kind,
    "classification, not status, determines recovery",
  );
  assert.equal(failure.args.p_retryable, true);
  assert.equal(failure.args.p_expected_generation, 3);
  assert.equal(failure.args.p_expected_appointment_version, 8);
  assert.equal(failure.args.p_fencing_token, 5);
  assert.equal(globalThis.__acceptance.writes.length, 0);
  assert.equal(JSON.stringify(failure).includes("provider prose"), false);
}

await runReconciliation({
  calendarState: "absent",
  calendarDecision: "create",
  providerFailure: {
    status: 403,
    kind: "permissions",
    operation: "Google Calendar event creation via Pipedream",
    reason: "insufficientPermissions",
  },
});
const writeDenial = globalThis.__acceptance.rpc.find(
  (call) =>
    call.name === "record_booking_calendar_observation" && call.args.p_phase === "post_effect",
);
assert.equal(writeDenial.args.p_evidence.failureCode, "calendar_write_blocked");
assert.equal(writeDenial.args.p_evidence.failureKind, "permissions");
assert.equal(
  globalThis.__acceptance.rpc.find((call) => call.name === "record_booking_calendar_effect_result")
    .args.p_outcome,
  "failed",
);

await runReconciliation({
  calendarState: "absent",
  calendarDecision: "create",
  providerFailure: {
    status: 403,
    kind: "configuration",
    operation: "Google Calendar event creation via Pipedream",
    reason: "forbiddenForNonOrganizer",
  },
});
assert.equal(
  globalThis.__acceptance.rpc.find(
    (call) =>
      call.name === "record_booking_calendar_observation" && call.args.p_phase === "post_effect",
  ).args.p_evidence.failureCode,
  "calendar_event_invalid",
  "event-specific denial is not an account write blocker",
);

const drift = await runReconciliation({
  calendarState: "absent",
  calendarDecision: "create",
  readStates: ["absent", "conflict"],
});
assert.equal(drift.googleReconciled, 0, "content conflict is not delivered");
assert.equal(globalThis.__acceptance.writes.length, 1, "content drift is not overwritten");

const deletedTombstone = await runReconciliation({
  calendarState: "absent",
  calendarDecision: "delete",
  readStates: ["present", "conflict", "absent"],
});
assert.equal(
  deletedTombstone.googleReconciled,
  1,
  "exact deleted-event tombstone completes cancellation",
);
assert.equal(globalThis.__acceptance.writes.length, 1);
assert.equal(
  globalThis.__acceptance.reads.at(-1).startAt,
  undefined,
  "tombstone check is identity-only and can prove absence only",
);
await runReconciliation({
  calendarState: "conflict",
  calendarDecision: "delete",
  readStates: ["conflict", "present"],
});
assert.equal(
  globalThis.__acceptance.writes.length,
  0,
  "identity-only present cannot bypass content conflict to delete contractor edits",
);

await runReconciliation({ calendarState: "present", calendarDecision: "delete", readEtag: null });
assert.equal(globalThis.__acceptance.writes.length, 0, "missing exact-read ETag forbids DELETE");
assert.equal(
  globalThis.__acceptance.rpc.find((call) => call.name === "record_booking_calendar_observation")
    .args.p_observed_state,
  "conflict",
);
await runReconciliation({
  calendarState: "present",
  calendarDecision: "delete",
  providerFailure: {
    status: 412,
    kind: "configuration",
    operation: "Google Calendar event deletion via Pipedream",
    reason: "conditionNotMet",
  },
});
assert.equal(globalThis.__acceptance.writes.length, 1, "ETag conflict is never blindly replayed");
assert.equal(globalThis.__acceptance.writes[0].input.ifMatch, '"calendar-v1"');
assert.equal(
  globalThis.__acceptance.rpc.find((call) => call.name === "fail_booking_calendar_convergence").args
    .p_failure_code,
  "calendar_identity_conflict",
);

await runReconciliation({
  calendarState: "present",
  calendarDecision: "delete",
  providerFailure: {
    status: 403,
    kind: "permissions",
    operation: "Google Calendar event deletion via Pipedream",
    reason: "forbidden",
  },
});
assert.equal(
  globalThis.__acceptance.rpc.find((call) => call.name === "record_booking_calendar_effect_result")
    .args.p_evidence.failureCode,
  "calendar_write_blocked",
  "conditional DELETE denial feeds its scoped capability evidence",
);

for (const rpcFailure of ["begin_booking_calendar_effect", "record_booking_calendar_observation"]) {
  await runReconciliation({ calendarState: "absent", calendarDecision: "create", rpcFailure });
  assert.equal(
    globalThis.__acceptance.writes.length,
    0,
    "indeterminate authority never permits writes",
  );
  assert.equal(
    globalThis.__acceptance.rpc.some((call) => call.name === "fail_booking_calendar_convergence"),
    false,
    "RPC failure is not contradictory provider evidence",
  );
}
assert.equal(
  (
    await runReconciliation({
      calendarState: "absent",
      calendarDecision: "create",
      rpcFailure: "record_booking_calendar_observation",
      rpcFailureCode: "42703",
    })
  ).segmentFailures,
  1,
  "SQL programming errors are counted as segment failures, not provider retry",
);
const hungStart = Date.now();
assert.equal(
  (
    await runReconciliation({
      calendarState: "absent",
      calendarDecision: "create",
      hangRpc: "claim_booking_calendar_reconciliation",
      deadlineAt: hungStart + 2_500,
    })
  ).segmentFailures,
  1,
);
assert.equal(
  globalThis.__acceptance.abortedRpc,
  true,
  "hung claim is aborted at invocation deadline",
);
assert.ok(
  Date.now() - hungStart < 4_000,
  "hung DB claim does not consume an unbounded worker lease",
);
assert.equal(
  globalThis.__acceptance.writes.length,
  0,
  "indeterminate timed-out claim forbids provider effects",
);
await runReconciliation({
  calendarState: "absent",
  calendarDecision: "create",
  readStates: ["absent", "present"],
  rpcFailure: "record_booking_calendar_effect_result",
});
assert.equal(
  globalThis.__acceptance.reads.length,
  2,
  "accepted effect result response loss still permits exact readback, without reporting complete success",
);

for (const staleRenewal of [1, 3]) {
  await runReconciliation({ calendarState: "absent", calendarDecision: "create", staleRenewal });
  assert.equal(
    globalThis.__acceptance.writes.length,
    0,
    "disconnect/stale renewal forbids new effects",
  );
  assert.equal(
    globalThis.__acceptance.rpc.some((call) => call.name === "fail_booking_calendar_convergence"),
    false,
  );
}
for (const stopAfter of [
  "claim_booking_calendar_reconciliation",
  "read",
  "begin_booking_calendar_effect",
]) {
  await runReconciliation({ calendarState: "absent", calendarDecision: "create", stopAfter });
  assert.equal(
    globalThis.__acceptance.writes.length,
    0,
    "family loss stops between provider effects",
  );
  assert.equal(
    globalThis.__acceptance.rpc.at(-1).name,
    stopAfter === "read" ? "renew_booking_calendar_reconciliation_v3" : stopAfter,
  );
}
const stoppedWrite = await runReconciliation({
  calendarState: "absent",
  calendarDecision: "create",
  stopAfter: "write",
});
assert.equal(
  stoppedWrite.googleReconciled,
  0,
  "accepted write without readback remains unfinished",
);
assert.equal(globalThis.__acceptance.reads.length, 1);
assert.ok(
  globalThis.__acceptance.rpc.some((call) => call.name === "record_booking_calendar_effect_result"),
);

for (const options of [{ deadlineAt: Date.now() - 1 }, { canContinue: () => false }]) {
  await runReconciliation({ calendarState: "absent", calendarDecision: "create", ...options });
  assert.equal(
    globalThis.__acceptance.rpc.length,
    0,
    "expired budget/family cannot claim any lifecycle work",
  );
}
assert.equal(
  (
    await runReconciliation({
      calendarState: "absent",
      calendarDecision: "create",
      claimEnvironment: "live",
    })
  ).segmentFailures,
  1,
);
assert.equal(
  globalThis.__acceptance.reads.length,
  0,
  "cross-environment claim performs no provider work",
);
assert.equal(
  (
    await runReconciliation({
      calendarState: "absent",
      calendarDecision: "create",
      readFailure: { programming: true },
    })
  ).segmentFailures,
  1,
);

// Real deadline scopes, with only DB/provider boundaries replaced. Slow or
// failed earlier work must leave each later responsibility an invocation share.
for (const blockedLane of ["holds", "late", "expiry", "checkout", "google", "all"]) {
  const state = { calls: [], claims: new Set(), blockedLane };
  globalThis.__bookingFairness = state;
  const suite = await importWithMocks(path.resolve("src/lib/booking-reconciliation.server.ts"), {
    "@/integrations/supabase/booking-worker.server": `export const bookingWorker={rpc:(name,args)=>{
      const s=globalThis.__bookingFairness;s.calls.push(name);let value=[];
      if(name.startsWith("expire_"))value=0;
      else if(name.startsWith("renew_"))value=true;
      else if(name==="record_booking_late_payment_observation")value="recovered";
      else if(name==="record_booking_calendar_observation")value={action:"converged"};
      else if(name==="settle_booking_checkout")value={id:"pay",checkout_session_id:"cs_recovered"};
      else if(name==="reduce_booking_financial_evidence_v3")value={action:"settled"};
      else if(name.startsWith("fail_"))value=true;
      else if(name==="claim_booking_late_payment_arbitrations"&&!s.claims.has(name))value=[{arbitration:{id:"arb",profile_id:"tenant",environment:"test",snapshot_generation:1,fencing_token:1},appointment:{start_at:"2030-01-01T10:00:00Z",end_at:"2030-01-01T11:00:00Z"},provider_context:{accountId:"apn_fixture",calendarIds:["primary"],rangeStart:"2030-01-01T10:00:00Z",rangeEnd:"2030-01-01T11:00:00Z"}}];
      else if(name==="claim_due_booking_session_expiries_v3"&&!s.claims.has(name))value=[{id:"expiry",stripe_account_id:"acct_fixture",checkout_session_id:"cs_expiry",checkout_fencing_token:1}];
      else if(name==="claim_ambiguous_booking_checkouts"&&!s.claims.has(name))value=[{payment_id:"pay",appointment_id:"apt",profile_id:"tenant",environment:"test",stripe_account_id:"acct_fixture",checkout_idempotency_key:"original",checkout_provider_expires_at:new Date(Date.now()+1800000).toISOString(),checkout_operation_id:"op",expected_amount_minor:1000,currency:"USD",website_id:"site",service_snapshot:{name:"Visit"},customer_snapshot:{email:"customer@example.test"},checkout_fencing_token:1}];
      else if(name==="claim_booking_calendar_reconciliation"&&!s.claims.has(name))value=[{link:{id:"link",appointment_id:"apt",profile_id:"tenant",environment:"test",google_event_id:"obra12345",desired_state:"present",desired_generation:1,snapshot_appointment_version:1,reconcile_fencing_token:1},appointment:{id:"apt",start_at:"2030-01-01T10:00:00Z",end_at:"2030-01-01T11:00:00Z",customer_snapshot:{email:"customer@example.test"}},epoch:{id:"epoch",pipedream_account_id:"apn_fixture",google_calendar_id:"primary"}}];
      s.claims.add(name);
      if(s.blockedLane==="holds"&&name==="expire_due_booking_holds_v3")return {abortSignal:signal=>new Promise(resolve=>{
        const timer=setTimeout(()=>resolve({data:null,error:{code:"08006"}}),1000);
        signal.addEventListener("abort",()=>{clearTimeout(timer);resolve({data:null,error:{code:"08006"}})},{once:true});
      })};
      const request=Promise.resolve({data:value,error:null});request.abortSignal=()=>request;return request;
    }};`,
    "@/lib/pipedream.server": `import {workerProviderFetch} from "@/lib/worker-deadline.server";
      export class PipedreamRequestError extends Error {};
      export const classifyPipedreamFailure=()=>"temporary";
      export const withPipedreamDeadline=(_at,work)=>work();
      export async function getGoogleCalendarBusyRanges(){if(["late","all"].includes(globalThis.__bookingFairness.blockedLane))await workerProviderFetch("https://fixture.invalid/hung");return [];}
      export async function getGoogleBookingEvent(){if(["google","all"].includes(globalThis.__bookingFairness.blockedLane))await workerProviderFetch("https://fixture.invalid/hung");return {state:"present"};}
      export const createGoogleBookingEvent=()=>{throw new Error("unexpected create")};export const deleteGoogleBookingEvent=createGoogleBookingEvent;`,
    "@/lib/stripe.server": `import {workerProviderFetch} from "@/lib/worker-deadline.server";
      export const billingEnvironment=()=>"test";export const publicAppUrl=()=>"https://example.test";
      export const getStripe=()=>({checkout:{sessions:{
        async retrieve(){if(["expiry","all"].includes(globalThis.__bookingFairness.blockedLane))await workerProviderFetch("https://fixture.invalid/hung");return {id:"cs_expiry",status:"expired",payment_status:"unpaid",payment_intent:null};},
        async create(){if(["checkout","all"].includes(globalThis.__bookingFairness.blockedLane))await workerProviderFetch("https://fixture.invalid/hung");return {id:"cs_recovered",expires_at:Math.floor(Date.now()/1000)+1800};}
      }}});`,
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://fixture.invalid/hung");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({})), 10000);
      init.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(init.signal.reason);
        },
        { once: true },
      );
    });
  };
  try {
    const began = Date.now();
    const result = await suite.subject.reconcileBookingLifecycle("test", () => true, began + 3500);
    for (const name of [
      "expire_due_booking_holds_v3",
      "expire_abandoned_booking_checkout_creations_v3",
      "claim_booking_late_payment_arbitrations",
      "claim_due_booking_session_expiries_v3",
      "claim_ambiguous_booking_checkouts",
      "claim_booking_calendar_reconciliation",
    ])
      assert.ok(state.calls.includes(name), `${blockedLane} must not starve ${name}`);
    assert.ok(Date.now() - began < 2200);
    assert.ok(result.failed === null || result.failed > 0);
    if (blockedLane === "holds") assert.equal(result.holdFailures, 1);
    if (blockedLane === "late") assert.equal(result.latePaymentFailures, 1);
    if (blockedLane === "expiry") assert.equal(result.sessionExpiryFailures, 1);
    if (blockedLane === "checkout") assert.equal(result.recoveryFailures, 1);
    if (blockedLane === "google") assert.equal(result.googleFailures, 1);
  } finally {
    await suite.cleanup();
    globalThis.fetch = previousFetch;
    delete globalThis.__bookingFairness;
  }
}
console.log(
  "PASS: R9 bounded lifecycle opportunities and separate failure counters survive earlier lane failure/timeouts",
);

// The existing admin action must remain reachable without loading a DOM.
const repairSource = await readFile(
  path.resolve("src/components/admin/AdminCalendarRepair.tsx"),
  "utf8",
);
const eligibility = repairSource.slice(
  repairSource.indexOf("  const eligible ="),
  repairSource.indexOf("  return (", repairSource.indexOf("  const eligible =")),
);
const eligibilityJs = await transform(
  `function eligible(context){${eligibility} return eligible;} eligible;`,
  { loader: "ts" },
);
const eligible = runInNewContext(eligibilityJs.code);
assert.equal(
  eligible({
    cutoverEnabled: true,
    linkId: null,
    reviewState: "unresolved_destination",
    appointmentState: "cancelled",
  }),
  true,
);
assert.equal(
  eligible({
    cutoverEnabled: false,
    linkId: null,
    reviewState: "unresolved_destination",
    appointmentState: "cancelled",
  }),
  false,
);

async function runNotification({ acceptanceLost = false, stopBeforeSend = false } = {}) {
  globalThis.__acceptance = { rpc: [], sent: [], acceptanceLost, stopBeforeSend };
  const bundle = await importWithMocks(
    path.resolve("src/lib/booking-notification-worker.server.ts"),
    {
      "@/integrations/supabase/booking-worker.server": `export const bookingWorker={rpc:async(name,args)=>{
      const s=globalThis.__acceptance;s.rpc.push({name,args});
      if(name==="claim_due_booking_notifications_v3")return {data:[{
        id:"notice-1",appointment_id:"apt-1",notification_type:"confirmed",audience:"customer",environment:"test",
        recipient_email:"customer@example.test",idempotency_key:"original-email-key",fencing_token:9
      }],error:null};
      if(name==="get_booking_notification_context_v3"){
        if(s.stopBeforeSend)s.stopped=true;
        return {data:{appointment:{public_reference:"ref",start_at:"2030-01-02T17:00:00Z",time_zone:"UTC",service_snapshot:{name:"Repair"}}},error:null};
      }
      if(name==="authorize_booking_notification_dispatch_v3")return {data:{action:"dispatch",payload:args.p_payload,dispatch_budget_ms:10_000},error:null};
      if(name==="complete_booking_notification_v3"&&s.acceptanceLost)return {data:null,error:{code:"08006"}};
      return {data:true,error:null};
    }};`,
      "@/lib/booking-notifications.server": `
      export class BookingNotificationProviderError extends Error {}
      export const buildBookingNotificationPayload = () => "frozen-notification";
      export async function sendBookingNotification(input){globalThis.__acceptance.sent.push(input);return {notificationId:"accepted-email-id"};}
    `,
    },
  );
  try {
    return await bundle.subject.processBookingNotifications(
      "test",
      1,
      () => !globalThis.__acceptance.stopped,
    );
  } finally {
    await bundle.cleanup();
  }
}
await assert.rejects(
  () => runNotification({ acceptanceLost: true }),
  /acceptance settlement is unresolved/,
);
assert.equal(globalThis.__acceptance.sent.length, 1);
assert.equal(globalThis.__acceptance.sent[0].idempotencyKey, "original-email-key");
assert.equal(
  globalThis.__acceptance.rpc.some((call) => call.name === "fail_booking_notification_v3"),
  false,
  "provider acceptance response loss is never reclassified as send failure",
);
await runNotification({ stopBeforeSend: true });
assert.equal(
  globalThis.__acceptance.sent.length,
  0,
  "family loss between notification context and effect stops send",
);
assert.deepEqual(await runNotification(), {
  processed: 1,
  claimed: 1,
  accepted: 1,
  failed: 0,
  suppressed: 0,
  review: 0,
  settled: 1,
  skipped: 0,
});

console.log(
  "OK: booking workers exercised deadlines, immutable content readback, dependency classification, fences, lost responses, and financial paths",
);
