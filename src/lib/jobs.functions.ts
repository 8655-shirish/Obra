import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ensureWebsiteForProfile } from "@/lib/auth/profile.server";
import {
  assertProfileWorkspaceAccess,
  assertWebsiteWorkspaceAccess,
} from "@/lib/jobs/access.server";
import { buildJobProgressSnapshot } from "@/lib/jobs/progress.server";
import { resolveTemplatePurchaseIdentity } from "@/lib/template-content/overlay";

const getJobProgressSchema = z.object({
  websiteId: z.string().uuid(),
  chainId: z.string().uuid().optional(),
});

export interface AddVideoJobResult {
  versionId?: string;
  targetVersionId?: string;
  videoSlotId?: string;
  revision?: number;
  errorCode?: string;
}

const workspaceBootstrapSchema = z.object({
  userId: z.string().uuid(),
  websiteId: z.string().uuid().optional(),
});

export const getWorkspaceBootstrap = createServerFn({ method: "GET" })
  .validator((data: unknown) => workspaceBootstrapSchema.parse(data))
  .handler(async ({ data }) => {
    const access = await assertProfileWorkspaceAccess(data.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, license_number, full_name, business_name, trade, city")
      .eq("id", access.profileId)
      .single();

    if (error || !profile) {
      throw new Error("Profile not found");
    }

    let websiteId: string;
    if (data.websiteId) {
      const { data: website, error: websiteError } = await supabaseAdmin
        .from("websites")
        .select("id")
        .eq("id", data.websiteId)
        .eq("user_id", access.profileId)
        .maybeSingle();
      if (websiteError) throw new Error("Unable to load website");
      if (!website) throw new Error("Website not found");
      websiteId = website.id;
    } else {
      websiteId = await ensureWebsiteForProfile(supabaseAdmin, access.profileId);
    }
    const websiteResult = await supabaseAdmin
      .from("websites")
      .select("*")
      .eq("id", websiteId)
      .single();
    if (websiteResult.error) throw new Error("Unable to load workspace access state");
    const [entitlementResult, leadCountResult, appointmentCountResult] = await Promise.all([
      Promise.resolve(
        supabaseAdmin
          .from("website_entitlements")
          .select("id, plan")
          .eq("profile_id", access.profileId)
          .eq("website_id", websiteId)
          .eq("plan", "starter")
          .in("state", ["active", "grace"])
          .eq("quote_admission", true)
          .limit(1)
          .maybeSingle(),
      ).catch(() => ({ data: null, error: true })),
      Promise.resolve(
        supabaseAdmin
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("user_id", access.profileId)
          .eq("website_id", websiteId),
      ).catch(() => ({ count: null, error: true })),
      Promise.resolve(
        supabaseAdmin
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", access.profileId)
          .eq("website_id", websiteId),
      ).catch(() => ({ count: null, error: true })),
    ]);
    const starterEntitlement = entitlementResult.error ? null : entitlementResult.data;
    const leadCount = leadCountResult.error ? 0 : (leadCountResult.count ?? 0);
    const website = websiteResult.data as unknown as {
      status: string;
      environment: "test" | "live";
      template_slug?: unknown;
      template_id?: unknown;
    } | null;
    if (!website) throw new Error("Website not found");
    const websiteIdentity = resolveTemplatePurchaseIdentity(
      website.template_slug ?? null,
      "template_id" in website ? (website.template_id ?? null) : null,
    );
    const { loadBookingReadinessFacts, unknownBookingReadiness } =
      await import("@/lib/booking-readiness.server");
    const readinessInput = {
      websiteId,
      profileId: access.profileId,
      environment: website.environment,
      isPublished: website.status === "live",
      isActiveVersion: true,
    };
    let readiness: Awaited<ReturnType<typeof loadBookingReadinessFacts>>;
    try {
      readiness = await loadBookingReadinessFacts(readinessInput);
    } catch {
      // Workspace identity was authorized above. A booking outage must not block editing.
      readiness = unknownBookingReadiness(readinessInput);
    }
    return {
      mode: access.mode,
      profile: {
        id: profile.id,
        licenseNumber: profile.license_number,
        fullName: profile.full_name,
        businessName: profile.business_name,
        trade: profile.trade,
        city: profile.city,
      },
      websiteId,
      templateSlug: websiteIdentity?.slug ?? null,
      showWebsiteLeads:
        access.mode === "contractor" && (Boolean(starterEntitlement) || leadCount > 0),
      bookingManagement:
        access.mode === "contractor"
          ? {
              readiness,
              hasHistoricalBookings:
                !appointmentCountResult.error && (appointmentCountResult.count ?? 0) > 0,
              canContinueSetup:
                readiness.plan === "pro" &&
                !readiness.entitlementUnavailable &&
                readiness.firstIncompleteStep !== "complete",
              canOpenPayments: readiness.paymentDashboardAvailable,
            }
          : null,
    };
  });

export const getJobProgress = createServerFn({ method: "GET" })
  .validator((data: unknown) => getJobProgressSchema.parse(data))
  .handler(async ({ data }) => {
    await assertWebsiteWorkspaceAccess(data.websiteId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("background_jobs")
      .select("*")
      .eq("website_id", data.websiteId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (data.chainId) {
      query = supabaseAdmin
        .from("background_jobs")
        .select("*")
        .eq("website_id", data.websiteId)
        .eq("chain_id", data.chainId)
        .order("sequence_index", { ascending: true });
    }

    const { data: jobs, error } = await query;

    if (error) {
      console.error("[getJobProgress]", error);
      throw new Error("Unable to load job progress");
    }

    if (data.chainId) return buildJobProgressSnapshot(data.websiteId, jobs ?? []);

    const { data: activeJobs, error: activeJobsError } = await supabaseAdmin
      .from("background_jobs")
      .select("*")
      .eq("website_id", data.websiteId)
      .in("status", ["pending", "running", "finalizing"]);
    if (activeJobsError) {
      console.error("[getJobProgress] active jobs", activeJobsError);
      throw new Error("Unable to load job progress");
    }

    // The mixed history query is deliberately bounded. Fetch the newest generation
    // chain independently so unrelated job history can never make its durable status
    // disappear from the workspace.
    const { data: latestGeneration, error: latestGenerationError } = await supabaseAdmin
      .from("background_jobs")
      .select("chain_id")
      .eq("website_id", data.websiteId)
      .eq("job_type", "site_generation")
      .eq("sequence_index", 0)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestGenerationError) {
      console.error("[getJobProgress] latest generation", latestGenerationError);
      throw new Error("Unable to load job progress");
    }

    const activeById = new Map((jobs ?? []).map((job) => [job.id, job]));
    for (const job of activeJobs ?? []) activeById.set(job.id, job);
    let authoritativeJobs = [...activeById.values()];
    if (latestGeneration?.chain_id) {
      const { data: generationJobs, error: generationJobsError } = await supabaseAdmin
        .from("background_jobs")
        .select("*")
        .eq("website_id", data.websiteId)
        .eq("chain_id", latestGeneration.chain_id)
        .order("sequence_index", { ascending: true });
      if (generationJobsError) {
        console.error("[getJobProgress] latest generation chain", generationJobsError);
        throw new Error("Unable to load job progress");
      }
      const byId = new Map(authoritativeJobs.map((job) => [job.id, job]));
      for (const job of generationJobs ?? []) byId.set(job.id, job);
      authoritativeJobs = [...byId.values()];
    }

    return buildJobProgressSnapshot(data.websiteId, authoritativeJobs);
  });
