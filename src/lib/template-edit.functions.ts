import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const websiteSchema = z.object({ websiteId: z.string().uuid() });

const draftEditSchema = z.object({
  websiteId: z.string().uuid(),
  versionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  patch: z.record(z.string(), z.unknown()),
});

/**
 * Edit-mode entry (plan §8): returns the working draft overlay plus signed
 * media URLs. Forks live → draft when no draft exists; seeds when the site
 * has no versions at all. Drafts only — live versions are never edited.
 */
export const getTemplateDraft = createServerFn({ method: "GET" })
  .validator((data: unknown) => websiteSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { templateOverlaySchema } = await import("@/lib/template-content/overlay");
    const { resolveTemplateOverlayMedia } = await import("@/lib/template-purchase.server");

    const { data: website } = await supabaseAdmin
      .from("websites")
      .select("id, template_slug")
      .eq("id", data.websiteId)
      .maybeSingle();
    const { isTemplatePurchaseSlug } = await import("@/lib/template-content/overlay");
    if (!website || !isTemplatePurchaseSlug(website.template_slug)) {
      throw new Error("Edit mode is only available for template websites");
    }

    const { data: draft } = await supabaseAdmin
      .from("website_versions")
      .select("id, status, config_json, revision")
      .eq("website_id", data.websiteId)
      .eq("status", "draft")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let versionId: string;
    let revision: number;
    let rawConfig: unknown;
    if (draft) {
      versionId = draft.id;
      revision = draft.revision;
      rawConfig = draft.config_json;
    } else {
      const { data: live } = await supabaseAdmin
        .from("website_versions")
        .select("id, website_id, status, config_json, version_number, variant_key, revision")
        .eq("website_id", data.websiteId)
        .eq("status", "live")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!live) {
        const { seedTemplateVersion } = await import("@/lib/template-purchase.server");
        const { getTemplateManifest } = await import("@/lib/template-content/overlay");
        const manifest = getTemplateManifest(website.template_slug);
        if (!manifest) throw new Error("Unknown template mold");
        const seededId = await seedTemplateVersion(
          supabaseAdmin,
          data.websiteId,
          website.template_slug,
        );
        if (!seededId) throw new Error("Unable to prepare template draft");
        const { data: seeded } = await supabaseAdmin
          .from("website_versions")
          .select("id, status, config_json, revision")
          .eq("id", seededId)
          .single();
        if (!seeded) throw new Error("Unable to prepare template draft");
        versionId = seeded.id;
        revision = seeded.revision;
        rawConfig = seeded.config_json;
      } else {
        const { forkLiveVersionToDraft } = await import("@/lib/agent/edit-draft.server");
        const forked = await forkLiveVersionToDraft(supabaseAdmin, data.websiteId, live);
        versionId = forked.id;
        revision = forked.revision;
        rawConfig = forked.config_json;
      }
    }

    const parsed = templateOverlaySchema.safeParse(rawConfig);
    if (!parsed.success) throw new Error("Template draft content is invalid");
    const mediaUrls = await resolveTemplateOverlayMedia(supabaseAdmin, data.websiteId, rawConfig);
    return { versionId, revision, overlay: parsed.data, mediaUrls, slug: website.template_slug };
  });

/**
 * Commits one edit batch into the working draft (autosave unit).
 * Reuses the agent applier without a turn fence — ownership was asserted
 * above, revision CAS and validation are identical to agent writes.
 */
export const saveTemplateContentEdit = createServerFn({ method: "POST" })
  .validator((data: unknown) => draftEditSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyTemplatePatchForVersion } =
      await import("@/lib/agent/apply-template-patch.server");
    return applyTemplatePatchForVersion(
      supabaseAdmin,
      data.websiteId,
      data.versionId,
      data.expectedRevision,
      data.patch,
    );
  });

/**
 * Wand: improves user-edited text in context. Grounds on enrichment fields;
 * without any, it refuses instead of inventing (honest degradation).
 */
export const improveTemplateText = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        websiteId: z.string().uuid(),
        text: z.string().trim().min(1).max(2000),
        slotKey: z.string().trim().min(1).max(120),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: contractor }, { data: website }] = await Promise.all([
      supabaseAdmin
        .from("contractor_profiles")
        .select("enrichment_json, business_name, license_number")
        .eq("website_id", data.websiteId)
        .maybeSingle(),
      supabaseAdmin
        .from("websites")
        .select("onboarding_state")
        .eq("id", data.websiteId)
        .maybeSingle(),
    ]);
    const enrichment = (contractor?.enrichment_json as Record<string, unknown>) ?? {};
    const onboardingRecord =
      website?.onboarding_state && typeof website.onboarding_state === "object"
        ? (website.onboarding_state as Record<string, unknown>)
        : {};
    const { schemaFromMatchedPlatforms } =
      await import("@/lib/enrichment/enrichment-schema.server");
    const schema = schemaFromMatchedPlatforms(enrichment, {
      ...onboardingRecord,
      businessName:
        (typeof onboardingRecord.businessName === "string" && onboardingRecord.businessName.trim()
          ? onboardingRecord.businessName
          : contractor?.business_name) ?? "",
      licenseNumber:
        (typeof onboardingRecord.licenseNumber === "string" && onboardingRecord.licenseNumber.trim()
          ? onboardingRecord.licenseNumber
          : contractor?.license_number) ?? "",
    }) as Record<string, unknown>;
    const refs = Object.entries(schema ?? {})
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key]) => key)
      .slice(0, 10);
    if (refs.length === 0) {
      throw new Error("Not enough business context to improve this text yet — edit it manually.");
    }
    const { suggestGroundedCopy, slotBudgetForWebsite } =
      await import("@/lib/agent/suggest-copy.server");
    const result = await suggestGroundedCopy(supabaseAdmin, data.websiteId, data.slotKey, refs, {
      maxChars: await slotBudgetForWebsite(supabaseAdmin, data.websiteId, data.slotKey),
    });
    return { copy: result.copy };
  });

/**
 * Delete Draft: discards all draft versions (edits are atomic at the draft
 * level — there is no per-edit undo because drafts never touch live).
 */
export const discardTemplateDraft = createServerFn({ method: "POST" })
  .validator((data: unknown) => websiteSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { discardDraftVariants } = await import("@/lib/agent/onboarding.server");
    await discardDraftVariants(supabaseAdmin, data.websiteId);
    return { ok: true as const };
  });
