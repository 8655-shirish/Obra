import { randomUUID } from "node:crypto";
import { withWorkerDeadline } from "@/lib/worker-deadline.server";

import {
  GoogleCalendarStateError,
  googleCalendarLifetimeRpc,
  requireGoogleCalendarSettlement,
  runGoogleCalendarSetupProbe,
  type GoogleCalendarBinding,
  type GoogleCalendarDisconnectClaim,
  type GoogleCalendarEnvironment,
  type GoogleCalendarSetupProbe,
  type GoogleCalendarVerificationReason,
  type SavedGoogleCalendarClaim,
} from "@/lib/google-calendar-state.server";
import {
  classifyPipedreamFailure,
  configurePipedreamTriggerWebhook,
  deletePipedreamAccount,
  deletePipedreamTrigger,
  deployPipedreamTrigger,
  getDeployedPipedreamTrigger,
  getPipedreamTriggerWebhook,
  hasGoogleCalendarBookingScopes,
  listDeployedPipedreamTriggers,
  listGoogleAccounts,
  listGoogleCalendars,
  listGoogleCalendarTriggers,
  PipedreamError,
  PipedreamRequestError,
  pipedreamTriggerWebhookUrl,
  retrievePipedreamTrigger,
  verifyGoogleCalendarFreeBusy,
  withPipedreamDeadline,
} from "@/lib/pipedream.server";
import type {
  PipedreamDeployedTrigger,
  PipedreamTriggerDefinition,
} from "@/lib/pipedream-trigger-contracts";

const COMPONENT_KEY = "google_calendar-new-or-updated-event-instant";
const SETTLEMENT_MS = 3_000;
const START_WORK_MS = 4_000;

class GoogleCalendarCheckError extends Error {
  constructor(
    readonly reason: string,
    readonly disconnected = false,
  ) {
    super(`Google Calendar maintenance needs attention (${reason})`);
    this.name = "GoogleCalendarCheckError";
  }
}

function classifiedReason(error: unknown): GoogleCalendarVerificationReason {
  switch (classifyPipedreamFailure(error)) {
    case "reauthorization":
      return "provider_reauthorization_required";
    case "permissions":
      return "calendar_permissions_changed";
    case "platform":
      return "provider_platform_error";
    case "configuration":
      return "provider_configuration_error";
    default:
      return "provider_temporary_failure";
  }
}

function observedVersion(
  trigger: PipedreamDeployedTrigger,
  pinned: PipedreamTriggerDefinition | null,
  receipt: GoogleCalendarBinding["deployment_receipt"],
) {
  // Connect need not return a definition ID. A persisted successful response to
  // our pinned deploy request is provider evidence for that exact returned resource.
  // An inventory match or a request whose response was lost is not such evidence.
  const definition = pinned?.id
    ? pinned
    : receipt?.trigger_id === trigger.id && receipt.operation_id
      ? { id: receipt.component_id, key: receipt.component_key, version: receipt.component_version }
      : null;
  return definition?.id &&
    trigger.componentId === definition.id &&
    definition.key === pinned?.key &&
    (trigger.componentKey === null || trigger.componentKey === definition.key)
    ? definition.version
    : null;
}

function triggerMatches(trigger: PipedreamDeployedTrigger, binding: GoogleCalendarBinding) {
  const account = trigger.configuredProps.googleCalendar;
  const calendars = trigger.configuredProps.calendarIds;
  return (
    (trigger.componentKey === COMPONENT_KEY || trigger.componentKey === null) &&
    account !== null &&
    typeof account === "object" &&
    !Array.isArray(account) &&
    (account as { authProvisionId?: unknown }).authProvisionId === binding.pipedream_account_id &&
    Array.isArray(calendars) &&
    calendars.length === binding.selected_calendar_ids.length &&
    new Set(calendars).size === calendars.length &&
    calendars.every((id) => typeof id === "string" && binding.selected_calendar_ids.includes(id)) &&
    trigger.configuredProps.newOnly === false
  );
}

function scopedMissing(error: unknown, operation: string) {
  return (
    error instanceof PipedreamRequestError &&
    error.operation === operation &&
    error.layer !== "machine" &&
    [404, 410].includes(error.status) &&
    (error.reason === null || error.reason === "notFound" || error.reason === "deleted")
  );
}

async function reconcileSavedClaim(input: {
  claim: SavedGoogleCalendarClaim;
  leaseToken: string;
  allowRepair: boolean;
  deadlineAt: number;
}) {
  const { claim, leaseToken, allowRepair, deadlineAt } = input;
  const { connection, selections } = claim;
  let binding = claim.binding;
  const scope = { profileId: connection.profile_id, environment: connection.environment };
  if (
    binding.profile_id !== connection.profile_id ||
    binding.environment !== connection.environment ||
    binding.connection_id !== connection.id ||
    (!claim.cleanup_only &&
      (binding.configuration_revision !== connection.connection_revision ||
        binding.pipedream_account_id !== connection.pipedream_account_id))
  )
    throw new GoogleCalendarStateError();
  const fence = {
    p_binding_id: binding.id,
    p_lease_token: leaseToken,
    p_fencing_token: binding.reconciliation_fencing_token,
  };
  const providerDeadline = Math.min(
    deadlineAt - SETTLEMENT_MS,
    Date.parse(binding.reconciliation_lease_expires_at) - SETTLEMENT_MS,
  );
  const provider = <T>(work: () => Promise<T>): Promise<T> =>
    withPipedreamDeadline(providerDeadline, work, { settlementDeadlineAt: deadlineAt });
  let accountVerified = false;
  let deploymentDefinitelyRejected = false;
  let observed: PipedreamDeployedTrigger | null = null;
  let pinned: PipedreamTriggerDefinition | null = null;

  const cleanRetiredTriggers = async () => {
    const retired = binding.retired_deployment;
    if (retired) {
      const desired = await provider(() =>
        retrievePipedreamTrigger({
          environment: scope.environment,
          key: retired.component_key,
          version: retired.component_version,
        }),
      );
      const inventory = await provider(() => listDeployedPipedreamTriggers(scope));
      const oldBinding = {
        ...binding,
        pipedream_account_id: retired.account_id,
        selected_calendar_ids: retired.calendar_ids,
      };
      let found = false;
      for (const trigger of inventory) {
        if (
          binding.retired_trigger_ids.includes(trigger.id) ||
          !triggerMatches(trigger, oldBinding)
        )
          continue;
        if (observedVersion(trigger, desired, null) !== retired.component_version) continue;
        requireGoogleCalendarSettlement(
          await googleCalendarLifetimeRpc<boolean>(
            "record_pipedream_trigger_deployment_result",
            {
              p_binding_id: binding.id,
              p_deployment_operation_id: retired.operation_id,
              p_lease_token: retired.lease_token,
              p_fencing_token: retired.fencing_token,
              p_deployed_trigger_id: trigger.id,
            },
            deadlineAt,
          ),
        );
        binding.retired_trigger_ids.push(trigger.id);
        binding.pending_trigger_deletions.push(trigger.id);
        binding.retired_deployment = null;
        found = true;
        break;
      }
      if (!found) throw new GoogleCalendarCheckError("trigger_deployment_ambiguous");
    }
    for (const triggerId of binding.pending_trigger_deletions) {
      requireGoogleCalendarSettlement(
        await googleCalendarLifetimeRpc<boolean>(
          "authorize_pipedream_trigger_cleanup",
          { ...fence, p_deployed_trigger_id: triggerId },
          providerDeadline,
        ),
      );
      await provider(() => deletePipedreamTrigger({ ...scope, triggerId }));
      requireGoogleCalendarSettlement(
        await googleCalendarLifetimeRpc<boolean>(
          "complete_pipedream_stale_trigger_cleanup",
          { ...fence, p_deployed_trigger_id: triggerId },
          deadlineAt,
        ),
      );
    }
    binding.pending_trigger_deletions = [];
  };

  try {
    if (claim.cleanup_only) {
      if (allowRepair) await cleanRetiredTriggers();
      requireGoogleCalendarSettlement(
        await googleCalendarLifetimeRpc<boolean>(
          "settle_pipedream_binding_cleanup",
          fence,
          deadlineAt,
        ),
      );
      return;
    }
    const accountId = connection.pipedream_account_id;
    const blockingIds = selections
      .filter((selection) => selection.blocks_availability)
      .map((selection) => selection.google_calendar_id);
    const destinations = selections.filter((selection) => selection.receives_bookings);
    if (!accountId || !blockingIds.length || destinations.length !== 1)
      throw new GoogleCalendarCheckError("calendar_selection_invalid");

    // Account and selected-calendar evidence is independent of trigger availability.
    // The inventory adapters reject incomplete pagination rather than proving absence.
    const accounts = await provider(() => listGoogleAccounts(scope.profileId, scope.environment));
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (!account) throw new GoogleCalendarCheckError("provider_account_missing", true);
    if (account.healthy !== true || account.dead === true || account.error)
      throw new GoogleCalendarCheckError("provider_account_unhealthy");
    if (!Array.isArray(account.authorized_scopes))
      throw new GoogleCalendarCheckError("provider_temporary_failure");
    if (!hasGoogleCalendarBookingScopes(account.authorized_scopes))
      throw new GoogleCalendarCheckError("calendar_permissions_changed");
    const calendars = await provider(() => listGoogleCalendars({ ...scope, accountId }));
    const byId = new Map(calendars.map((calendar) => [calendar.id, calendar]));
    for (const selection of selections) {
      const calendar = byId.get(selection.google_calendar_id);
      if (
        !calendar ||
        (selection.receives_bookings && !["writer", "owner"].includes(calendar.accessRole))
      )
        throw new GoogleCalendarCheckError("calendar_permissions_changed");
    }
    for (let offset = 0; offset < blockingIds.length; offset += 50)
      await provider(() =>
        verifyGoogleCalendarFreeBusy({
          ...scope,
          accountId,
          calendarIds: blockingIds.slice(offset, offset + 50),
        }),
      );
    requireGoogleCalendarSettlement(
      await googleCalendarLifetimeRpc<boolean>(
        "mark_google_calendar_connection_verified",
        {
          ...fence,
          p_verified_at: new Date().toISOString(),
          p_calendars: selections.map((selection) => ({
            id: selection.google_calendar_id,
            accessRole: byId.get(selection.google_calendar_id)!.accessRole,
          })),
        },
        deadlineAt,
      ),
    );
    accountVerified = true;
    if ((binding.pending_trigger_deletions.length || binding.retired_deployment) && !allowRepair)
      throw new GoogleCalendarCheckError("trigger_cleanup_pending");
    if (allowRepair) await cleanRetiredTriggers();

    let currentTriggerId = binding.deployment_candidate_trigger_id ?? binding.deployed_trigger_id;
    if (
      binding.deployed_trigger_id &&
      binding.deployment_candidate_trigger_id &&
      binding.deployed_trigger_id !== binding.deployment_candidate_trigger_id
    ) {
      if (!allowRepair) throw new GoogleCalendarCheckError("trigger_deployment_ambiguous");
      binding = await googleCalendarLifetimeRpc<GoogleCalendarBinding>(
        "retire_pipedream_trigger",
        { ...fence, p_deployed_trigger_id: binding.deployed_trigger_id },
        providerDeadline,
      );
      requireGoogleCalendarSettlement(binding);
      await cleanRetiredTriggers();
      currentTriggerId = binding.deployment_candidate_trigger_id;
    }
    if (currentTriggerId) {
      try {
        observed = await provider(() =>
          getDeployedPipedreamTrigger({ ...scope, triggerId: currentTriggerId }),
        );
        if (observed.id !== currentTriggerId)
          throw new GoogleCalendarCheckError("trigger_identity_mismatch");
      } catch (error) {
        if (!scopedMissing(error, "Pipedream deployed trigger lookup")) throw error;
      }
    }

    let version = binding.component_version;
    if (version === "pending") {
      const definitions = await provider(() => listGoogleCalendarTriggers(scope.environment));
      const definition = definitions.find((candidate) => candidate.key === COMPONENT_KEY);
      if (!definition) throw new GoogleCalendarCheckError("trigger_contract_unavailable");
      version = definition.version;
    }
    pinned = await provider(() =>
      retrievePipedreamTrigger({ environment: scope.environment, key: COMPONENT_KEY, version }),
    );
    if (pinned.key !== COMPONENT_KEY || pinned.version !== version)
      throw new GoogleCalendarCheckError("trigger_contract_mismatch");
    const matches =
      observed?.active &&
      triggerMatches(observed, binding) &&
      observedVersion(observed, pinned, binding.deployment_receipt) === binding.component_version;
    if (!matches) {
      if (!allowRepair)
        throw new GoogleCalendarCheckError(
          observed ? "trigger_contract_mismatch" : "trigger_missing",
        );
      if (currentTriggerId) {
        binding = await googleCalendarLifetimeRpc<GoogleCalendarBinding>(
          "retire_pipedream_trigger",
          { ...fence, p_deployed_trigger_id: currentTriggerId },
          providerDeadline,
        );
        requireGoogleCalendarSettlement(binding);
        await cleanRetiredTriggers();
      }
      const props = new Map(
        pinned.configurableProps.flatMap((prop) =>
          prop && typeof prop === "object" && typeof (prop as { name?: unknown }).name === "string"
            ? [[(prop as { name: string }).name, prop as Record<string, unknown>] as const]
            : [],
        ),
      );
      if (
        props.get("googleCalendar")?.type !== "app" ||
        props.get("googleCalendar")?.app !== "google_calendar" ||
        props.get("calendarIds")?.type !== "string[]" ||
        props.get("newOnly")?.type !== "boolean"
      )
        throw new GoogleCalendarCheckError("trigger_contract_mismatch");
      binding = await googleCalendarLifetimeRpc<GoogleCalendarBinding>(
        "reserve_pipedream_trigger_deployment",
        {
          ...fence,
          p_profile_id: scope.profileId,
          p_environment: scope.environment,
          p_connection_id: connection.id,
          p_pipedream_account_id: accountId,
          p_expected_connection_revision: connection.connection_revision,
          p_component_version: version,
        },
        providerDeadline,
      );
      requireGoogleCalendarSettlement(binding);
      const inventory = await provider(() => listDeployedPipedreamTriggers(scope));
      const candidates = inventory.filter(
        (trigger) =>
          triggerMatches(trigger, binding) &&
          observedVersion(trigger, pinned, binding.deployment_receipt) === version &&
          !binding.retired_trigger_ids.includes(trigger.id),
      );
      observed =
        candidates.find((trigger) => trigger.id === binding.deployment_candidate_trigger_id) ??
        candidates.find((trigger) => trigger.active) ??
        candidates[0] ??
        null;
      let deploymentResponse = false;
      if (!observed) {
        // A lost create response is not authority to create another resource. Discovery
        // continues on the same operation until the provider exposes its result.
        if (binding.deployment_dispatched_at)
          throw new GoogleCalendarCheckError("trigger_deployment_ambiguous");
        let providerAttempted = false;
        try {
          requireGoogleCalendarSettlement(
            await googleCalendarLifetimeRpc<boolean>(
              "begin_pipedream_trigger_deployment_effect",
              { ...fence, p_deployment_operation_id: binding.deployment_operation_id },
              providerDeadline,
            ),
          );
          observed = await provider(() => {
            providerAttempted = true;
            return deployPipedreamTrigger({
              ...scope,
              key: COMPONENT_KEY,
              version,
              configuredProps: {
                googleCalendar: { authProvisionId: accountId },
                calendarIds: blockingIds,
                newOnly: false,
              },
            });
          });
          // Contradictory returned identities remain owned for cleanup, never
          // reusable version proof when a later definition omits its optional ID.
          deploymentResponse =
            (!pinned.id || pinned.id === observed.componentId) &&
            (observed.componentKey === null || observed.componentKey === pinned.key);
        } catch (error) {
          // Only this attempted create can disprove its dispatch marker. A later
          // inventory/auth failure must not clear an earlier ambiguous operation.
          deploymentDefinitelyRejected =
            !providerAttempted ||
            (error instanceof PipedreamError &&
              error.requestOperation === "Pipedream trigger deployment" &&
              error.dispatched === false) ||
            (error instanceof PipedreamRequestError &&
              error.operation === "Pipedream trigger deployment" &&
              error.layer === "pipedream" &&
              [400, 401, 403, 404, 422, 429].includes(error.status));
          if (
            deploymentDefinitelyRejected &&
            (await googleCalendarLifetimeRpc<boolean>(
              "record_pipedream_trigger_deployment_result",
              {
                p_binding_id: binding.id,
                p_deployment_operation_id: binding.deployment_operation_id,
                p_lease_token: leaseToken,
                p_fencing_token: fence.p_fencing_token,
                p_deployed_trigger_id: null,
                p_definitely_rejected: true,
              },
              deadlineAt,
            ))
          )
            return;
          throw error;
        }
      }
      // Record effect ownership before judging compatibility so an incompatible
      // create remains discoverable for fenced retirement, never healthy adoption.
      requireGoogleCalendarSettlement(
        await googleCalendarLifetimeRpc<boolean>(
          "adopt_pipedream_trigger_candidate",
          {
            ...fence,
            p_deployed_trigger_id: observed.id,
            p_deployment_operation_id: binding.deployment_operation_id,
            ...(deploymentResponse ? { p_component_id: observed.componentId } : {}),
          },
          deadlineAt,
        ),
      );
      if (deploymentResponse) {
        binding.deployment_receipt = {
          trigger_id: observed.id,
          component_id: observed.componentId,
          component_key: COMPONENT_KEY,
          component_version: version,
          operation_id: binding.deployment_operation_id!,
        };
      }
      if (observedVersion(observed, pinned, binding.deployment_receipt) !== version)
        throw new GoogleCalendarCheckError("trigger_version_unverified");
      if (!observed.active || !triggerMatches(observed, binding))
        throw new GoogleCalendarCheckError("trigger_contract_mismatch");
    }
    if (!observed) throw new GoogleCalendarCheckError("trigger_missing");
    const triggerId = observed.id;
    const expectedUrl = pipedreamTriggerWebhookUrl({
      environment: scope.environment,
      bindingId: binding.id,
      accountId,
      correlationId: binding.webhook_correlation_id,
      triggerId,
    });
    let webhook: Awaited<ReturnType<typeof getPipedreamTriggerWebhook>> | null = null;
    if (binding.webhook_id && triggerId === binding.deployed_trigger_id) {
      try {
        webhook = await provider(() =>
          getPipedreamTriggerWebhook({ ...scope, triggerId, webhookId: binding.webhook_id! }),
        );
        if (webhook.id !== binding.webhook_id)
          throw new GoogleCalendarCheckError("trigger_webhook_mismatch");
      } catch (error) {
        if (!scopedMissing(error, "Pipedream webhook lookup")) throw error;
      }
    }
    if (!webhook || webhook.url !== expectedUrl || !webhook.signingKey.trim()) {
      if (!allowRepair) throw new GoogleCalendarCheckError("trigger_webhook_mismatch");
      requireGoogleCalendarSettlement(
        await googleCalendarLifetimeRpc<boolean>(
          "adopt_pipedream_trigger_candidate",
          {
            ...fence,
            p_deployed_trigger_id: triggerId,
            p_deployment_operation_id: binding.deployment_operation_id,
          },
          providerDeadline,
        ),
      );
      const configured = await provider(() =>
        configurePipedreamTriggerWebhook({ ...scope, triggerId, webhookUrl: expectedUrl }),
      );
      webhook = await provider(() =>
        getPipedreamTriggerWebhook({ ...scope, triggerId, webhookId: configured.id }),
      );
      if (webhook.id !== configured.id || webhook.url !== expectedUrl || !webhook.signingKey.trim())
        throw new GoogleCalendarCheckError("trigger_webhook_mismatch");
    }
    requireGoogleCalendarSettlement(
      await googleCalendarLifetimeRpc<GoogleCalendarBinding>(
        "apply_pipedream_trigger_projection",
        {
          ...fence,
          p_webhook_correlation_id: binding.webhook_correlation_id,
          p_profile_id: scope.profileId,
          p_environment: scope.environment,
          p_connection_id: connection.id,
          p_pipedream_account_id: accountId,
          p_component_key: COMPONENT_KEY,
          p_component_version: binding.component_version,
          p_selected_calendar_ids: blockingIds,
          p_deployed_trigger_id: triggerId,
          p_webhook_id: webhook.id,
          p_signing_key: webhook.signingKey,
          p_active: true,
          p_provider_updated_at: webhook.updatedAt,
          p_safe_error: null,
          p_deployment_operation_id: binding.deployment_operation_id,
          p_expected_connection_revision: connection.connection_revision,
          p_observed_component_key: observed.componentKey ?? pinned.key,
          p_observed_component_version: observedVersion(
            observed,
            pinned,
            binding.deployment_receipt,
          ),
        },
        deadlineAt,
      ),
    );
  } catch (error) {
    if (error instanceof GoogleCalendarStateError && !deploymentDefinitelyRejected) throw error;
    const reason =
      error instanceof GoogleCalendarCheckError ? error.reason : classifiedReason(error);
    if (!accountVerified && !claim.cleanup_only)
      requireGoogleCalendarSettlement(
        await googleCalendarLifetimeRpc<boolean>(
          "mark_google_calendar_connection_unhealthy",
          {
            ...fence,
            p_disconnected:
              (error instanceof GoogleCalendarCheckError && error.disconnected) ||
              reason === "provider_reauthorization_required",
            p_reason: reason,
          },
          deadlineAt,
        ),
      );
    requireGoogleCalendarSettlement(
      await googleCalendarLifetimeRpc<boolean>(
        "fail_pipedream_binding_reconciliation",
        {
          ...fence,
          p_safe_error: reason,
          p_deployment_definitely_rejected: deploymentDefinitelyRejected,
          p_observed_trigger: observed
            ? {
                id: observed.id,
                componentKey: observed.componentKey,
                componentVersion: observedVersion(observed, pinned, binding.deployment_receipt),
              }
            : null,
        },
        deadlineAt,
      ),
    );
    throw new GoogleCalendarCheckError(reason);
  }
}

/** Tenant/revision-scoped maintenance. The public consumer must pass allowRepair:false. */
export async function refreshSavedGoogleCalendar(input: {
  profileId: string;
  environment: GoogleCalendarEnvironment;
  allowRepair: boolean;
  deadlineAt: number;
  resumeSetup?: boolean;
}): Promise<{ checked: boolean }> {
  if (!Number.isFinite(input.deadlineAt) || !["test", "live"].includes(input.environment))
    throw new Error("Invalid Google Calendar verification scope");
  if (Date.now() + START_WORK_MS >= input.deadlineAt) return { checked: false };
  const leaseToken = randomUUID();
  if (input.resumeSetup && input.allowRepair) {
    const probe = await googleCalendarLifetimeRpc<GoogleCalendarSetupProbe | null>(
      "claim_google_calendar_setup_probe",
      {
        p_environment: input.environment,
        p_profile_id: input.profileId,
        p_lease_token: leaseToken,
      },
      input.deadlineAt - SETTLEMENT_MS,
    );
    if (probe) {
      if (probe.profile_id !== input.profileId || probe.environment !== input.environment)
        throw new GoogleCalendarStateError();
      await runGoogleCalendarSetupProbe({ probe, leaseToken, deadlineAt: input.deadlineAt });
      if (Date.now() + START_WORK_MS >= input.deadlineAt) return { checked: true };
    }
  }
  const claim = await googleCalendarLifetimeRpc<SavedGoogleCalendarClaim | null>(
    "claim_saved_google_calendar_verification",
    {
      p_profile_id: input.profileId,
      p_environment: input.environment,
      p_lease_token: leaseToken,
      p_lease_seconds: Math.min(90, Math.ceil((input.deadlineAt - Date.now()) / 1000) + 5),
      p_allow_repair: input.allowRepair,
    },
    input.deadlineAt - SETTLEMENT_MS,
  );
  if (!claim) return { checked: false };
  if (
    claim.connection.profile_id !== input.profileId ||
    claim.connection.environment !== input.environment
  )
    throw new GoogleCalendarStateError();
  await reconcileSavedClaim({ ...input, claim, leaseToken });
  return { checked: true };
}

/** Resume the durable, owner-authorized identity, including after the current account changed. */
export async function resumeGoogleCalendarDisconnect(input: {
  environment: GoogleCalendarEnvironment;
  deadlineAt: number;
  disconnectId?: string;
  attemptedIds?: string[];
}): Promise<{ checked: boolean; disconnected: boolean }> {
  if (Date.now() + START_WORK_MS >= input.deadlineAt)
    return { checked: false, disconnected: false };
  const leaseToken = randomUUID();
  const claim = await googleCalendarLifetimeRpc<GoogleCalendarDisconnectClaim | null>(
    "claim_booking_provider_account_disconnect_v3",
    {
      p_environment: input.environment,
      p_lease_token: leaseToken,
      p_disconnect_id: input.disconnectId ?? null,
      p_exclude_ids: input.attemptedIds ?? [],
    },
    input.deadlineAt - SETTLEMENT_MS,
  );
  if (!claim) return { checked: false, disconnected: false };
  if (
    claim.environment !== input.environment ||
    (input.disconnectId && claim.id !== input.disconnectId)
  )
    throw new GoogleCalendarStateError();
  if (claim.state === "completed") return { checked: false, disconnected: true };
  input.attemptedIds?.push(claim.id);
  const providerDeadline = Math.min(
    input.deadlineAt - SETTLEMENT_MS,
    Date.parse(claim.lease_expires_at) - SETTLEMENT_MS,
  );
  const fence = {
    p_disconnect_id: claim.id,
    p_profile_id: claim.profile_id,
    p_environment: claim.environment,
    p_provider_account_id: claim.provider_account_id,
    p_lease_token: leaseToken,
    p_fencing_token: claim.fencing_token,
  };
  requireGoogleCalendarSettlement(
    await googleCalendarLifetimeRpc<boolean>(
      "begin_booking_provider_account_disconnect_v3",
      fence,
      providerDeadline,
    ),
  );
  try {
    await withPipedreamDeadline(providerDeadline, () =>
      deletePipedreamAccount({
        profileId: claim.profile_id,
        environment: claim.environment,
        accountId: claim.provider_account_id,
      }),
    );
  } catch (error) {
    requireGoogleCalendarSettlement(
      await googleCalendarLifetimeRpc<boolean>(
        "fail_booking_provider_account_disconnect_v3",
        { ...fence, p_reason: classifiedReason(error) },
        input.deadlineAt,
      ),
    );
    throw new GoogleCalendarCheckError("provider_disconnect_pending");
  }
  requireGoogleCalendarSettlement(
    await googleCalendarLifetimeRpc<boolean>(
      "complete_booking_provider_account_disconnect_v3",
      fence,
      input.deadlineAt,
    ),
  );
  return { checked: true, disconnected: true };
}

export async function reconcileDuePipedreamTriggers(
  limit = 25,
  options?: { environment: GoogleCalendarEnvironment; deadlineAt: number },
) {
  const environment = options?.environment ?? process.env.BOOKING_WORKER_ENVIRONMENT;
  const deadlineAt = options?.deadlineAt ?? Date.now() + 25_000;
  if ((environment !== "test" && environment !== "live") || !Number.isFinite(deadlineAt))
    throw new Error("Pipedream maintenance requires an explicit environment and deadline");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid Pipedream maintenance limit");
  const result = {
    checked: 0,
    reconciled: 0,
    failed: 0,
    disconnects: 0,
    probes: 0,
    deadlineReached: false,
  };
  const attemptedDisconnects: string[] = [];
  const attemptedProbes: string[] = [];
  const attemptedBindings: string[] = [];
  let stopped = false;
  // One just-in-time claim per class runs concurrently, so slow setup/disconnect
  // cannot consume another class's wall-clock opportunity. Each wave divides the
  // remaining item budget fairly; empty classes lend unused shares in the next wave.
  for (
    let turn = 0, empty = 0;
    result.checked < limit && empty < 3 && Date.now() + START_WORK_MS < deadlineAt;
  ) {
    const remaining = limit - result.checked;
    const opportunities = Array.from({ length: Math.min(3, remaining) }, (_, index) => {
      const workClass = turn++ % 3;
      const share = Math.floor(remaining / 3) + (index < remaining % 3 ? 1 : 0);
      return withWorkerDeadline(deadlineAt, async () => {
        let checked = 0;
        while (!stopped && checked < share && Date.now() + START_WORK_MS < deadlineAt) {
          let bindingId: string | undefined;
          let fencingToken: number | undefined;
          try {
            if (workClass === 0) {
              const disconnect = await resumeGoogleCalendarDisconnect({
                environment,
                deadlineAt,
                attemptedIds: attemptedDisconnects,
              });
              if (!disconnect.checked) return checked;
              result.disconnects++;
            } else {
              const leaseToken = randomUUID();
              if (workClass === 1) {
                const probe: GoogleCalendarSetupProbe | null =
                  await googleCalendarLifetimeRpc<GoogleCalendarSetupProbe | null>(
                    "claim_google_calendar_setup_probe",
                    {
                      p_environment: environment,
                      p_lease_token: leaseToken,
                      p_exclude_operation_ids: attemptedProbes,
                    },
                    deadlineAt - SETTLEMENT_MS,
                  );
                if (!probe) return checked;
                if (probe.environment !== environment) throw new GoogleCalendarStateError();
                attemptedProbes.push(probe.id);
                result.probes++;
                await runGoogleCalendarSetupProbe({ probe, leaseToken, deadlineAt });
              } else {
                const claims: SavedGoogleCalendarClaim[] = await googleCalendarLifetimeRpc<
                  SavedGoogleCalendarClaim[]
                >(
                  "claim_due_pipedream_bindings",
                  {
                    p_environment: environment,
                    p_lease_token: leaseToken,
                    p_limit: 1,
                    p_exclude_binding_ids: attemptedBindings,
                    p_lease_seconds: Math.min(90, Math.ceil((deadlineAt - Date.now()) / 1000) + 5),
                  },
                  deadlineAt - SETTLEMENT_MS,
                );
                if (!Array.isArray(claims)) throw new GoogleCalendarStateError();
                if (!claims.length) return checked;
                if (claims.length !== 1 || claims[0].connection.environment !== environment)
                  throw new GoogleCalendarStateError();
                attemptedBindings.push(claims[0].binding.id);
                bindingId = claims[0].binding.id;
                fencingToken = claims[0].binding.reconciliation_fencing_token;
                await reconcileSavedClaim({
                  claim: claims[0],
                  leaseToken,
                  allowRepair: true,
                  deadlineAt,
                });
              }
            }
            result.checked++;
            result.reconciled++;
          } catch (error) {
            // Failed or indeterminate SQL settlement remains an invocation failure.
            if (error instanceof GoogleCalendarStateError) {
              stopped = true;
              throw error;
            }
            result.checked++;
            result.failed++;
            console.error("[google calendar maintenance]", {
              environment,
              bindingId,
              fencingToken,
              reason:
                error instanceof GoogleCalendarCheckError ? error.reason : classifiedReason(error),
            });
          }
          checked++;
        }
        return checked;
      });
    });
    // Await every claimed item's outcome, including when a sibling loses its fence.
    const settled = await Promise.allSettled(opportunities);
    const failed = settled.find((item) => item.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    empty = settled.some((item) => item.status === "fulfilled" && item.value)
      ? 0
      : empty + settled.length;
  }
  result.deadlineReached = Date.now() + START_WORK_MS >= deadlineAt;
  return { ...result, success: result.failed === 0 && !result.deadlineReached };
}
