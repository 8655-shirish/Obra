import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { forkLiveVersionToDraft } from "./edit-draft.server";
import {
  getTemplateManifest,
  isTemplatePurchaseSlug,
  templateOverlaySchema,
} from "@/lib/template-content/overlay";
import { isOwnedSiteMediaPath } from "@/lib/media/persist-scraped-media.server";
import { signSiteMediaPath } from "@/lib/media/site-media.server";

type SupabaseAdmin = SupabaseClient<Database>;
type AgentTurnFence = { traceId: string; ownerToken: string };

interface TemplateVersionRow {
  id: string;
  website_id: string;
  status: string;
  config_json: Json;
  version_number: number;
  variant_key: string;
  revision: number;
}

/**
 * Template-overlay patch (plan/template-purchase.md §4, §7.2).
 *
 * Draft/live fork, revision CAS, atomic/owned RPC, and edit-event audit —
 * merging overlay keys rather than unified config sections. Rejects unknown
 * keys, over-budget text, detached media, and incomplete reviews/blogs — the
 * same fence publish enforces, so a patched draft is always publishable.
 */
export async function applyTemplatePatchForVersion(
  supabase: SupabaseAdmin,
  websiteId: string,
  versionId: string,
  expectedRevision: number,
  patch: Record<string, unknown>,
  fence?: AgentTurnFence,
): Promise<{ versionId: string; revision: number }> {
  const { data: version, error: versionError } = await supabase
    .from("website_versions")
    .select("id, website_id, status, config_json, version_number, variant_key, revision")
    .eq("id", versionId)
    .eq("website_id", websiteId)
    .single();
  if (versionError || !version) {
    throw new Error("Website version not found");
  }
  const base = templateOverlaySchema.safeParse(version.config_json);
  if (!base.success || !isTemplatePurchaseSlug(base.data.templateSlug)) {
    throw new Error("applyTemplatePatch only targets template-kind versions");
  }
  // Fail fast with the current revision so callers can retry once against it
  // instead of burning a model round-trip on a doomed RPC CAS.
  if (version.revision !== expectedRevision) {
    throw new Error(`Website version revision conflict: current revision is ${version.revision}`);
  }
  const manifest = getTemplateManifest(base.data.templateSlug);
  if (!manifest) {
    throw new Error("Unknown template mold cannot be patched");
  }

  const overlay = base.data;
  const next: Record<string, unknown> = {
    kind: "template",
    templateSlug: overlay.templateSlug,
    identity: { ...overlay.identity },
    text: { ...overlay.text },
    media: { ...overlay.media },
    reviews: [...overlay.reviews],
    blogs: [...overlay.blogs],
    contact: { ...overlay.contact },
  };
  const input = (patch ?? {}) as Record<string, unknown>;

  if (input.text !== undefined) {
    if (typeof input.text !== "object" || input.text === null || Array.isArray(input.text)) {
      throw new Error("Template text patch must be an object");
    }
    const text = next.text as Record<string, string>;
    for (const [key, value] of Object.entries(input.text as Record<string, unknown>)) {
      if (!Object.prototype.hasOwnProperty.call(manifest.textBudgets, key)) {
        throw new Error(`Unknown template text slot: ${key}`);
      }
      const budget = manifest.textBudgets[key];
      // Null restores the template default (reset flow); absent keys are untouched.
      if (value === null) {
        delete text[key];
        continue;
      }
      if (typeof value !== "string" || !value.trim() || value.length > budget) {
        throw new Error(`Template text slot out of budget: ${key}`);
      }
      text[key] = value;
    }
  }
  if (input.media !== undefined) {
    if (typeof input.media !== "object" || input.media === null || Array.isArray(input.media)) {
      throw new Error("Template media patch must be an object");
    }
    const media = next.media as Record<string, string>;
    for (const [key, value] of Object.entries(input.media as Record<string, unknown>)) {
      if (!manifest.mediaSlots.includes(key)) {
        throw new Error(`Unknown template media slot: ${key}`);
      }
      if (value === null) {
        delete media[key];
        continue;
      }
      if (typeof value !== "string" || !value) {
        throw new Error(`Template media slot needs a storage path: ${key}`);
      }
      if (!isOwnedSiteMediaPath(websiteId, value) || !(await signSiteMediaPath(supabase, value))) {
        throw new Error(`Template media slot is detached: ${key}`);
      }
      media[key] = value;
    }
  }
  if (input.reviews !== undefined) {
    if (!Array.isArray(input.reviews)) throw new Error("Template reviews patch must be a list");
    for (const review of input.reviews) {
      const candidate = review as { quote?: unknown; author?: unknown; attribution?: unknown };
      if (
        typeof candidate.quote !== "string" ||
        !candidate.quote.trim() ||
        typeof candidate.author !== "string" ||
        !candidate.author.trim() ||
        (candidate.attribution !== null && typeof candidate.attribution !== "string")
      ) {
        throw new Error("Template review is incomplete");
      }
    }
    next.reviews = input.reviews;
  }
  if (input.blogs !== undefined) {
    if (!Array.isArray(input.blogs)) throw new Error("Template blogs patch must be a list");
    for (const post of input.blogs) {
      const candidate = post as {
        category?: unknown;
        title?: unknown;
        excerpt?: unknown;
        image?: unknown;
      };
      if (
        typeof candidate.category !== "string" ||
        !candidate.category.trim() ||
        typeof candidate.title !== "string" ||
        !candidate.title.trim() ||
        typeof candidate.excerpt !== "string" ||
        !candidate.excerpt.trim() ||
        (candidate.image !== null && typeof candidate.image !== "string")
      ) {
        throw new Error("Template blog post is incomplete");
      }
      if (typeof candidate.image === "string" && candidate.image) {
        if (
          !isOwnedSiteMediaPath(websiteId, candidate.image) ||
          !(await signSiteMediaPath(supabase, candidate.image))
        ) {
          throw new Error("Template blog image is detached");
        }
      }
    }
    next.blogs = input.blogs;
  }
  const sectionKeys = {
    contact: ["phone", "email", "area", "hours"],
    identity: ["businessName", "licenseNumber", "city", "phone", "email"],
  } as const;
  for (const section of ["contact", "identity"] as const) {
    if (input[section] !== undefined) {
      const incoming = input[section];
      if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
        throw new Error(`Template ${section} patch must be an object`);
      }
      for (const key of Object.keys(incoming as Record<string, unknown>)) {
        if (!(sectionKeys[section] as readonly string[]).includes(key)) {
          throw new Error(`Unknown template ${section} field: ${key}`);
        }
        const value = (incoming as Record<string, unknown>)[key];
        if (value !== null && typeof value !== "string") {
          throw new Error(`Template ${section} field must be text: ${key}`);
        }
      }
      Object.assign(next[section] as Record<string, unknown>, incoming as Record<string, unknown>);
    }
  }

  if (JSON.stringify(next) === JSON.stringify({ ...overlay })) {
    throw new Error("Edit did not change the template overlay");
  }

  let targetVersionId = versionId;
  let targetExpectedRevision = expectedRevision;
  if (version.status === "live") {
    const forked = await forkLiveVersionToDraft(
      supabase,
      websiteId,
      version as TemplateVersionRow,
      fence,
    );
    targetVersionId = forked.id;
    targetExpectedRevision = forked.revision;
  }

  const configArgs = {
    p_website_id: websiteId,
    p_version_id: targetVersionId,
    p_expected_revision: targetExpectedRevision,
    p_config_json: next as unknown as Json,
    p_category: "template",
    p_patch_json: patch as unknown as Json,
  };
  const { data: revision, error: updateError } = fence
    ? await supabase.rpc("update_website_version_config_owned", {
        ...configArgs,
        p_trace_id: fence.traceId,
        p_owner_token: fence.ownerToken,
      })
    : await supabase.rpc("update_website_version_config_atomic", configArgs);

  if (updateError) {
    if (updateError.message.includes("Website version revision conflict")) {
      throw new Error("Website version revision conflict");
    }
    throw new Error("Unable to apply template patch");
  }
  if (revision === null) {
    throw new Error("Unable to apply template patch");
  }

  return { versionId: targetVersionId, revision };
}
