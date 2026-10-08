import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Suspense, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";

import { DemoLicenseGate } from "@/components/site-renderer/DemoLicenseGate";
import { DemoLpChrome } from "@/components/site-renderer/DemoLpChrome";
import { ContractorSiteView } from "@/components/site-renderer/ContractorSiteView";
import { SiteBookingPayDemo } from "@/components/site-renderer/SiteBookingPayDemo";
import { LiveBookingDialog } from "@/components/booking/LiveBookingDialog";
import { moldComponentFor } from "@/components/templates/molds";
import { normalizeLicenseNumber } from "@/lib/auth/identity";
import { resolveTemplatePageView } from "@/lib/template-content/templates";
import { asOnboardingRecord } from "@/lib/onboarding-state";
import { isUuidParam } from "@/lib/lp-url";
import { NOINDEX_META } from "@/lib/seo";

const searchSchema = z.object({
  preview: z.string().optional(),
  version: z.string().uuid().optional(),
});

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const loadPublicSite = createServerFn({ method: "GET" })
  .validator((value: unknown) =>
    z
      .object({
        websiteId: z.string().min(1),
        preview: z.string().optional(),
        version: z.string().uuid().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data }) => {
    const params = { websiteId: data.websiteId };
    const deps = { preview: data.preview, version: data.version };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isValidOwnerPreviewToken } = await import("@/lib/auth/preview-token.server");

    const slug = decodeURIComponent(params.websiteId).trim();
    let websiteId: string | null = null;
    let licenseNumber: string | null = null;
    let website: {
      id: string;
      status: string;
      active_version_id: string | null;
      onboarding_state: unknown;
      user_id: string;
      environment: string;
    } | null = null;

    if (isUuidParam(slug)) {
      const { data, error } = await supabaseAdmin
        .from("websites")
        .select("id, status, active_version_id, onboarding_state, user_id, environment")
        .eq("id", slug)
        .maybeSingle();

      if (error || !data) {
        throw new Response("Not Found", { status: 404 });
      }

      websiteId = data.id;
      website = data;
      // A UUID is the canonical website identity. Never redirect it through a
      // profile license route, which can resolve a different website.
    } else {
      licenseNumber = normalizeLicenseNumber(slug);
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, license_number")
        .eq("license_number", licenseNumber)
        .maybeSingle();

      if (!profile) {
        throw new Response("Not Found", { status: 404 });
      }

      const { data: sites } = await supabaseAdmin
        .from("websites")
        .select("id, status, active_version_id, onboarding_state, user_id, environment")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: true });
      const siteIds = (sites ?? []).map((site) => site.id);
      const { data: entitledSites } = siteIds.length
        ? await supabaseAdmin
            .from("website_entitlements")
            .select("website_id")
            .in("website_id", siteIds)
            .in("state", ["active", "grace"])
        : { data: [] };
      const entitledSiteIds = new Set((entitledSites ?? []).map((row) => row.website_id));
      const purchasedLive =
        sites?.filter((row) => row.status === "live" && entitledSiteIds.has(row.id)) ?? [];

      // A license is a legacy alias only when it identifies exactly one purchased site.
      if (purchasedLive.length !== 1) {
        throw new Response("Not Found", { status: 404 });
      }

      websiteId = purchasedLive[0].id;
    }

    if (!website) {
      const { data, error } = await supabaseAdmin
        .from("websites")
        .select("id, status, active_version_id, onboarding_state, user_id, environment")
        .eq("id", websiteId)
        .maybeSingle();

      if (error || !data) {
        throw new Response("Not Found", { status: 404 });
      }
      website = data;
    }

    const isLive = website.status === "live" && Boolean(website.active_version_id);
    let versionId: string | null = null;

    if (deps.version) {
      const previewAllowed = await isValidOwnerPreviewToken(website.id, deps.preview);
      if (!isLive && !previewAllowed) {
        throw new Response("Not Found", { status: 404 });
      }

      const { data: versionRow, error: versionLookupError } = await supabaseAdmin
        .from("website_versions")
        .select("id, status, website_id")
        .eq("id", deps.version)
        .maybeSingle();

      if (
        versionLookupError ||
        !versionRow ||
        versionRow.website_id !== website.id ||
        versionRow.status !== "live"
      ) {
        throw new Response("Not Found", { status: 404 });
      }

      versionId = versionRow.id;
    } else if (isLive) {
      versionId = website.active_version_id;
    } else {
      const previewAllowed = await isValidOwnerPreviewToken(website.id, deps.preview);
      if (!previewAllowed) {
        throw new Response("Not Found", { status: 404 });
      }

      const { data: versions } = await supabaseAdmin
        .from("website_versions")
        .select("id, status")
        .eq("website_id", website.id)
        .in("status", ["selected", "draft", "live"])
        .order("version_number", { ascending: false });

      const preferred =
        versions?.find((v) => v.status === "selected") ??
        versions?.find((v) => v.status === "draft") ??
        versions?.find((v) => v.status === "live");
      versionId = preferred?.id ?? null;
    }

    if (!versionId) {
      throw new Response("Not Found", { status: 404 });
    }

    const { data: version, error: versionError } = await supabaseAdmin
      .from("website_versions")
      .select("config_json")
      .eq("id", versionId)
      .eq("website_id", website.id)
      .single();

    if (versionError || !version) {
      throw new Response("Not Found", { status: 404 });
    }

    const { resolveSiteMediaInConfig } = await import("@/lib/media/site-media.server");
    const config = await resolveSiteMediaInConfig(
      supabaseAdmin,
      (version.config_json as Record<string, unknown>) ?? {},
      { websiteId: website.id },
    );

    // Template-kind versions carry a content overlay instead of a unified
    // design: resolve its media paths to signed URLs for the mold renderer.
    // Non-template configs resolve to an empty map (no-op).
    const { resolveTemplateOverlayMedia } = await import("@/lib/template-purchase.server");
    const templateMedia = await resolveTemplateOverlayMedia(supabaseAdmin, website.id, config);

    const onboarding = asOnboardingRecord(website.onboarding_state);
    const hasLicenseConfigured = Boolean(
      asNonEmptyString(config.licenseNumber) ?? asNonEmptyString(onboarding.licenseNumber),
    );

    const { loadPublicBookingReadiness } = await import("@/lib/booking-availability.server");
    const readiness = await loadPublicBookingReadiness({
      websiteId: website.id,
      profileId: website.user_id,
      environment: website.environment as "test" | "live",
      isPublished: isLive,
      isActiveVersion: versionId === website.active_version_id,
    });
    const liveBookingEnabled = process.env["BOOKING_LIVE_ENABLED"] === "true";
    const bookingWorkersActive = process.env["BOOKING_WORKER_MODE"] === "active";
    const { withWorkerDeadline } = await import("@/lib/worker-deadline.server");
    const { data: cutover, error: cutoverError } = await withWorkerDeadline(
      Date.now() + 5_000,
      async () =>
        await supabaseAdmin
          .from("booking_cutover_state")
          .select("status,target_contract_version")
          .eq("profile_id", website.user_id)
          .eq("environment", website.environment)
          .maybeSingle(),
    ).catch(() => ({ data: null, error: true }));
    const tenantCutoverEnabled =
      !cutoverError && cutover?.status === "enabled" && cutover.target_contract_version === 2;
    const liveBooking =
      liveBookingEnabled &&
      bookingWorkersActive &&
      tenantCutoverEnabled &&
      readiness.publicMode === "live_booking";
    // An unrelated unknown observation never makes an observed denial retryable.
    const bookingRetryAvailable =
      isLive &&
      versionId === website.active_version_id &&
      !readiness.showDemo &&
      !readiness.entitlementUnavailable &&
      !liveBooking &&
      liveBookingEnabled &&
      bookingWorkersActive &&
      ["test", "live"].includes(website.environment) &&
      process.env["BOOKING_WORKER_ENVIRONMENT"] === website.environment &&
      (tenantCutoverEnabled || Boolean(cutoverError)) &&
      !readiness.reasonCodes.some((reason) =>
        [
          "booking_configuration_ineligible",
          "booking_cutover_unavailable",
          "booking_runtime_unavailable",
          "booking_environment_mismatch",
          "google_setup_pending",
          "contractor_disconnected",
          "provider_reauthorization_required",
          "calendar_permissions_changed",
          "calendar_write_blocked",
          "calendar_selection_invalid",
          "provider_configuration_error",
        ].includes(reason),
      ) &&
      !readiness.calendarConnection.reconnectReason &&
      !(
        readiness.reasonCodes.includes("payments_provider_not_ready") &&
        !readiness.reasonCodes.includes("stripe_verification_stale")
      ) &&
      (readiness.reasonCodes.includes("booking_readiness_unknown") ||
        (readiness.providerRefreshEligible &&
          (readiness.payments === "ready" ||
            readiness.reasonCodes.includes("stripe_verification_stale")) &&
          [
            null,
            "verification_stale",
            "provider_temporary_failure",
            "provider_platform_error",
            "verification_unknown",
          ].includes(readiness.calendarConnection.reason) &&
          (Boolean(cutoverError) ||
            readiness.reasonCodes.some((reason) =>
              [
                "google_verification_stale",
                "google_selection_permissions_stale",
                "google_trigger_health_stale",
                "stripe_verification_stale",
              ].includes(reason),
            ) ||
            readiness.calendarConnection.reason === "provider_temporary_failure" ||
            readiness.calendarConnection.reason === "provider_platform_error" ||
            readiness.calendarConnection.triggerState !== "active")));
    return {
      config: JSON.parse(JSON.stringify(config)) as Record<
        string,
        string | number | boolean | null | object
      >,
      websiteId: website.id,
      versionId,
      templateMedia,
      showBookingPay: readiness.showDemo || liveBooking,
      liveBooking,
      bookingRetryAvailable,
      showBuyCta: readiness.showDemo && isLive,
      showDemoChrome: readiness.showDemo,
      bookingConfigurationPending: readiness.publicMode === "configuration_pending",
      entitlementUnavailable: readiness.entitlementUnavailable,
      showLeadForm: readiness.showLeadForm,
      isLive,
      hasLicenseConfigured,
    };
  });

export const Route = createFileRoute("/lp/$websiteId")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ preview: search.preview, version: search.version }),
  loader: ({ params, deps }) => loadPublicSite({ data: { websiteId: params.websiteId, ...deps } }),
  head: ({ loaderData }) => {
    const headConfig = loaderData?.config as Record<string, unknown> | undefined;
    const overlayName =
      resolveTemplatePageView(headConfig ?? {}, {})?.identity.businessName?.trim() ?? "";
    const name =
      (typeof headConfig?.businessName === "string" ? headConfig.businessName.trim() : "") ||
      overlayName;
    return {
      meta: [{ title: name || "Contractor site | Obra" }, ...NOINDEX_META],
    };
  },
  component: LiveSitePage,
});

function LiveSitePage() {
  const {
    config,
    websiteId,
    versionId,
    showDemoChrome,
    showBuyCta,
    showBookingPay,
    showLeadForm,
    isLive,
    hasLicenseConfigured,
    bookingConfigurationPending,
    bookingRetryAvailable,
    entitlementUnavailable,
    liveBooking,
    templateMedia,
  } = Route.useLoaderData();
  const router = useRouter();
  const matchId = Route.useMatch({ select: (match) => match.id });
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingRetryState, setBookingRetryState] = useState<"idle" | "loading" | "checked">(
    "idle",
  );
  const requestScope = useRef<{ matchId: string; pending: boolean } | null>(null);
  useLayoutEffect(() => {
    const scope = { matchId, pending: false };
    requestScope.current = scope;
    setBookingOpen(false);
    setBookingRetryState("idle");
    return () => {
      if (requestScope.current === scope) requestScope.current = null;
    };
  }, [matchId]);
  const canRetryBooking =
    bookingRetryAvailable && !liveBooking && !showDemoChrome && !entitlementUnavailable && isLive;

  async function retryBooking() {
    const scope = requestScope.current;
    if (!canRetryBooking || bookingOpen || scope?.matchId !== matchId || scope.pending) return;
    scope.pending = true;
    setBookingRetryState("loading");
    try {
      // Reload this site's current version through the existing bounded admission checks.
      await router.invalidate({ filter: (match) => match.id === matchId, sync: true });
    } catch {
      // A failed retry is not evidence that booking can be enabled.
    } finally {
      if (requestScope.current === scope) {
        scope.pending = false;
        setBookingRetryState("checked");
      }
    }
  }

  // Template-kind versions render their static mold with purchaser content.
  // Unified configs resolve to null and keep the existing renderer.
  const templateView = resolveTemplatePageView(config, templateMedia ?? {});
  const MoldComponent = templateView ? moldComponentFor(templateView.slug) : null;

  const prefill = {
    licenseNumber:
      (typeof config.licenseNumber === "string" ? config.licenseNumber : undefined) ??
      templateView?.identity.licenseNumber ??
      undefined,
    businessName:
      (typeof config.businessName === "string" ? config.businessName : undefined) ??
      templateView?.identity.businessName ??
      undefined,
    city:
      (typeof config.city === "string" ? config.city : undefined) ??
      templateView?.identity.city ??
      undefined,
  };

  const site = (
    <>
      <div className={templateView ? undefined : "h-full min-h-0 flex-1"}>
        {templateView && MoldComponent ? (
          <Suspense
            fallback={
              <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">
                Loading site…
              </div>
            }
          >
            <MoldComponent
              content={templateView.content}
              bookingMode={showDemoChrome ? "demo" : liveBooking ? "live" : "disabled"}
              onOpenBooking={() => setBookingOpen(true)}
            />
          </Suspense>
        ) : (
          <ContractorSiteView
            config={config}
            websiteId={websiteId}
            showLeadForm={showLeadForm}
            enableMotion={true}
            canOpenBooking={showBookingPay}
            onOpenBooking={() => setBookingOpen(true)}
          />
        )}
      </div>
      {liveBooking ? (
        <LiveBookingDialog
          key={websiteId}
          websiteId={websiteId}
          open={bookingOpen}
          onOpenChange={setBookingOpen}
        />
      ) : showBookingPay ? (
        <SiteBookingPayDemo
          open={bookingOpen}
          onOpenChange={setBookingOpen}
          isDemoPitch={showDemoChrome}
        />
      ) : null}
    </>
  );

  const showGate = showDemoChrome && isLive;

  if (!showDemoChrome) {
    return (
      <div className={templateView ? "min-h-dvh" : "flex h-dvh min-h-0 flex-col overflow-hidden"}>
        {entitlementUnavailable ? (
          <div
            className="border-b border-border bg-muted px-4 py-3 text-center text-sm text-muted-foreground"
            role="status"
          >
            This website’s subscription is currently inactive. Please contact the business directly.
          </div>
        ) : null}
        {bookingConfigurationPending || canRetryBooking ? (
          <div
            className="border-b border-border bg-muted px-4 py-3 text-center text-sm text-muted-foreground"
            role="status"
          >
            <p>
              {canRetryBooking
                ? bookingRetryState === "checked"
                  ? "Online booking is still unavailable. Please try again later or contact the business directly."
                  : "Online booking is temporarily unavailable. Retry booking or contact the business directly."
                : "Online booking is being configured. Please contact the business directly for now."}
            </p>
            {canRetryBooking ? (
              <button
                type="button"
                className="mt-2 underline disabled:opacity-50"
                disabled={bookingRetryState === "loading" || bookingOpen}
                onClick={() => void retryBooking()}
              >
                {bookingRetryState === "loading" ? "Checking booking..." : "Retry booking"}
              </button>
            ) : null}
          </div>
        ) : null}
        {site}
      </div>
    );
  }

  if (showGate) {
    return (
      <DemoLicenseGate
        websiteId={websiteId}
        versionId={versionId}
        licenseConfigured={hasLicenseConfigured}
      >
        {(verifiedLicense) => (
          <DemoLpChrome
            websiteId={websiteId}
            showBuyCta={showBuyCta}
            prefill={{ ...prefill, licenseNumber: verifiedLicense }}
          >
            {site}
          </DemoLpChrome>
        )}
      </DemoLicenseGate>
    );
  }

  return (
    <DemoLpChrome websiteId={websiteId} showBuyCta={false} prefill={prefill}>
      {site}
    </DemoLpChrome>
  );
}
