import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { compileThemeSource } from "@/lib/site-theme/compile-theme-source";
import { classifySiteRenderMode } from "@/lib/site-theme/render-mode";
import { mediaManifestFromConfig } from "@/lib/site-theme/media-manifest";
import { signSiteMediaPath } from "@/lib/media/site-media.server";
import { parseCurrentUnifiedPlan, parseStoredUnifiedPlan } from "./unified-design-brief";
import { unifiedRecipeById } from "./unified-design-recipes";
import {
  getTemplateManifest,
  isTemplatePurchaseSlug,
  templateOverlaySchema,
} from "@/lib/template-content/overlay";
import { isOwnedSiteMediaPath } from "@/lib/media/persist-scraped-media.server";

type SupabaseAdmin = SupabaseClient<Database>;
type AgentTurnFence = { traceId: string; ownerToken: string };

export async function publishWebsiteVersion(
  supabase: SupabaseAdmin,
  websiteId: string,
  versionId: string,
  expectedRevision: number,
  fence?: AgentTurnFence,
): Promise<{ publicUrl: string }> {
  const { data: version, error: versionError } = await supabase
    .from("website_versions")
    .select("id, website_id, status, config_json, revision")
    .eq("id", versionId)
    .eq("website_id", websiteId)
    .single();

  if (versionError || !version) {
    throw new Error("Website version not found");
  }
  if (version.revision !== expectedRevision) {
    throw new Error("Website version revision conflict");
  }

  // Template-kind versions bypass the unified brief/manifest/slot checks:
  // the mold is static code, so validation means allowlist + budgets +
  // owned media instead of design compilation.
  if ((version.config_json as Record<string, unknown> | null)?.kind === "template") {
    await validateTemplateVersionForPublish(supabase, websiteId, version.config_json);
    return invokePublishRpc(supabase, fence, {
      p_website_id: websiteId,
      p_version_id: versionId,
      p_expected_revision: expectedRevision,
      p_expected_config_json: version.config_json,
      p_expected_media_slots: null,
      p_validation_attestation: null,
    });
  }

  const config = (version.config_json as Record<string, unknown> | null) ?? {};
  let expectedMediaSlots: Json | null = null;
  const currentPlan =
    Number(config.generatorSchemaVersion) === 4 && config.unifiedPlan
      ? parseCurrentUnifiedPlan(config.unifiedPlan)
      : null;
  const renderMode = classifySiteRenderMode(config);
  if (renderMode.kind === "unavailable") {
    throw new Error("This design cannot be published until it is regenerated");
  }
  if (renderMode.kind === "generated") {
    if (
      renderMode.scope === "unified" &&
      [2, 3, 4].includes(Number(config.generatorSchemaVersion))
    ) {
      if ([2, 3].includes(Number(config.generatorSchemaVersion))) {
        const storedPlan = parseStoredUnifiedPlan(config);
        if (
          !storedPlan ||
          !unifiedRecipeById(storedPlan.brief.recipeId, storedPlan.brief.recipeVersion) ||
          config.recipeId !== storedPlan.brief.recipeId ||
          config.recipeVersion !== storedPlan.brief.recipeVersion
        ) {
          throw new Error(
            "This design has an invalid unified brief and must be regenerated before publishing",
          );
        }
      }
      const manifestState = mediaManifestFromConfig(config);
      if (manifestState.kind !== "current")
        throw new Error("This design has an invalid media manifest");
      const { data: attached, error: attachedError } = await supabase
        .from("website_version_media_slots")
        .select(
          "slot_id, asset_id, mime_type, role, provenance, required, source_slot_id, poster_slot_id, storage_path, proof_eligible",
        )
        .eq("website_id", websiteId)
        .eq("version_id", versionId);
      if (attachedError) throw new Error("Unable to validate published media attachments");
      expectedMediaSlots = [...(attached ?? [])].sort((a, b) => a.slot_id.localeCompare(b.slot_id));
      const attachedBySlot = new Map((attached ?? []).map((row) => [row.slot_id, row]));
      if (
        attachedBySlot.size !== manifestState.manifest.slots.length ||
        (manifestState.version === 4 && attachedBySlot.size !== (attached ?? []).length)
      ) {
        throw new Error("This design has stale or missing media attachments");
      }
      for (const slot of manifestState.manifest.slots) {
        const row = attachedBySlot.get(slot.slotId);
        if (
          !row ||
          row.asset_id !== slot.assetId ||
          row.mime_type !== slot.mimeType ||
          row.role !== slot.role ||
          row.provenance !== slot.origin ||
          row.required !== (slot.required === true) ||
          row.proof_eligible !== (slot.proofEligible === true) ||
          (row.source_slot_id ?? undefined) !== slot.sourceSlotId ||
          (row.poster_slot_id ?? undefined) !== slot.posterSlotId ||
          row.storage_path !== slot.storagePath ||
          !slot.storagePath ||
          !(await signSiteMediaPath(supabase, slot.storagePath))
        )
          throw new Error("This design has missing or detached media and cannot be published");
      }
    }
    const source = String(config.themeSource ?? "");
    const manifestState = mediaManifestFromConfig(config);
    const compiled = compileThemeSource(
      source,
      renderMode.scope === "unified"
        ? {
            unifiedLoose: true,
            contactHidden: config.contactHidden === true,
            ...(manifestState.kind === "current"
              ? {
                  generatorSchemaVersion: config.generatorSchemaVersion as number,
                  mediaManifest: config.mediaManifest,
                  ...(currentPlan
                    ? { operationalAnchors: currentPlan.operationalIntent.operationalAnchors }
                    : {}),
                }
              : {}),
          }
        : {},
    );
    if (!compiled.ok) {
      throw new Error("This generated design is invalid and must be regenerated before publishing");
    }
  }

  return invokePublishRpc(supabase, fence, {
    p_website_id: websiteId,
    p_version_id: versionId,
    p_expected_revision: expectedRevision,
    p_expected_config_json: version.config_json,
    p_expected_media_slots: expectedMediaSlots,
    p_validation_attestation: null,
  });
}

async function invokePublishRpc(
  supabase: SupabaseAdmin,
  fence: AgentTurnFence | undefined,
  args: {
    p_website_id: string;
    p_version_id: string;
    p_expected_revision: number;
    p_expected_config_json: Json;
    p_expected_media_slots: Json | null;
    p_validation_attestation: null;
  },
): Promise<{ publicUrl: string }> {
  const { error: publishError } = fence
    ? await supabase.rpc("publish_website_version_owned", {
        ...args,
        p_trace_id: fence.traceId,
        p_owner_token: fence.ownerToken,
      })
    : await supabase.rpc("publish_website_version_atomic", args);

  if (publishError) {
    if (publishError.message.includes("Website version revision conflict")) {
      throw new Error("Website version revision conflict");
    }
    throw new Error("Unable to publish version");
  }

  const baseUrl = process.env.PUBLIC_APP_URL ?? "https://obra-tech.lovable.app";
  return { publicUrl: `${baseUrl}/lp/${args.p_website_id}?version=${args.p_version_id}` };
}

/**
 * Template-kind publish gate (plan/template-purchase.md §4).
 * The mold is static code, so there is no design to compile: every overlay
 * key must be allowlisted and in budget, every media path owned + signable,
 * and every review/blog entry complete. Unknown molds never publish.
 */
export async function validateTemplateVersionForPublish(
  supabase: SupabaseAdmin,
  websiteId: string,
  config: unknown,
): Promise<void> {
  const parsed = templateOverlaySchema.safeParse(config);
  if (!parsed.success) {
    throw new Error("Template content is invalid and cannot be published");
  }
  const { templateSlug, text, media, reviews, blogs, contact } = parsed.data;
  if (!isTemplatePurchaseSlug(templateSlug)) {
    throw new Error("Unknown template mold cannot be published");
  }
  const manifest = getTemplateManifest(templateSlug);
  if (!manifest) {
    throw new Error("Unknown template mold cannot be published");
  }
  // Step 1 is not complete until every text slot the mold renders is filled —
  // with grounded facts or neutral copy. A missing slot renders the catalog's
  // demo copy on the live site.
  const missingText = Object.keys(manifest.textBudgets).filter((key) => {
    const value = text[key];
    return typeof value !== "string" || !value.trim();
  });
  if (missingText.length > 0) {
    throw new Error(
      `Template content has not been personalized and cannot be published (missing: ${missingText.join(", ")})`,
    );
  }
  for (const [key, value] of Object.entries(text)) {
    if (!Object.prototype.hasOwnProperty.call(manifest.textBudgets, key)) {
      throw new Error(`Unknown template text slot cannot be published: ${key}`);
    }
    const budget = manifest.textBudgets[key];
    if (!value.trim() || value.length > budget) {
      throw new Error(`Template text slot out of budget: ${key}`);
    }
  }
  for (const [key, storagePath] of Object.entries(media)) {
    if (!manifest.mediaSlots.includes(key)) {
      throw new Error(`Unknown template media slot cannot be published: ${key}`);
    }
    if (
      !isOwnedSiteMediaPath(websiteId, storagePath) ||
      !(await signSiteMediaPath(supabase, storagePath))
    ) {
      throw new Error(`Template media slot is detached: ${key}`);
    }
  }
  for (const review of reviews) {
    if (!review.quote.trim() || !review.author.trim()) {
      throw new Error("Template review is incomplete and cannot be published");
    }
  }
  for (const post of blogs) {
    if (!post.category.trim() || !post.title.trim() || !post.excerpt.trim()) {
      throw new Error("Template blog post is incomplete and cannot be published");
    }
  }
  if (contact.phone !== null && !/^[+\d][\d\s\-().]{5,}$/.test(contact.phone)) {
    throw new Error("Template contact phone is invalid");
  }
  if (contact.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    throw new Error("Template contact email is invalid");
  }
}

export async function selectWebsiteVersion(
  supabase: SupabaseAdmin,
  websiteId: string,
  versionId: string,
  expectedRevision: number,
): Promise<void> {
  const { data: target, error: targetError } = await supabase
    .from("website_versions")
    .select("id, status, revision")
    .eq("id", versionId)
    .eq("website_id", websiteId)
    .single();

  if (targetError || !target) {
    throw new Error("Website version not found");
  }
  if (target.revision !== expectedRevision) {
    throw new Error("Website version revision conflict");
  }

  // The RPC preserves live/selected no-ops without incrementing and CASes a draft transition.
  const { error } = await supabase.rpc("select_website_version_atomic", {
    p_website_id: websiteId,
    p_version_id: versionId,
    p_expected_revision: expectedRevision,
  });

  if (error) {
    if (error.message.includes("Website version revision conflict")) {
      throw new Error("Website version revision conflict");
    }
    throw new Error("Unable to select version");
  }
}
