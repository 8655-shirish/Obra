import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  getTemplateManifest,
  isTemplatePurchaseSlug,
  resolveTemplatePurchaseIdentity,
  templateOverlaySchema,
  type TemplateId,
  type TemplatePurchaseSlug,
} from "@/lib/template-content/overlay";
import { isOwnedSiteMediaPath } from "@/lib/media/persist-scraped-media.server";
import { signSiteMediaPath } from "@/lib/media/site-media.server";

type SupabaseAdmin = SupabaseClient<Database>;

export interface TemplateIdentity {
  id: TemplateId;
  slug: TemplatePurchaseSlug;
}

/**
 * Transitional (phase 2 removes with the slug paths): true when a query
 * failed only because template_id does not exist yet — i.e. the identity
 * migration is unapplied on that database. Reads then fall back to slug
 * (legacy behavior); id writes are skipped. Any other error stays loud.
 */
function isMissingColumnError(
  error: { message?: string; code?: string } | null | undefined,
  column: string,
): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const message = error.message ?? "";
  return message.includes(column) && message.includes("schema cache");
}

/**
 * Template-purchase capture + seeding (plan/template-purchase.md §4, §5, §9).
 *
 * Template identity flows: checkout dialog → checkout_sessions.template_slug
 * → websites.template_slug (at entitlement grant) → seeded template version.
 * Every step is idempotent and every failure is non-fatal to payment and
 * identity linking: Step 1 entry re-runs copy + seed before starting work,
 * so a metadata miss degrades to a support-state card, never a broken buyer.
 */

export async function recordCheckoutTemplateSlug(
  supabaseAdmin: SupabaseAdmin,
  checkoutSessionId: string,
  identity: TemplateIdentity,
): Promise<void> {
  const { error: slugError } = await supabaseAdmin
    .from("checkout_sessions")
    .update({ template_slug: identity.slug })
    .eq("id", checkoutSessionId);
  if (slugError) {
    throw new Error(`Unable to record template slug: ${slugError.message}`);
  }
  const { error: idError } = await supabaseAdmin
    .from("checkout_sessions")
    // Transitional cast: template_id reaches generated types in phase 2.
    .update({ template_id: identity.id } as never)
    .eq("id", checkoutSessionId);
  if (idError && !isMissingColumnError(idError, "template_id")) {
    throw new Error(`Unable to record template id: ${idError.message}`);
  }
}

/**
 * Tolerant session-identity read for routing decisions (verify, finalize).
 * Never throws for a missing column — pre-migration databases resolve through
 * slug exactly as before. Returns null only when no template intent exists.
 */
export async function readCheckoutSessionIdentity(
  supabaseAdmin: SupabaseAdmin,
  checkoutSessionId: string,
): Promise<TemplateIdentity | null> {
  const { data, error } = await supabaseAdmin
    .from("checkout_sessions")
    .select("*")
    .eq("id", checkoutSessionId)
    .maybeSingle();
  if (error) {
    throw new Error(`Unable to read template identity: ${error.message}`);
  }
  if (!data) return null;
  // Transitional: template_id is absent pre-migration (phase 2 types it).
  const row = data as unknown as { template_id?: unknown; template_slug?: unknown };
  if (!("template_id" in row)) {
    return resolveTemplatePurchaseIdentity(row.template_slug ?? null, null);
  }
  return resolveTemplatePurchaseIdentity(row.template_slug ?? null, row.template_id ?? null);
}

export async function copyTemplateIdentityToWebsite(
  supabaseAdmin: SupabaseAdmin,
  checkoutSessionId: string,
  websiteId: string,
): Promise<TemplateIdentity | null> {
  const identity = await readCheckoutSessionIdentity(supabaseAdmin, checkoutSessionId);
  // Absent identity = unified/direct path: leave the website untouched.
  // Unknown values never reach here — reservation rejects them pre-payment.
  if (!identity) return null;
  const { data: websiteRow, error: websiteError } = await supabaseAdmin
    .from("websites")
    .select("*")
    .eq("id", websiteId)
    .maybeSingle();
  if (websiteError || !websiteRow) {
    throw new Error("Unable to load website for template slug copy");
  }
  // Transitional: pre-migration rows carry slug only (phase 2 types template_id).
  const website = websiteRow as unknown as {
    id: string;
    template_id?: unknown;
    template_slug?: unknown;
  };
  const rowIdentity = resolveTemplatePurchaseIdentity(
    website.template_slug ?? null,
    "template_id" in website ? (website.template_id ?? null) : null,
  );
  const { count: versionCount, error: countError } = await supabaseAdmin
    .from("website_versions")
    .select("id", { count: "exact", head: true })
    .eq("website_id", websiteId);
  if (countError) {
    throw new Error(`Unable to check website versions: ${countError.message}`);
  }
  // Never retag a website that already carries a different template identity:
  // tagging a unified/agent-built site would corrupt its rendering once the
  // /lp template branch reads it, and a second template purchase on the same
  // row is the N-site case (open plan Q15.1), not a retag.
  if ((versionCount ?? 0) > 0 && rowIdentity?.id !== identity.id) {
    // Same-template healing: a previous copy may have seeded template versions
    // while the website row kept a null identity (copy failed after seed, or a
    // same-template rebuy). The copy is safe exactly when every existing
    // version is already this template — the set-once trigger still guards
    // real races.
    const { data: existingVersions, error: versionsError } = await supabaseAdmin
      .from("website_versions")
      .select("config_json")
      .eq("website_id", websiteId)
      .limit(50);
    if (versionsError) {
      console.error("[template-purchase] unable to inspect versions for slug copy", {
        websiteId,
        message: versionsError.message,
      });
    }
    const rows = existingVersions ?? [];
    const allSameTemplate =
      rows.length === (versionCount ?? 0) &&
      rows.every((row) => {
        const config = row.config_json as {
          kind?: unknown;
          templateSlug?: unknown;
        } | null;
        return config?.kind === "template" && config?.templateSlug === identity.slug;
      });
    if (!allSameTemplate) {
      console.error("[template-purchase] website already has versions; refusing retag", {
        websiteId,
        existingSlug: website.template_slug,
      });
      throw new Error(
        "TEMPLATE_SITE_CONFLICT: this purchase does not match this website's existing setup. Contact support and mention this website.",
      );
    }
  }
  // Set-once DB trigger guards against overwrite; same-value retry passes.
  // A P0001 here means a genuine second-template race or N-site purchase.
  // The id write is skipped pre-migration (missing column); the slug write is
  // authoritative until phase 2, so tagging still lands everywhere.
  const { error: updateError } = await supabaseAdmin
    .from("websites")
    .update({ template_id: identity.id, template_slug: identity.slug } as never)
    .eq("id", websiteId);
  if (updateError && isMissingColumnError(updateError, "template_id")) {
    const { error: slugOnlyError } = await supabaseAdmin
      .from("websites")
      .update({ template_slug: identity.slug })
      .eq("id", websiteId);
    if (slugOnlyError) {
      if (slugOnlyError.message.includes("immutable once set")) {
        console.error("[template-purchase] slug already set differently (N-site case)", {
          websiteId,
        });
        return null;
      }
      throw new Error(`Unable to copy template slug: ${slugOnlyError.message}`);
    }
    return identity;
  }
  if (updateError) {
    if (updateError.message.includes("immutable once set")) {
      console.error("[template-purchase] slug already set differently (N-site case)", {
        websiteId,
      });
      return null;
    }
    throw new Error(`Unable to copy template identity: ${updateError.message}`);
  }
  return identity;
}

export async function seedTemplateVersion(
  supabaseAdmin: SupabaseAdmin,
  websiteId: string,
  slug: TemplatePurchaseSlug,
): Promise<string | null> {
  const manifest = getTemplateManifest(slug);
  if (!manifest) return null;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("website_versions")
    .select("id")
    .eq("website_id", websiteId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Unable to check template versions: ${existingError.message}`);
  }
  // Idempotent: a version already exists (retry, re-entry, or race).
  if (existing) return existing.id;

  const { data: website, error: websiteError } = await supabaseAdmin
    .from("websites")
    .select("user_id")
    .eq("id", websiteId)
    .maybeSingle();
  if (websiteError || !website) {
    throw new Error("Unable to load website for template seeding");
  }
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("business_name, license_number, city, email")
    .eq("id", website.user_id)
    .maybeSingle();

  // Only purchase-known identity is seeded, plus the checked-in starter blog
  // pack. Everything else stays empty so the renderer falls back to static
  // template defaults — never fabricated.
  const overlay = {
    ...manifest.defaultOverlay,
    blogs: manifest.defaultBlogs.map((post) => ({ ...post, image: null })),
    identity: {
      businessName: profile?.business_name ?? null,
      licenseNumber: profile?.license_number ?? null,
      city: profile?.city ?? null,
      phone: null,
      email: profile?.email ?? null,
    },
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("website_versions")
    .insert({
      website_id: websiteId,
      version_number: 1,
      variant_key: slug,
      status: "draft",
      config_json:
        overlay as unknown as Database["public"]["Tables"]["website_versions"]["Insert"]["config_json"],
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new Error(`Unable to seed template version: ${insertError?.message ?? "unknown"}`);
  }
  return inserted.id;
}

/**
 * Ensures a template website is ready for Step 1: identity present (copied
 * from the latest completed checkout when missing) and a version seeded.
 * Idempotent — safe to call on every Step 1 entry and retry.
 */
export async function ensureTemplateSeeded(
  supabaseAdmin: SupabaseAdmin,
  websiteId: string,
): Promise<{ id: TemplateId; slug: TemplatePurchaseSlug; versionId: string }> {
  const { data: websiteRow } = await supabaseAdmin
    .from("websites")
    .select("*")
    .eq("id", websiteId)
    .maybeSingle();
  // Transitional: pre-migration rows carry slug only (phase 2 types template_id).
  const website = websiteRow as unknown as {
    template_id?: unknown;
    template_slug?: unknown;
  } | null;
  let identity = resolveTemplatePurchaseIdentity(
    website?.template_slug ?? null,
    website && "template_id" in website ? (website.template_id ?? null) : null,
  );
  if (!identity) {
    const { data: session } = await supabaseAdmin
      .from("checkout_sessions")
      .select("id")
      .eq("website_id", websiteId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!session) {
      throw new Error(
        "TEMPLATE_PURCHASE_NOT_FOUND: no template purchase was found for this website. Contact support and mention this website.",
      );
    }
    const copied = await copyTemplateIdentityToWebsite(supabaseAdmin, session.id, websiteId);
    if (!copied) {
      throw new Error(
        "TEMPLATE_PURCHASE_NOT_FOUND: no template purchase was found for this website. Contact support and mention this website.",
      );
    }
    identity = copied;
  }
  const versionId = await seedTemplateVersion(supabaseAdmin, websiteId, identity.slug);
  if (!versionId) {
    throw new Error("Unable to prepare template version");
  }
  return { id: identity.id, slug: identity.slug, versionId };
}

/**
 * Resolves a template overlay's media storage paths to signed URLs for
 * rendering. Unregistered molds, unknown keys, unowned paths, and unsignable
 * paths are skipped — the renderer falls back to static template art.
 */
export async function resolveTemplateOverlayMedia(
  supabaseAdmin: SupabaseAdmin,
  websiteId: string,
  config: unknown,
): Promise<Record<string, string>> {
  const parsed = templateOverlaySchema.safeParse(config);
  if (!parsed.success || !isTemplatePurchaseSlug(parsed.data.templateSlug)) return {};
  const manifest = getTemplateManifest(parsed.data.templateSlug);
  if (!manifest) return {};
  const resolved: Record<string, string> = {};
  for (const [key, storagePath] of Object.entries(parsed.data.media)) {
    if (!manifest.mediaSlots.includes(key)) continue;
    if (!isOwnedSiteMediaPath(websiteId, storagePath)) continue;
    const url = await signSiteMediaPath(supabaseAdmin, storagePath);
    if (url) resolved[key] = url;
  }
  return resolved;
}
