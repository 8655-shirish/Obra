import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { acknowledgeBookingOrder } from "@/lib/booking-setup.functions";
import { googleCalendarConnectionStatus } from "@/lib/google-calendar-readiness";
import { getJobProgress } from "@/lib/jobs.functions";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  getActiveTemplatePersonalization,
  getPurchaserOverview,
  runTemplatePersonalization,
  type PurchaserOverview as PurchaserOverviewData,
} from "@/lib/template-purchase.functions";
import { fetchAgentMessage } from "@/lib/agent/fetch-agent-message";
import { classifyTemplateLookupPoll } from "@/lib/template-purchase/lookup";
import {
  getTemplateManifestById,
  isTemplateId,
  templateIdForSlug,
} from "@/lib/template-content/overlay";
import { AppointmentsCard, BookingsCard } from "./EngagementCards";
import { StepFourCard, StepThreeCard, StepTwoCard } from "./SetupStepCards";

const SCRAPE_POLL_MS = 3_000;
const FITTING_TIMEOUT_MS = 10 * 60_000;
const CALENDAR_STATUS_POLL_MS = 10_000;
const CALENDAR_STATUS_POLL_LIMIT = 12;

type StepOneState = "idle" | "starting" | "scraping" | "fitting" | "done" | "failed";

export function PurchaserOverview({
  userId,
  websiteId,
  intendedTemplateId,
  connect,
}: {
  userId: string;
  websiteId: string;
  intendedTemplateId?: string | null;
  connect?: "success" | "error" | "return" | "refresh";
}) {
  const [loadedOverview, setOverview] = useState<PurchaserOverviewData | null>(null);
  const overview =
    loadedOverview?.readiness.websiteId === websiteId &&
    loadedOverview.readiness.profileId === userId
      ? loadedOverview
      : null;
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigate = useNavigate();
  const requestScope = useRef<{ websiteId: string; userId: string; request: number } | null>(null);

  useLayoutEffect(() => {
    const scope = { websiteId, userId, request: 0 };
    requestScope.current = scope;
    setOverview(null);
    setLoadError(null);
    return () => {
      if (requestScope.current === scope) requestScope.current = null;
    };
  }, [websiteId, userId]);

  const refresh = useCallback(async () => {
    const scope = requestScope.current;
    if (scope?.websiteId !== websiteId || scope.userId !== userId)
      throw new Error("The selected workspace changed");
    const request = ++scope.request;
    try {
      const next = await getPurchaserOverview({ data: { websiteId } });
      if (next.readiness.websiteId !== websiteId || next.readiness.profileId !== userId)
        throw new Error("The website status does not match this workspace");
      if (requestScope.current === scope && scope.request === request) {
        setOverview(next);
        setLoadError(null);
      }
      return next;
    } catch (error) {
      if (requestScope.current === scope && scope.request === request)
        setLoadError("Unable to load current setup status. Please try again.");
      throw error;
    }
  }, [websiteId, userId]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  const statusUnknown =
    loadError !== null ||
    Boolean(overview?.readiness.reasonCodes.includes("booking_readiness_unknown"));
  const calendarStatus = overview
    ? googleCalendarConnectionStatus(
        overview.readiness.calendarConnection,
        overview.readiness.calendar === "ready",
      )
    : null;
  const calendarPending = Boolean(
    overview?.plan === "pro" &&
    (statusUnknown ||
      overview.readiness.calendarConnection.pendingSetup !== null ||
      calendarStatus === "unknown" ||
      calendarStatus === "checking" ||
      calendarStatus === "monitoring_repair" ||
      calendarStatus === "temporarily_unavailable" ||
      calendarStatus === "service_issue"),
  );

  useEffect(() => {
    let cancelled = false;
    let reading = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const readStatus = async () => {
      if (cancelled || reading || document.visibilityState !== "visible") return;
      reading = true;
      try {
        await refresh();
      } catch {
        // Keep the saved forms visible when the display refresh fails.
      } finally {
        reading = false;
      }
    };
    const poll = async () => {
      if (cancelled) return;
      polls += 1;
      await readStatus();
      if (!cancelled && polls < CALENDAR_STATUS_POLL_LIMIT)
        timer = setTimeout(poll, CALENDAR_STATUS_POLL_MS);
    };
    const onFocus = () => void readStatus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // These GETs refresh the display only. Server maintenance must not depend on this tab.
    if (calendarPending) timer = setTimeout(poll, CALENDAR_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, calendarPending]);

  const overviewLoaded = overview !== null;

  useLayoutEffect(() => {
    if (!overviewLoaded) return;
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [overviewLoaded]);

  const signOut = useCallback(async () => {
    await supabaseBrowser.auth.signOut();
    navigate({ to: "/login" });
  }, [navigate]);

  const clearConnect = useCallback(() => {
    const scope = requestScope.current;
    if (scope?.websiteId !== websiteId || scope.userId !== userId) return;
    navigate({
      to: "/user/$userId",
      params: { userId },
      search: {
        websiteId,
        ...(intendedTemplateId ? { templateId: intendedTemplateId } : {}),
      },
      replace: true,
    });
  }, [intendedTemplateId, navigate, userId, websiteId]);

  const [menuOpen, setMenuOpen] = useState(false);

  if (loadError && !overview) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Your website could not be loaded</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => void refresh().catch(() => {})}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading your website…</p>
      </main>
    );
  }

  const isPro = overview.plan === "pro";
  const showSteps = isPro && overview.orderConfirmed;
  const calendarReady = !statusUnknown && overview.readiness.calendar === "ready";
  const availabilityReady = overview.readiness.availability === "configured";
  const calendarConfigured = overview.readiness.calendarConnection.configured;
  const paymentsConfigured = overview.readiness.payments !== "not_configured";

  return (
    <main className="mx-auto max-w-3xl px-5 py-10" id="top">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">
            {isPro ? "Pro" : "Starter"} · {overview.profile?.licenseNumber ?? ""}
          </p>
          <h1 className="mt-2 text-3xl font-bold">
            {overview.profile?.businessName ?? "Your website"}
          </h1>
          {overview.liveUrl ? (
            <a
              className="mt-2 inline-block text-sm font-semibold underline"
              href={overview.liveUrl}
            >
              View live site
            </a>
          ) : null}
        </div>
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </Button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-40 mt-2 w-48 rounded-md border bg-background py-1 shadow-lg"
              onKeyDown={(event) => {
                if (event.key === "Escape") setMenuOpen(false);
              }}
            >
              <a
                role="menuitem"
                href="#top"
                className="flex min-h-11 items-center px-4 py-2 text-sm hover:bg-muted"
                onClick={() => setMenuOpen(false)}
              >
                Home
              </a>
              <a
                role="menuitem"
                href="#appointments"
                className="flex min-h-11 items-center px-4 py-2 text-sm hover:bg-muted"
                onClick={() => setMenuOpen(false)}
              >
                Appointments
              </a>
              {isPro ? (
                <a
                  role="menuitem"
                  href="#bookings"
                  className="flex min-h-11 items-center px-4 py-2 text-sm hover:bg-muted"
                  onClick={() => setMenuOpen(false)}
                >
                  Bookings
                </a>
              ) : null}
              <button
                role="menuitem"
                type="button"
                className="flex min-h-11 w-full items-center px-4 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {isPro && !overview.orderConfirmed ? (
        <OrderConfirmBanner
          key={`${userId}:${websiteId}`}
          websiteId={websiteId}
          onConfirmed={() => void refresh().catch(() => {})}
        />
      ) : null}

      {loadError ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {loadError} Your saved settings are still shown.
        </p>
      ) : null}

      <div
        key={`${userId}:${websiteId}:${overview.readiness.environment}`}
        className="mt-6 grid gap-4"
      >
        <StepOneCard
          userId={userId}
          websiteId={websiteId}
          overview={overview}
          onRefresh={refresh}
          intendedTemplateId={intendedTemplateId}
        />
        {showSteps ? (
          <>
            <StepTwoCard
              websiteId={websiteId}
              userId={userId}
              readiness={overview.readiness}
              statusUnknown={statusUnknown}
              isOwner={overview.mode === "contractor"}
              connect={connect}
              onChanged={async () => {
                await refresh();
              }}
              onConnectConsumed={clearConnect}
            />
            <StepThreeCard
              websiteId={websiteId}
              locked={!calendarConfigured && !availabilityReady}
              onChanged={async () => {
                await refresh();
              }}
            />
            <StepFourCard
              websiteId={websiteId}
              userId={userId}
              locked={(!calendarConfigured || !availabilityReady) && !paymentsConfigured}
              onboardingReady={calendarReady && availabilityReady}
              connect={connect}
              onChanged={async () => {
                await refresh();
              }}
              onConnectConsumed={clearConnect}
            />
          </>
        ) : null}
        <AppointmentsCard websiteId={websiteId} />
        {isPro ? <BookingsCard websiteId={websiteId} userId={userId} /> : null}
      </div>
    </main>
  );
}

function OrderConfirmBanner({
  websiteId,
  onConfirmed,
}: {
  websiteId: string;
  onConfirmed: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="mt-6 border-primary/40">
      <CardHeader>
        <CardTitle>Confirm your booking order</CardTitle>
        <CardDescription>
          Payment alone does not confirm booking setup. Confirm the order to unlock the steps below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          disabled={confirming}
          onClick={() => {
            setConfirming(true);
            setError(null);
            acknowledgeBookingOrder({ data: { websiteId } })
              .then(() => onConfirmed())
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Unable to confirm order");
              })
              .finally(() => setConfirming(false));
          }}
        >
          {confirming ? "Confirming…" : "Confirm booking order"}
        </Button>
        {error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function phaseTextForTool(name: string): string {
  if (name === "publishToLp") return "Publishing your website…";
  if (name === "applyTemplatePatch") return "Fitting your information into your website…";
  if (name === "getEnrichmentSummary") return "Reading your business information…";
  return "Working…";
}

async function runFittingStream(options: {
  userId: string;
  websiteId: string;
  versionId: string;
  signal: AbortSignal;
  onPhase: (text: string) => void;
}): Promise<void> {
  const response = await fetchAgentMessage(
    {
      userId: options.userId,
      websiteId: options.websiteId,
      intent: { type: "personalize_template", versionId: options.versionId },
      skipUserPersist: true,
    },
    { signal: options.signal },
  );
  if (!response.ok || !response.body) {
    throw new Error("Unable to start personalization");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice("data: ".length)) as { type: string; name?: string };
      if (event.type === "tool_start" && event.name) options.onPhase(phaseTextForTool(event.name));
      if (event.type === "done") return;
      if (event.type === "error") throw new Error("Personalization failed");
      if (event.type === "cancelled") throw new Error("Personalization was cancelled");
    }
  }
  throw new Error("Personalization ended unexpectedly");
}

function StepOneCard({
  userId,
  websiteId,
  overview,
  onRefresh,
  intendedTemplateId,
}: {
  userId: string;
  websiteId: string;
  overview: PurchaserOverviewData;
  onRefresh: () => Promise<PurchaserOverviewData>;
  intendedTemplateId?: string | null;
}) {
  const [state, setState] = useState<StepOneState>(() => (overview.liveUrl ? "done" : "idle"));
  const [phase, setPhase] = useState("Finding your business information…");
  const [error, setError] = useState<string | null>(null);
  const [supportKind, setSupportKind] = useState<"purchase" | "mold" | "conflict" | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Edit-mode renders one preview per wired mold. Unwired template molds get a
  // support state instead of an error page or a wrong-template preview.
  // Fresh purchase intent counts before the website row is tagged — Step 1
  // heals the row on entry, so gating on intent keeps the healing reachable.
  const intendedId =
    intendedTemplateId && isTemplateId(intendedTemplateId) ? intendedTemplateId : null;
  const rowId =
    overview.website?.templateId && isTemplateId(overview.website.templateId)
      ? overview.website.templateId
      : overview.website?.templateSlug
        ? templateIdForSlug(overview.website.templateSlug)
        : null;
  const moldId = intendedId ?? rowId;
  // An untagged website is not an unwired mold: Step 1 heals the row from the
  // completed purchase server-side. Only a known-unwired mold blocks here.
  const moldReady = moldId ? getTemplateManifestById(moldId) !== null : true;

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
    setError(null);
  }, []);

  const start = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setSupportKind(null);
    if (!moldReady) {
      setError("Automatic setup for this template is not ready yet.");
      setSupportKind("mold");
      setState("failed");
      return;
    }
    let fittingTimedOut = false;
    try {
      setState("starting");
      const started = await runTemplatePersonalization({ data: { websiteId } });
      if (controller.signal.aborted) return;
      setState("scraping");
      setPhase("Finding your business information…");
      for (;;) {
        if (controller.signal.aborted) return;
        const snapshot = await getJobProgress({ data: { websiteId, chainId: started.chainId } });
        const chain = snapshot.chains.find((entry) => entry.chainId === started.chainId);
        const poll = classifyTemplateLookupPoll(chain);
        if (poll === "failed") {
          throw new Error("Business lookup failed. Retry to run it again.");
        }
        if (poll === "complete") break;
        await new Promise((resolve) => setTimeout(resolve, SCRAPE_POLL_MS));
      }
      if (controller.signal.aborted) return;
      setState("fitting");
      setPhase("Fitting your information into your website…");
      const fittingTimer = setTimeout(() => {
        fittingTimedOut = true;
        controller.abort();
      }, FITTING_TIMEOUT_MS);
      try {
        await runFittingStream({
          userId,
          websiteId,
          versionId: started.versionId,
          signal: controller.signal,
          onPhase: (text) => {
            if (!controller.signal.aborted) setPhase(text);
          },
        });
      } finally {
        clearTimeout(fittingTimer);
      }
      if (controller.signal.aborted) return;
      const fresh = await onRefresh();
      if (controller.signal.aborted) return;
      if (!fresh.liveUrl) {
        throw new Error(
          "Your site was personalized but the live link is missing. Retry to continue.",
        );
      }
      setState("done");
    } catch (err) {
      if (controller.signal.aborted && !fittingTimedOut) {
        // User-cancelled (or unmounted): back to rest, no error persists.
        setState("idle");
        return;
      }
      if (err instanceof DOMException && err.name === "AbortError" && !fittingTimedOut) {
        setState("idle");
        return;
      }
      if (fittingTimedOut) {
        setError("Personalization is taking too long. Retry to run it again.");
        setSupportKind(null);
        setState("failed");
        return;
      }
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      // Coded server failures never resolve by retrying.
      if (message.includes("TEMPLATE_MOLD_PENDING")) setSupportKind("mold");
      else if (message.includes("TEMPLATE_SITE_CONFLICT")) setSupportKind("conflict");
      else if (message.includes("TEMPLATE_PURCHASE_NOT_FOUND")) setSupportKind("purchase");
      else setSupportKind(null);
      setState("failed");
    }
  }, [moldReady, onRefresh, userId, websiteId]);

  // A lookup can outlive this card (reload, second tab). Re-attach on entry so
  // work already in flight shows as progress instead of a resting button.
  useEffect(() => {
    if (overview.liveUrl || !moldReady) return;
    let cancelled = false;
    void getActiveTemplatePersonalization({ data: { websiteId } })
      .then((active) => {
        if (!cancelled && active) void start();
      })
      .catch(() => {
        /* attaching is best-effort; the button stays available */
      });
    return () => {
      cancelled = true;
    };
    // Attach once per site; `start` is stable for a given website.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteId, moldReady]);

  return (
    <Card aria-busy={state === "starting" || state === "scraping" || state === "fitting"}>
      <CardHeader>
        <CardTitle>Step 1 — Your website content</CardTitle>
        <CardDescription>
          We find your real business information and fit it into your template. The design never
          changes — only words, photos, and contact details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === "done" && overview.liveUrl ? (
          <div>
            <p className="text-sm font-semibold text-green-700">Your website is live.</p>
            <div className="mt-3 flex flex-col items-start gap-3">
              <Button type="button" asChild>
                <a href={overview.liveUrl} target="_blank" rel="noopener noreferrer">
                  Open my website
                </a>
              </Button>
              {moldReady ? (
                <Link
                  className="text-sm font-semibold underline"
                  to="/user/$userId/edit-mode"
                  params={{ userId }}
                  search={{ websiteId }}
                >
                  {overview.draft.exists ? "Continue editing" : "Edit website"}
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Manual editing for this template is not available yet. Contact support and mention
                  this website.
                </p>
              )}
            </div>
          </div>
        ) : null}
        {(state === "starting" || state === "scraping" || state === "fitting") && (
          <p className="text-sm text-muted-foreground" role="status">
            {phase}
          </p>
        )}
        {state === "failed" ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error ?? "Something went wrong"}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          {state === "idle" || (state === "failed" && !supportKind) ? (
            <Button
              type="button"
              onClick={() => {
                setSupportKind(null);
                void start();
              }}
            >
              {state === "failed" ? "Retry" : "Get my information"}
            </Button>
          ) : null}
          {state === "starting" || state === "scraping" || state === "fitting" ? (
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          ) : null}
          {state === "failed" && !supportKind && moldReady ? (
            <Button type="button" variant="outline" asChild>
              <Link to="/user/$userId/edit-mode" params={{ userId }} search={{ websiteId }}>
                Edit manually instead
              </Link>
            </Button>
          ) : null}
          {state === "failed" && supportKind ? (
            <p className="text-sm text-muted-foreground">
              {supportKind === "mold"
                ? "Automatic setup for this template is not ready yet. Contact support and mention this website."
                : supportKind === "conflict"
                  ? "This purchase does not match this website's existing setup. Contact support and mention this website."
                  : "We could not find a template purchase for this site. Contact support and mention this website."}
            </p>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Uses your business name, license, and city — no extra input needed.
        </p>
      </CardContent>
    </Card>
  );
}
