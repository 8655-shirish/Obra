import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { JOB_TYPE_ENRICHMENT } from "@/lib/jobs/platforms";
import { buildJobProgressSnapshot } from "@/lib/jobs/progress.server";
import type { BackgroundJobRow } from "@/lib/jobs/types";
import {
  getTemplateManifestById,
  resolveTemplatePurchaseIdentity,
} from "@/lib/template-content/overlay";
import { resolveTemplateLookup } from "@/lib/template-purchase/lookup";

const websiteSchema = z.object({ websiteId: z.string().uuid() });

/**
 * Purchaser overview bootstrap (plan/template-purchase.md §7, §10).
 * Single round trip: identity, plan, order state, provider readiness,
 * template draft presence, and live URL. Progress is always re-derived —
 * no completion flags are stored or trusted from the client.
 */
export const getPurchaserOverview = createServerFn({ method: "GET" })
  .validator((data: unknown) => websiteSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    const access = await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: websiteRow, error: websiteError } = await supabaseAdmin
      .from("websites")
      .select("*")
      .eq("id", data.websiteId)
      .single();
    const website = websiteRow as unknown as {
      id: string;
      status: string;
      template_id?: unknown;
      template_slug: string | null;
      environment: string;
      active_version_id: string | null;
      user_id: string;
    } | null;
    if (websiteError || !website) throw new Error("Website not found");
    // Transitional: pre-migration rows carry slug only (phase 2 types template_id).
    let websiteIdentity = resolveTemplatePurchaseIdentity(
      website.template_slug ?? null,
      website && "template_id" in website ? (website.template_id ?? null) : null,
    );
    // Checkout OTP routes with templateId even when copy was swallowed.
    // Later /login has no search intent — copy from the completed session so
    // Step 1 can see the mold without depending on the URL.
    if (!websiteIdentity) {
      const { copyTemplateIdentityToWebsite } = await import("@/lib/template-purchase.server");
      const { data: session } = await supabaseAdmin
        .from("checkout_sessions")
        .select("id")
        .eq("website_id", website.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (session) {
        try {
          websiteIdentity =
            (await copyTemplateIdentityToWebsite(supabaseAdmin, session.id, website.id)) ?? null;
        } catch (error) {
          console.error("[getPurchaserOverview] template identity heal failed", error);
        }
      }
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, business_name, license_number, city")
      .eq("id", website.user_id)
      .single();

    const { loadBookingReadinessFacts } = await import("@/lib/booking-readiness.server");
    const readiness = await loadBookingReadinessFacts({
      websiteId: website.id,
      profileId: website.user_id,
      environment: website.environment as "test" | "live",
      isPublished: website.status === "live",
      isActiveVersion: true,
    });

    const { data: draft } = await supabaseAdmin
      .from("website_versions")
      .select("id")
      .eq("website_id", website.id)
      .eq("status", "draft")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      mode: access.mode,
      profile: profile
        ? {
            id: profile.id,
            businessName: profile.business_name,
            licenseNumber: profile.license_number,
            city: profile.city,
          }
        : null,
      website: {
        id: website.id,
        status: website.status,
        templateSlug: websiteIdentity?.slug ?? website.template_slug,
        templateId: websiteIdentity?.id ?? null,
      },
      plan: readiness.plan === "pro" ? ("pro" as const) : ("starter" as const),
      orderConfirmed: readiness.orderConfirmed,
      readiness,
      draft: { exists: Boolean(draft), id: draft?.id ?? null },
      liveUrl: website.status === "live" && website.active_version_id ? `/lp/${website.id}` : null,
    };
  });

export type PurchaserOverview = Awaited<ReturnType<typeof getPurchaserOverview>>;

/**
 * Setup-route guard: every /setup URL belongs on /user. Returns the owning
 * profile so callers can redirect there for all websites, not only templates.
 */
export const getSetupRedirectTarget = createServerFn({ method: "GET" })
  .validator((data: unknown) => websiteSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: websiteRow } = await supabaseAdmin
      .from("websites")
      .select("*")
      .eq("id", data.websiteId)
      .maybeSingle();
    const row = websiteRow as unknown as { user_id?: unknown } | null;
    const userId = typeof row?.user_id === "string" ? row.user_id : null;
    if (!userId) return null;
    return { userId };
  });

async function loadTemplateLookupDisposition(
  supabase: SupabaseClient<Database>,
  websiteId: string,
) {
  const [{ data: jobs, error: jobsError }, { data: contractor, error: contractorError }] =
    await Promise.all([
      supabase
        .from("background_jobs")
        .select("*")
        .eq("website_id", websiteId)
        .eq("job_type", JOB_TYPE_ENRICHMENT)
        .order("created_at", { ascending: false }),
      supabase
        .from("contractor_profiles")
        .select("research_status")
        .eq("website_id", websiteId)
        .maybeSingle(),
    ]);
  if (jobsError) {
    console.error("[loadTemplateLookupDisposition] jobs", jobsError);
    throw new Error("Unable to load business lookup");
  }
  if (contractorError) {
    console.error("[loadTemplateLookupDisposition] research", contractorError);
    throw new Error("Unable to load business lookup");
  }
  const snapshot = buildJobProgressSnapshot(websiteId, (jobs ?? []) as BackgroundJobRow[]);
  return resolveTemplateLookup(snapshot.chains, contractor?.research_status ?? null);
}

/**
 * Step 1 entry (plan §7.2): idempotently prepares the template seed, then
 * enqueues the enrichment chain. Enqueue without a fence cancels + recreates
 * (retry-safe by design). The agent fitting turn runs separately over SSE so
 * enrichment can complete first; the card polls the returned chain.
 */
export const runTemplatePersonalization = createServerFn({ method: "POST" })
  .validator((data: unknown) => websiteSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureTemplateSeeded } = await import("@/lib/template-purchase.server");
    const ensured = await ensureTemplateSeeded(supabaseAdmin, data.websiteId);
    if (!getTemplateManifestById(ensured.id)) {
      throw new Error(
        "TEMPLATE_MOLD_PENDING: automatic setup for this template is not ready yet. Contact support and mention this website.",
      );
    }
    // Spend guard: Firecrawl is paid to gather facts this site does not have.
    // A live chain is attached to. A completed chain with usable research is
    // reused so fitting/publish retry never repays. Empty/failed/cancelled
    // runs never block a new scrape. Grain is the chain, not one sibling row.
    const disposition = await loadTemplateLookupDisposition(supabaseAdmin, data.websiteId);
    if (disposition.kind === "attach" || disposition.kind === "reuse") {
      return { chainId: disposition.chainId, versionId: ensured.versionId, slug: ensured.slug };
    }
    const { enqueueEnrichmentChain } = await import("@/lib/jobs/enqueue.server");
    const { websiteSubject } = await import("@/lib/jobs/enrichment-subject");
    const { chainId } = await enqueueEnrichmentChain(supabaseAdmin, websiteSubject(data.websiteId));
    return { chainId, versionId: ensured.versionId, slug: ensured.slug };
  });

/**
 * Read-only: reports a business lookup that is already in flight for this site
 * so a reloaded Step 1 card shows live progress instead of a resting button.
 * Never enqueues and never spends.
 */
export const getActiveTemplatePersonalization = createServerFn({ method: "POST" })
  .validator((data: unknown) => websiteSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const disposition = await loadTemplateLookupDisposition(supabaseAdmin, data.websiteId);
    return disposition.kind === "attach" ? { chainId: disposition.chainId } : null;
  });
