import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { AvailabilityEditor } from "@/components/booking/AvailabilityEditor";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getBookingSetup } from "@/lib/booking-setup.functions";
import {
  completeGoogleCalendarConnection,
  discoverGoogleCalendarAccounts,
  discoverGoogleCalendars,
  loadGoogleCalendarConfiguration,
  refreshGoogleCalendarConnection,
  saveGoogleCalendarSelection,
  startGoogleCalendarConnect,
} from "@/lib/booking-provider.functions";
import { isGoogleAccountEmail } from "@/lib/google-calendar-complete";
import { googleCalendarConnectionStatus } from "@/lib/google-calendar-readiness";
import type { PurchaserOverview } from "@/lib/template-purchase.functions";
import {
  getStripeConnectStatus,
  openStripeExpressDashboard,
  reconcileStripeConnect,
  startStripeConnectOnboarding,
} from "@/lib/stripe-connect.functions";
import { cn } from "@/lib/utils";

type ConnectMarker = "success" | "error" | "return" | "refresh" | undefined;

type CalendarConfig = Awaited<ReturnType<typeof loadGoogleCalendarConfiguration>>;
const MAX_COMPLETION_ATTEMPTS = 3;

function namedAccountEmail(value: string | null | undefined): string | null {
  return isGoogleAccountEmail(value) ? value.trim() : null;
}

function PulseDot({ tone }: { tone: "live" | "busy" | "warn" }) {
  const color =
    tone === "live" ? "bg-emerald-500" : tone === "busy" ? "bg-sky-500" : "bg-amber-500";
  return (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      <span
        className={cn(
          "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:animate-none",
          color,
        )}
      />
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}

export function StepTwoCard({
  websiteId,
  userId,
  readiness,
  statusUnknown: overviewStatusUnknown,
  isOwner,
  connect,
  onChanged,
  onConnectConsumed,
}: {
  websiteId: string;
  userId: string;
  readiness: PurchaserOverview["readiness"];
  statusUnknown: boolean;
  isOwner: boolean;
  connect: ConnectMarker;
  onChanged: () => void | Promise<void>;
  onConnectConsumed: () => void;
}) {
  const returnPath = `/user/${userId}?websiteId=${websiteId}`;
  const environment = readiness.environment;
  const connection = readiness.calendarConnection;
  const statusUnknown = overviewStatusUnknown || connection.reason === "verification_unknown";
  const pendingSetup = connection.pendingSetup;
  const connectionRevision = connection.connectionRevision;
  const pendingSetupKey = pendingSetup?.configurationKey ?? null;
  const [busy, setBusy] = useState<
    "connect" | "complete" | "check" | "accounts" | "calendars" | "save" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedConfig, setLoadedConfig] = useState<{
    websiteId: string;
    userId: string;
    environment: "test" | "live";
    value: CalendarConfig;
  } | null>(null);
  const saved =
    loadedConfig?.websiteId === websiteId &&
    loadedConfig.userId === userId &&
    loadedConfig.environment === environment
      ? loadedConfig.value
      : null;
  const selection = saved?.pendingSetup ?? saved;
  const savedSetupKey = saved?.pendingSetup?.configurationKey ?? null;
  const accountId = pendingSetup ? (saved?.pendingSetup?.accountId ?? null) : connection.accountId;
  const [configError, setConfigError] = useState(false);
  const [cancelled, setCancelled] = useState(connect === "error");
  const [completionFailed, setCompletionFailed] = useState(false);
  const [completionAttempts, setCompletionAttempts] = useState(0);
  const [accountChoices, setAccountChoices] = useState<{
    accounts: Awaited<ReturnType<typeof discoverGoogleCalendarAccounts>>["accounts"];
    selectedId: string;
    baseAccountId: string | null;
    connectionRevision: number;
    pendingSetupKey: string | null;
  } | null>(null);
  const [editor, setEditor] = useState<{
    accountId: string;
    // The source configuration stays the fence when the owner explicitly chooses a replacement.
    baseAccountId: string | null;
    connectionRevision: number;
    pendingSetupKey: string | null;
    accountLabel: string;
    calendars: Awaited<ReturnType<typeof discoverGoogleCalendars>>["calendars"];
  } | null>(null);
  const [blockingIds, setBlockingIds] = useState<string[]>([]);
  const [destinationId, setDestinationId] = useState("");
  const handledRef = useRef<ConnectMarker>(undefined);
  const requestScope = useRef<{
    websiteId: string;
    userId: string;
    environment: "test" | "live";
    connectionRevision: number | null;
    accountId: string | null;
    pendingSetupKey: string | null;
    load: number;
    completing: boolean;
    completionAttempts: number;
    discoveryRequest: number;
    reviewAccountId: string | null;
    canSelectAccount: boolean;
    statusUnknown: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const scope = {
      websiteId,
      userId,
      environment,
      connectionRevision: null as number | null,
      accountId: null as string | null,
      pendingSetupKey: null as string | null,
      load: 0,
      completing: false,
      completionAttempts: 0,
      discoveryRequest: 0,
      reviewAccountId: null as string | null,
      canSelectAccount: false,
      statusUnknown: true,
    };
    requestScope.current = scope;
    setLoadedConfig(null);
    setConfigError(false);
    setMessage(null);
    setBusy(null);
    setEditor(null);
    setAccountChoices(null);
    setCancelled(false);
    setCompletionFailed(false);
    setCompletionAttempts(0);
    handledRef.current = undefined;
    return () => {
      if (requestScope.current === scope) requestScope.current = null;
    };
  }, [websiteId, userId, environment, isOwner]);

  useLayoutEffect(() => {
    const scope = requestScope.current;
    if (!scope) return;
    scope.connectionRevision = connectionRevision;
    scope.accountId = accountId;
    scope.pendingSetupKey = pendingSetupKey;
    scope.load += 1;
  }, [websiteId, userId, environment, isOwner, connectionRevision, accountId, pendingSetupKey]);

  const reload = useCallback(async () => {
    const scope = requestScope.current;
    if (
      !isOwner ||
      scope?.websiteId !== websiteId ||
      scope.userId !== userId ||
      scope.environment !== environment
    )
      return;
    const load = ++scope.load;
    try {
      const next = await loadGoogleCalendarConfiguration({ data: { websiteId } });
      if (requestScope.current === scope && scope.load === load) {
        setLoadedConfig({ websiteId, userId, environment, value: next });
        setConfigError(false);
      }
    } catch {
      if (requestScope.current === scope && scope.load === load) setConfigError(true);
    }
  }, [websiteId, userId, environment, isOwner]);

  useEffect(() => {
    void reload();
  }, [reload, connectionRevision, connection.accountId, pendingSetupKey, statusUnknown]);

  const refreshFacts = useCallback(
    async (scope: NonNullable<typeof requestScope.current>) => {
      if (requestScope.current !== scope) return;
      try {
        await onChanged();
      } catch {
        // The overview retains saved forms and marks failed fact reads as unknown.
      }
      if (requestScope.current === scope) await reload();
    },
    [onChanged, reload],
  );

  const state = statusUnknown
    ? "unknown"
    : busy === "check"
      ? pendingSetup
        ? "setup_pending"
        : "checking"
      : googleCalendarConnectionStatus(connection, readiness.calendar === "ready");
  const configurationCurrent = Boolean(
    saved &&
    !configError &&
    saved.connectionRevision === connection.connectionRevision &&
    saved.accountId === connection.accountId &&
    savedSetupKey === pendingSetupKey,
  );
  const editorConflict = Boolean(
    editor &&
    (editor.connectionRevision !== (connectionRevision ?? 0) ||
      editor.baseAccountId !== accountId ||
      editor.pendingSetupKey !== pendingSetupKey ||
      (selection &&
        (editor.connectionRevision !== (selection.connectionRevision ?? 0) ||
          editor.baseAccountId !== selection.accountId ||
          editor.pendingSetupKey !== savedSetupKey))),
  );
  const canConfigure =
    isOwner &&
    saved?.canConfigure === true &&
    readiness.plan === "pro" &&
    readiness.orderConfirmed &&
    !readiness.entitlementUnavailable;
  const canCheck =
    isOwner &&
    (statusUnknown ||
      (canConfigure && Boolean(connection.accountId || pendingSetup) && state !== "disconnected"));
  const accountChoicesCurrent = Boolean(
    accountChoices &&
    accountChoices.baseAccountId === accountId &&
    accountChoices.connectionRevision === (connectionRevision ?? 0) &&
    accountChoices.pendingSetupKey === pendingSetupKey,
  );

  useLayoutEffect(() => {
    if (requestScope.current) {
      requestScope.current.canSelectAccount =
        canConfigure && configurationCurrent && !statusUnknown;
      requestScope.current.statusUnknown = statusUnknown;
    }
  }, [canConfigure, configurationCurrent, statusUnknown, websiteId, userId, environment, isOwner]);

  const completeConnection = useCallback(async () => {
    const scope = requestScope.current;
    if (
      !canConfigure ||
      connect !== "success" ||
      handledRef.current !== "success" ||
      statusUnknown ||
      configError ||
      busy ||
      scope?.websiteId !== websiteId ||
      scope.userId !== userId ||
      scope.environment !== environment ||
      scope.statusUnknown ||
      scope.completing ||
      scope.completionAttempts >= MAX_COMPLETION_ATTEMPTS
    )
      return;
    scope.completing = true;
    scope.completionAttempts += 1;
    setCompletionAttempts(scope.completionAttempts);
    setCompletionFailed(false);
    setBusy("complete");
    setMessage(null);
    let completed = false;
    try {
      // The existing handler rechecks the owner, browser cookie, operation and expiry.
      await completeGoogleCalendarConnection({ data: { websiteId } });
      completed = true;
    } catch {
      if (requestScope.current === scope && handledRef.current === "success") {
        setCompletionFailed(true);
        setMessage(
          scope.completionAttempts < MAX_COMPLETION_ATTEMPTS
            ? "Google setup could not be confirmed. Retry completion, or choose a connected account to explicitly review and save its calendars without another Google sign-in."
            : "Google setup could not be confirmed. Completion retries are paused for this visit. Choose a connected account, check saved setup, or contact support before starting another Google sign-in.",
        );
      }
    } finally {
      await refreshFacts(scope);
      if (requestScope.current === scope) {
        scope.completing = false;
        setBusy(null);
        if (completed && handledRef.current === "success") {
          setCompletionFailed(false);
          onConnectConsumed();
        }
      }
    }
  }, [
    canConfigure,
    connect,
    statusUnknown,
    configError,
    busy,
    websiteId,
    userId,
    environment,
    refreshFacts,
    onConnectConsumed,
  ]);

  useEffect(() => {
    if (connect !== "success" && connect !== "error") {
      handledRef.current = undefined;
      setCompletionFailed(false);
      return;
    }
    if (handledRef.current === connect) return;
    const scope = requestScope.current;
    if (!scope || (connect === "success" && isOwner && !saved)) return;
    if (!canConfigure || connect === "error") {
      handledRef.current = connect;
      setCompletionFailed(false);
      if (connect === "error") setCancelled(true);
      onConnectConsumed();
      return;
    }
    if (statusUnknown || configError || busy) return;
    handledRef.current = connect;
    void completeConnection();
  }, [
    connect,
    canConfigure,
    isOwner,
    saved,
    statusUnknown,
    configError,
    busy,
    onConnectConsumed,
    completeConnection,
  ]);

  async function startConnect(replace: boolean) {
    const scope = requestScope.current;
    if (
      !canConfigure ||
      !configurationCurrent ||
      statusUnknown ||
      busy ||
      scope?.websiteId !== websiteId ||
      scope.userId !== userId ||
      !scope.canSelectAccount ||
      scope.connectionRevision !== connectionRevision ||
      scope.accountId !== accountId ||
      scope.pendingSetupKey !== savedSetupKey
    )
      return;
    if (replace) {
      const confirmed = window.confirm(
        "New bookings will use the new Google account. Continue connecting a different account?",
      );
      if (!confirmed) return;
    }
    setBusy("connect");
    setMessage(null);
    try {
      const result = await startGoogleCalendarConnect({ data: { websiteId, returnPath } });
      if (requestScope.current !== scope) return;
      window.location.assign(result.url);
    } catch (error) {
      if (requestScope.current !== scope) return;
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open Google setup. Please try again. [client-non-error]",
      );
      setBusy(null);
    }
  }

  async function checkStatus() {
    const scope = requestScope.current;
    if (!canCheck || busy || scope?.websiteId !== websiteId || scope.userId !== userId) return;
    setBusy("check");
    setMessage(null);
    try {
      // Unknown overview facts permit another GET, not a provider mutation based on old setup.
      if (!statusUnknown && !scope.statusUnknown)
        await refreshGoogleCalendarConnection({ data: { websiteId } });
    } catch {
      if (requestScope.current === scope)
        setMessage("Unable to check Google Calendar right now. Your saved settings are unchanged.");
    } finally {
      await refreshFacts(scope);
      if (requestScope.current === scope) setBusy(null);
    }
  }

  async function chooseAccount() {
    const scope = requestScope.current;
    if (
      !canConfigure ||
      !configurationCurrent ||
      statusUnknown ||
      busy ||
      scope?.websiteId !== websiteId ||
      scope.userId !== userId ||
      !scope.canSelectAccount
    )
      return;
    const request = ++scope.discoveryRequest;
    setBusy("accounts");
    setMessage(null);
    try {
      const next = await discoverGoogleCalendarAccounts({ data: { websiteId } });
      if (
        requestScope.current !== scope ||
        scope.discoveryRequest !== request ||
        !scope.canSelectAccount
      )
        return;
      if (
        scope.connectionRevision !== connectionRevision ||
        scope.accountId !== accountId ||
        scope.pendingSetupKey !== pendingSetupKey
      ) {
        setMessage(
          "Google Calendar configuration changed. Choose an account again after reloading details.",
        );
        return;
      }
      setAccountChoices({
        accounts: next.accounts,
        selectedId: "",
        baseAccountId: accountId,
        connectionRevision: connectionRevision ?? 0,
        pendingSetupKey,
      });
    } catch {
      if (requestScope.current === scope && scope.discoveryRequest === request)
        setMessage("Unable to list connected accounts. Your calendar choices are unchanged.");
    } finally {
      if (requestScope.current === scope && scope.discoveryRequest === request) setBusy(null);
    }
  }

  async function reviewCalendars(chosenAccountId?: string) {
    const scope = requestScope.current;
    const chosen =
      chosenAccountId === undefined
        ? null
        : accountChoices?.accounts.find(
            (account) => account.id === chosenAccountId && account.healthy,
          );
    const targetAccountId = chosen?.id ?? selection?.accountId;
    const expectedRevision = chosen
      ? accountChoices!.connectionRevision
      : (selection?.connectionRevision ?? 0);
    const baseAccountId = chosen ? accountChoices!.baseAccountId : accountId;
    const expectedSetupKey = chosen ? accountChoices!.pendingSetupKey : savedSetupKey;
    if (
      !canConfigure ||
      (chosenAccountId === undefined ? !canReview : !chosen || !accountChoicesCurrent) ||
      !configurationCurrent ||
      statusUnknown ||
      !targetAccountId ||
      (busy && !(chosen && busy === "calendars")) ||
      scope?.websiteId !== websiteId ||
      scope.userId !== userId ||
      !scope.canSelectAccount ||
      (scope.connectionRevision ?? 0) !== expectedRevision ||
      scope.accountId !== baseAccountId ||
      scope.pendingSetupKey !== expectedSetupKey
    )
      return;
    if (
      editor &&
      !window.confirm(
        chosen
          ? `Replace your unsaved calendar choices with calendars for ${chosen.name}? Nothing changes until you save.`
          : "Replace your unsaved calendar choices with the current saved configuration?",
      )
    )
      return;
    const request = ++scope.discoveryRequest;
    scope.reviewAccountId = targetAccountId;
    if (chosen) setAccountChoices((current) => current && { ...current, selectedId: chosen.id });
    else setAccountChoices(null);
    setBusy("calendars");
    setMessage(null);
    try {
      const next = await discoverGoogleCalendars({
        data: {
          websiteId,
          accountId: targetAccountId,
          expectedRevision,
          expectedSetupKey,
        },
      });
      if (
        requestScope.current !== scope ||
        scope.discoveryRequest !== request ||
        !scope.canSelectAccount
      )
        return;
      if (
        (scope.connectionRevision ?? 0) !== expectedRevision ||
        scope.accountId !== baseAccountId ||
        scope.pendingSetupKey !== expectedSetupKey
      ) {
        setMessage("Google Calendar configuration changed. Review the current calendars again.");
        return;
      }
      setEditor({
        accountId: targetAccountId,
        baseAccountId,
        connectionRevision: expectedRevision,
        pendingSetupKey: expectedSetupKey,
        accountLabel:
          chosen?.name ?? (saved?.pendingSetup ? null : saved?.accountEmail) ?? targetAccountId,
        calendars: next.calendars,
      });
      const sameAccount = targetAccountId === selection?.accountId;
      setBlockingIds(sameAccount ? selection.blockingCalendarIds : []);
      setDestinationId(sameAccount ? (selection.destinationCalendarId ?? "") : "");
    } catch {
      if (requestScope.current === scope && scope.discoveryRequest === request) {
        setMessage("Unable to list calendars right now. Your saved selections are unchanged.");
        await refreshFacts(scope);
      }
    } finally {
      if (requestScope.current === scope && scope.discoveryRequest === request) setBusy(null);
    }
  }

  async function saveCalendars() {
    const scope = requestScope.current;
    if (
      editorDisabled ||
      !configurationCurrent ||
      statusUnknown ||
      !editor ||
      editorConflict ||
      !blockingIds.length ||
      !destinationId ||
      busy ||
      scope?.websiteId !== websiteId ||
      scope.userId !== userId ||
      !scope.canSelectAccount ||
      scope.reviewAccountId !== editor.accountId ||
      (scope.connectionRevision ?? 0) !== editor.connectionRevision ||
      scope.accountId !== editor.baseAccountId ||
      scope.pendingSetupKey !== editor.pendingSetupKey
    )
      return;
    setBusy("save");
    setMessage(null);
    try {
      await saveGoogleCalendarSelection({
        data: {
          websiteId,
          accountId: editor.accountId,
          expectedRevision: editor.connectionRevision,
          expectedSetupKey: editor.pendingSetupKey,
          blockingCalendarIds: blockingIds,
          destinationCalendarId: destinationId,
        },
      });
      if (requestScope.current !== scope) return;
      scope.reviewAccountId = null;
      setEditor(null);
      setAccountChoices(null);
      setCompletionFailed(false);
      if (connect === "success") onConnectConsumed();
    } catch {
      if (requestScope.current === scope)
        setMessage(
          "Unable to save these calendars. Your edits are still shown. Review the current configuration or restore calendar access before trying again.",
        );
    } finally {
      await refreshFacts(scope);
      if (requestScope.current === scope) setBusy(null);
    }
  }

  const email =
    isOwner && connection.accountId ? namedAccountEmail(readiness.calendarAccountEmail) : null;
  const connecting = busy === "complete";
  const active = state === "connected" && !connecting;
  const canReview =
    canConfigure && Boolean(accountId) && state !== "disconnected" && state !== "reconnect";
  const editorDisabled =
    !canConfigure ||
    (!canReview && editor?.accountId === accountId) ||
    !configurationCurrent ||
    statusUnknown ||
    editorConflict ||
    Boolean(accountChoices?.selectedId && accountChoices.selectedId !== editor?.accountId);
  const details = {
    setup_pending: {
      label: "Google Calendar setup is unfinished",
      text: "Your requested account and calendar choices are retained, but setup has not completed. Review calendars to change your choices, or check status to retry the existing setup. New bookings stay paused.",
    },
    unknown: {
      label: "Calendar status unknown",
      text: "Current calendar status could not be loaded. Your saved setup is still shown, but booking readiness cannot be confirmed. Retry the status check.",
    },
    connected: {
      label: "Calendar checks current",
      text: "Conflict checks, the booking destination, and monitoring have current evidence. New bookings still require availability and payment readiness.",
    },
    checking: {
      label: "Checking connection",
      text: "Your Google account and calendar selections are saved. New bookings are paused until current checks are available; repeating Google sign-in is not required.",
    },
    temporarily_unavailable: {
      label: "Temporarily unavailable",
      text: "Current calendar checks are unavailable. Your saved setup is unchanged and new bookings are paused. A failed check alone does not mean Google access was revoked.",
    },
    monitoring_repair: {
      label: "Monitoring repair",
      text: "Your Google setup is saved. Calendar monitoring needs repair before new bookings can be accepted. Signing in again will not repair monitoring.",
    },
    access_issue: {
      label: "Calendar access needs attention",
      text: "Access to a selected calendar or booking writes is blocked. Restore calendar permissions or review your selected calendars. New bookings are paused.",
    },
    service_issue: {
      label: "Calendar service issue",
      text: "The calendar service needs attention from Obra, not another Google sign-in. Your saved setup is unchanged and new bookings are paused. Contact support if this continues.",
    },
    reconnect: {
      label: "Google authorization needs renewal",
      text: "Google access must be authorized again. Reconnect to restore access; saved availability and payment settings are unchanged.",
    },
    disconnected: {
      label: "Google Calendar is disconnected",
      text: "Google Calendar was disconnected. Automatic checks will not reconnect it. Your availability and payment settings are unchanged.",
    },
    not_connected: {
      label: "Connect your Google account",
      text: "Connect Google Calendar to choose conflict calendars and a booking destination.",
    },
    selection_required: {
      label: "Choose calendars",
      text: "Choose at least one readable calendar for conflict checks and one writable booking destination. Your other saved setup is unchanged.",
    },
  }[state];

  return (
    <Card
      id="step-2"
      className={active ? "border-primary/30" : undefined}
      aria-busy={busy !== null}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Step 2 — Google Calendar
          {active ? <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" /> : null}
        </CardTitle>
        <CardDescription>
          Your saved Google setup is separate from current booking availability.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isOwner ? (
          <p className="text-sm text-muted-foreground">
            Only the business owner can check or change Google Calendar setup. These controls are
            unavailable while impersonating.
          </p>
        ) : saved && !canConfigure ? (
          <p className="text-sm text-muted-foreground" role="status">
            An active confirmed Pro order is required to check or change calendar setup. Saved
            calendar details are still visible.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={state === "reconnect" ? "destructive" : "secondary"} className="gap-2">
            <PulseDot
              tone={
                active
                  ? "live"
                  : connecting || state === "checking" || state === "setup_pending"
                    ? "busy"
                    : "warn"
              }
            />
            {connecting
              ? "Connecting"
              : state === "unknown"
                ? "Status unknown"
                : state === "disconnected"
                  ? "Disconnected"
                  : state === "reconnect"
                    ? "Reconnect required"
                    : pendingSetup
                      ? "Setup pending"
                      : state === "not_connected"
                        ? "Not connected"
                        : connection.configured
                          ? "Connected"
                          : "Setup incomplete"}
          </Badge>
          {email ? (
            <span className="break-all text-sm text-muted-foreground">
              {pendingSetup ? "Previously saved account: " : ""}
              {email}
            </span>
          ) : null}
        </div>
        <div className="space-y-1 text-sm" role="status" aria-live="polite">
          <p className="font-semibold">{connecting ? "Finishing Google setup" : details.label}</p>
          <p className="text-muted-foreground">
            {connecting
              ? "Confirming the account and selected calendars. This is not yet booking readiness."
              : details.text}
          </p>
        </div>
        {pendingSetup && state !== "setup_pending" && !connecting ? (
          <p className="text-sm text-muted-foreground" role="status">
            This setup has not completed. The requested account and choices have not replaced any
            saved configuration.{" "}
            {state === "reconnect"
              ? "Reconnect Google or connect a different account"
              : "Review calendars or check status"}{" "}
            to continue; new bookings stay paused.
          </p>
        ) : null}
        <dl className="space-y-1 text-xs text-muted-foreground">
          {[
            { label: "Last verification record", value: connection.lastVerifiedAt },
            { label: "Last monitoring signal", value: connection.lastHealthAt },
            {
              label: "Next check due",
              value:
                state === "disconnected"
                  ? null
                  : pendingSetup
                    ? pendingSetup.nextRetryAt
                    : connection.nextRetryAt,
            },
          ].map(({ label, value }) =>
            value && Number.isFinite(Date.parse(value)) ? (
              <div key={label} className="flex flex-wrap gap-x-2">
                <dt>{label}</dt>
                <dd>
                  <time dateTime={value}>{new Date(value).toLocaleString()}</time>
                </dd>
              </div>
            ) : null,
          )}
        </dl>
        {cancelled ? (
          <p className="text-sm text-muted-foreground" role="status">
            Google Calendar connection was cancelled.
            {email ? " Your previous connection is unchanged." : ""}
          </p>
        ) : null}
        {message ? (
          <p className="text-sm text-muted-foreground" role="status">
            {message}
          </p>
        ) : null}
        {isOwner && (configError || (saved && !configurationCurrent)) ? (
          <div className="space-y-2 text-sm">
            <p role="status">
              {configError
                ? "Unable to load saved calendar details. Previously loaded selections have been retained."
                : "Calendar configuration changed. Actions are paused until the current calendar details are loaded."}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                const scope = requestScope.current;
                if (scope) void refreshFacts(scope);
              }}
              disabled={busy !== null}
            >
              Reload calendar details
            </Button>
          </div>
        ) : isOwner && !saved ? (
          <p className="text-sm text-muted-foreground">Loading saved calendar details...</p>
        ) : null}
        {isOwner && !connecting ? (
          <div className="flex flex-wrap gap-3">
            {canConfigure && connect === "success" && completionFailed ? (
              <Button
                onClick={() => void completeConnection()}
                disabled={
                  busy !== null ||
                  statusUnknown ||
                  configError ||
                  completionAttempts >= MAX_COMPLETION_ATTEMPTS
                }
              >
                Retry completion
              </Button>
            ) : null}
            {canConfigure &&
            ((!connection.accountId && !pendingSetup) || state === "disconnected") &&
            state !== "reconnect" ? (
              <Button
                onClick={() => void startConnect(false)}
                disabled={busy !== null || !configurationCurrent || statusUnknown}
              >
                {busy ? "Opening Google…" : "Connect Google Calendar"}
              </Button>
            ) : null}
            {canConfigure && state === "reconnect" ? (
              <Button
                onClick={() => void startConnect(false)}
                disabled={busy !== null || !configurationCurrent || statusUnknown}
              >
                {busy === "connect" ? "Opening Google..." : "Reconnect Google"}
              </Button>
            ) : null}
            {canCheck ? (
              <Button variant="outline" onClick={() => void checkStatus()} disabled={busy !== null}>
                {busy === "check"
                  ? "Checking..."
                  : statusUnknown
                    ? "Retry calendar status"
                    : "Check status"}
              </Button>
            ) : null}
            {canReview ? (
              <Button
                variant="outline"
                onClick={() => void reviewCalendars()}
                disabled={busy !== null || !configurationCurrent || statusUnknown}
              >
                {busy === "calendars" ? "Loading calendars..." : "Review calendars"}
              </Button>
            ) : null}
            {canConfigure ? (
              <Button
                variant="outline"
                onClick={() => void chooseAccount()}
                disabled={busy !== null || !configurationCurrent || statusUnknown}
              >
                {busy === "accounts" ? "Loading accounts..." : "Choose connected account"}
              </Button>
            ) : null}
            {canConfigure && (connection.accountId || pendingSetup) && state !== "disconnected" ? (
              <Button
                variant="outline"
                onClick={() => void startConnect(true)}
                disabled={busy !== null || !configurationCurrent || statusUnknown}
              >
                Connect to different account
              </Button>
            ) : null}
          </div>
        ) : null}
        {isOwner && accountChoices ? (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p className="text-muted-foreground">
              Choose an already connected account to review its calendars. Saved or pending choices
              stay unchanged until you save. A different account starts with no calendars selected.
            </p>
            {selection?.accountId ? (
              <dl className="space-y-1 break-all text-xs text-muted-foreground">
                <dt>{saved?.pendingSetup ? "Pending setup account" : "Saved account"}</dt>
                <dd>
                  {saved?.pendingSetup
                    ? selection.accountId
                    : (saved?.accountEmail ?? selection.accountId)}
                </dd>
                <dt>Current conflict calendars</dt>
                <dd>{selection.blockingCalendarIds.join(", ") || "None"}</dd>
                <dt>Current booking destination</dt>
                <dd>{selection.destinationCalendarId ?? "None"}</dd>
              </dl>
            ) : null}
            <label className="block space-y-1">
              <span>Connected Google account</span>
              <select
                className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2"
                value={accountChoices.selectedId}
                disabled={
                  !canConfigure ||
                  !configurationCurrent ||
                  !accountChoicesCurrent ||
                  statusUnknown ||
                  (busy !== null && busy !== "calendars")
                }
                onChange={(event) => void reviewCalendars(event.target.value)}
              >
                <option value="" disabled>
                  Choose an account
                </option>
                {accountChoices.accounts.map((account) => (
                  <option key={account.id} value={account.id} disabled={!account.healthy}>
                    {account.name}
                    {account.healthy ? "" : " (unavailable)"}
                  </option>
                ))}
              </select>
            </label>
            {!accountChoices.accounts.some((account) => account.healthy) ? (
              <p role="status">
                No healthy connected accounts are available. Connect Google to authorize an account.
              </p>
            ) : null}
            {!accountChoicesCurrent ? (
              <p role="status">
                The configuration changed. Reload details and choose an account again.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  !accountChoices.selectedId ||
                  !canConfigure ||
                  !configurationCurrent ||
                  !accountChoicesCurrent ||
                  statusUnknown ||
                  busy !== null
                }
                onClick={() => void reviewCalendars(accountChoices.selectedId)}
              >
                Review account calendars
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null && busy !== "calendars"}
                onClick={() => {
                  if (requestScope.current) {
                    requestScope.current.discoveryRequest += 1;
                    requestScope.current.reviewAccountId = editor?.accountId ?? null;
                  }
                  setAccountChoices(null);
                  if (busy === "calendars") setBusy(null);
                }}
              >
                Close account choices
              </Button>
            </div>
          </div>
        ) : null}
        {isOwner && editor ? (
          <fieldset disabled={busy !== null} className="space-y-3 rounded-md border p-3 text-sm">
            <legend className="px-1 font-semibold">Selected calendars</legend>
            {editorConflict ? (
              <p role="alert">
                Google Calendar configuration changed in another session. Your unsaved choices below
                are preserved for {editor.accountLabel}. Cancel or review the current calendars
                before saving again.
              </p>
            ) : null}
            <p className="break-all">Account: {editor.accountLabel}</p>
            {editor.accountId !== editor.baseAccountId ? (
              <p className="text-muted-foreground">
                Choose conflict calendars and a writable destination for this account. Saving
                replaces the current saved or pending choices; existing bookings keep their original
                destination.
              </p>
            ) : null}
            <p className="text-muted-foreground">
              Use the full set of calendars that should block bookings.
            </p>
            {[...new Set([...blockingIds, ...editor.calendars.map((calendar) => calendar.id)])].map(
              (id) => {
                const calendar = editor.calendars.find((entry) => entry.id === id);
                return (
                  <label key={id} className="flex min-h-9 items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={editorDisabled}
                      checked={blockingIds.includes(id)}
                      onChange={(event) =>
                        setBlockingIds((ids) =>
                          event.target.checked ? [...ids, id] : ids.filter((value) => value !== id),
                        )
                      }
                    />
                    <span className="break-all">{calendar?.summary ?? `${id} (unavailable)`}</span>
                  </label>
                );
              },
            )}
            <label className="block space-y-1">
              <span>Booking destination</span>
              <select
                className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2"
                value={destinationId}
                disabled={editorDisabled}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                <option value="">Choose a writable calendar</option>
                {destinationId &&
                !editor.calendars.some(
                  (calendar) =>
                    calendar.id === destinationId &&
                    ["writer", "owner"].includes(calendar.accessRole),
                ) ? (
                  <option value={destinationId}>{destinationId} (unavailable)</option>
                ) : null}
                {editor.calendars
                  .filter((calendar) => ["writer", "owner"].includes(calendar.accessRole))
                  .map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.summary}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void saveCalendars()}
                disabled={editorDisabled || !blockingIds.length || !destinationId}
              >
                {busy === "save" ? "Saving..." : "Save calendars"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (requestScope.current) requestScope.current.reviewAccountId = null;
                  setEditor(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </fieldset>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function StepThreeCard({
  websiteId,
  locked,
  onChanged,
}: {
  websiteId: string;
  locked: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [availabilityInitial, setAvailabilityInitial] = useState<{
    websiteId: string;
    configuration: Awaited<ReturnType<typeof getBookingSetup>>["configuration"];
  } | null>(null);
  const initial =
    availabilityInitial?.websiteId === websiteId ? availabilityInitial.configuration : null;
  const [availabilityError, setAvailabilityError] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityReload, setAvailabilityReload] = useState(0);

  useLayoutEffect(() => {
    setAvailabilityLoading(true);
    setAvailabilityError(false);
    if (locked) return;
    let cancelled = false;
    getBookingSetup({ data: { websiteId } })
      .then((setup) => {
        if (cancelled) return;
        setAvailabilityInitial({ websiteId, configuration: setup.configuration });
        setAvailabilityLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Keep the mounted editor and its draft through a failed reload.
        setAvailabilityError(true);
        setAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [websiteId, locked, availabilityReload]);

  return (
    <Card
      id="step-3"
      aria-disabled={locked ? "true" : undefined}
      className={locked ? "opacity-70" : undefined}
    >
      <CardHeader>
        <CardTitle>Step 3 — Availability</CardTitle>
        <CardDescription>
          {locked
            ? "Connect Google Calendar first. Hours and price stay locked until Step 2 is connected."
            : "Business-wide setup: shared settings are reused for this Pro website. Save hours and price to unlock Stripe."}
        </CardDescription>
      </CardHeader>
      {!locked || initial ? (
        <CardContent>
          {initial ? (
            <AvailabilityEditor
              key={websiteId}
              websiteId={websiteId}
              initial={initial}
              disabled={locked || availabilityLoading || availabilityError}
              onSaved={onChanged}
            />
          ) : null}
          {!locked && availabilityError ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Unable to load the schedule. Saved settings are unchanged.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAvailabilityError(false);
                  setAvailabilityLoading(true);
                  setAvailabilityReload((count) => count + 1);
                }}
              >
                Retry schedule
              </Button>
            </div>
          ) : !locked && availabilityLoading ? (
            <p className="text-sm text-muted-foreground">Loading schedule…</p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

type StripeStatus = Awaited<ReturnType<typeof getStripeConnectStatus>>;

export function StepFourCard({
  websiteId,
  userId,
  locked,
  onboardingReady,
  connect,
  onChanged,
  onConnectConsumed,
}: {
  websiteId: string;
  userId: string;
  locked: boolean;
  onboardingReady: boolean;
  connect: ConnectMarker;
  onChanged: () => void | Promise<void>;
  onConnectConsumed: () => void;
}) {
  const returnPath = `/user/${userId}?websiteId=${websiteId}`;
  const [loadedStatus, setLoadedStatus] = useState<{
    websiteId: string;
    value: StripeStatus;
  } | null>(null);
  const status = loadedStatus?.websiteId === websiteId ? loadedStatus.value : null;
  const [busy, setBusy] = useState<"onboarding" | "verify" | "dashboard" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const handledRef = useRef<string | null>(null);
  const requestScope = useRef<{ websiteId: string } | null>(null);

  useEffect(() => {
    const scope = { websiteId };
    requestScope.current = scope;
    setLoadedStatus(null);
    setMessage(null);
    setBusy(null);
    handledRef.current = null;
    if (!locked) {
      getStripeConnectStatus({ data: { websiteId } })
        .then((next) => {
          if (requestScope.current === scope) setLoadedStatus({ websiteId, value: next });
        })
        .catch(() => {
          if (requestScope.current === scope) setMessage("Unable to load Stripe status");
        });
    }
    return () => {
      if (requestScope.current === scope) requestScope.current = null;
    };
  }, [websiteId, locked]);

  const canUseStripe = status !== null && status.environmentError === null && !locked;
  const creationEligible = canUseStripe && Boolean(status?.canOnboard) && onboardingReady;
  const canStartOnboarding = canUseStripe && Boolean(status?.connected || creationEligible);

  async function startOnboarding() {
    const scope = requestScope.current;
    if (!canStartOnboarding || !creationEligible || busy || scope?.websiteId !== websiteId) return;
    setBusy("onboarding");
    setMessage(null);
    try {
      const result = await startStripeConnectOnboarding({ data: { websiteId, returnPath } });
      if (requestScope.current !== scope) return;
      window.location.assign(result.url);
    } catch (error) {
      if (requestScope.current !== scope) return;
      setMessage(error instanceof Error ? error.message : "Unable to open Stripe setup");
      setBusy(null);
    }
  }

  async function verify() {
    const scope = requestScope.current;
    if (!canUseStripe || busy || scope?.websiteId !== websiteId) return;
    setBusy("verify");
    setMessage(null);
    try {
      const result = await reconcileStripeConnect({ data: { websiteId } });
      if (requestScope.current !== scope) return;
      setLoadedStatus({ websiteId, value: result });
      setMessage(
        result.environmentError
          ? null
          : result.onboardingState === "ready"
            ? "Stripe verified. Payments setup is ready."
            : "Stripe status updated. Complete any remaining steps to enable payments.",
      );
      await onChanged();
    } catch (error) {
      if (requestScope.current !== scope) return;
      setMessage(error instanceof Error ? error.message : "Unable to verify Stripe status");
    } finally {
      if (requestScope.current === scope) setBusy(null);
    }
  }

  async function openPayments() {
    const scope = requestScope.current;
    if (!canUseStripe || busy || scope?.websiteId !== websiteId) return;
    setBusy("dashboard");
    setMessage(null);
    try {
      const result = await openStripeExpressDashboard({ data: { websiteId } });
      if (requestScope.current !== scope) return;
      window.location.assign(result.url);
    } catch (error) {
      if (requestScope.current !== scope) return;
      setMessage(error instanceof Error ? error.message : "Unable to open Stripe");
    } finally {
      if (requestScope.current === scope) setBusy(null);
    }
  }

  useEffect(() => {
    if (locked || status === null) return;
    const scope = requestScope.current;
    if (scope?.websiteId !== websiteId) return;
    if (connect !== "return" && connect !== "refresh") return;
    if (handledRef.current === connect) return;
    handledRef.current = connect;
    // Return markers are hints only; each path retrieves or regenerates provider state.
    if (!canUseStripe) {
      onConnectConsumed();
    } else if (connect === "return") {
      void verify().finally(() => {
        if (requestScope.current === scope) onConnectConsumed();
      });
    } else if (connect === "refresh" && creationEligible) {
      void startOnboarding();
    } else {
      onConnectConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect, locked, creationEligible, status, canUseStripe, websiteId]);

  if (locked) {
    return (
      <Card id="step-4" aria-disabled="true" className="opacity-70">
        <CardHeader>
          <CardTitle>Step 4 — Stripe Connect</CardTitle>
          <CardDescription>Connect a calendar and save availability first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const ready =
    canUseStripe &&
    status !== null &&
    status.onboardingState === "ready" &&
    status.chargesEnabled &&
    status.payoutsEnabled &&
    status.detailsSubmitted &&
    status.cardPaymentsActive &&
    status.currentlyDueCount === 0 &&
    status.pastDueCount === 0 &&
    status.pendingVerificationCount === 0 &&
    !status.reconnectReason &&
    status.snapshotFresh;
  const blocked =
    status !== null &&
    (status.onboardingState === "restricted" || status.onboardingState === "disabled");
  const pendingReview = (status?.pendingVerificationCount ?? 0) > 0;

  return (
    <Card id="step-4">
      <CardHeader>
        <CardTitle>Step 4 — Stripe Connect</CardTitle>
        <CardDescription>
          {status?.environmentError
            ? "Stripe actions are unavailable in this payment environment."
            : ready
              ? "Your US Express account is verified for card payments and payouts."
              : blocked
                ? "Open Stripe to resolve the account restriction, then check status again."
                : pendingReview
                  ? "Stripe is reviewing your information. You can safely leave and check again later."
                  : "Stripe hosts the secure onboarding flow. Direct charges with no Obra application fee. Customer charging is not enabled in this setup step."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status?.environmentError ? (
          <Alert>
            <AlertTitle>Stripe setup unavailable</AlertTitle>
            <AlertDescription>{status.environmentError}</AlertDescription>
          </Alert>
        ) : status ? (
          <>
            <p>Identity details: {status.detailsSubmitted ? "Submitted" : "Incomplete"}</p>
            <p>Card payments: {status.chargesEnabled ? "Enabled" : "Not enabled"}</p>
            <p>Payouts: {status.payoutsEnabled ? "Enabled" : "Not enabled"}</p>
          </>
        ) : (
          <p className="text-muted-foreground">Loading Stripe status…</p>
        )}
        {message ? (
          <p className="text-muted-foreground" role="status">
            {message}
          </p>
        ) : null}
        {canUseStripe && !onboardingReady && status?.canOnboard && !ready ? (
          <p className="text-muted-foreground">
            Saved payment settings are unchanged. Google Calendar must be operational and
            availability saved before starting or continuing Stripe setup.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {!ready && creationEligible ? (
            <Button
              onClick={() => void startOnboarding()}
              disabled={busy !== null || !canStartOnboarding}
            >
              {busy === "onboarding"
                ? "Opening Stripe…"
                : status?.connected
                  ? "Continue in Stripe"
                  : "Connect Stripe"}
            </Button>
          ) : null}
          {canUseStripe && status?.connected ? (
            <Button variant="outline" onClick={() => void verify()} disabled={busy !== null}>
              {busy === "verify" ? "Checking…" : "Check status"}
            </Button>
          ) : null}
          {canUseStripe && status?.connected && status.detailsSubmitted ? (
            <Button variant="outline" onClick={() => void openPayments()} disabled={busy !== null}>
              {busy === "dashboard" ? "Opening…" : "My Payments"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
