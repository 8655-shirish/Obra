import { createHash, createHmac, randomUUID } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { findProfileByAuthUserId } from "@/lib/auth/profile.server";

const MAX_FIELDS = 20;
const MAX_FIELD_LENGTH = 2_000;
const MAX_TOTAL_LENGTH = 12_000;
const PAGE_SIZE = 20;
const DEFAULT_FIELDS = [
  { id: "name", label: "Name", required: true },
  { id: "email", label: "Email", required: true },
  { id: "phone", label: "Phone", required: false },
  { id: "message", label: "Project details", required: true },
] as const;

const submitLeadSchema = z.object({
  websiteId: z.string().uuid(),
  formData: z.record(z.unknown()),
  submissionId: z.string().uuid().optional(),
  companyWebsite: z.string().max(200).optional(),
});

const cursorSchema = z.object({ submittedAt: z.string().datetime(), id: z.string().uuid() });
const listLeadsSchema = z.object({ cursor: cursorSchema.nullish() });

type FieldSnapshot = { id: string; label: string; required: boolean; value: string | null };

function cleanFieldDefinitions(
  value: unknown,
): Array<{ id: string; label: string; required: boolean }> {
  if (!Array.isArray(value)) return [...DEFAULT_FIELDS];
  const seen = new Set<string>();
  const fields: Array<{ id: string; label: string; required: boolean }> = [];
  for (const item of value.slice(0, MAX_FIELDS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim().slice(0, 64) : "";
    const label = typeof record.label === "string" ? record.label.trim().slice(0, 120) : "";
    if (!id || !label || seen.has(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) continue;
    seen.add(id);
    fields.push({ id, label, required: record.required === true });
  }
  return fields.length > 0 ? fields : [...DEFAULT_FIELDS];
}

function normalizeSubmission(
  formData: Record<string, unknown>,
  definitions: ReturnType<typeof cleanFieldDefinitions>,
) {
  if (Object.keys(formData).length > MAX_FIELDS) throw new Error("Too many form fields");
  let totalLength = 0;
  const accepted: Record<string, string | null> = {};
  const snapshot: FieldSnapshot[] = definitions.map((field) => {
    const raw = formData[field.id];
    if (raw !== undefined && typeof raw !== "string") throw new Error("Invalid form field");
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length > MAX_FIELD_LENGTH) throw new Error(`${field.label} is too long`);
    totalLength += value.length;
    if (field.required && !value) throw new Error(`${field.label} is required`);
    accepted[field.id] = value || null;
    return { ...field, value: value || null };
  });
  if (totalLength > MAX_TOTAL_LENGTH) throw new Error("Form submission is too large");
  const email = accepted.email;
  if (email && !z.string().email().safeParse(email).success)
    throw new Error("Enter a valid email address");
  const phone = accepted.phone;
  if (phone && !/^[+()0-9 .-]{7,30}$/.test(phone)) throw new Error("Enter a valid phone number");
  return { accepted, snapshot };
}

function clientBucket(): string {
  const request = getRequest();
  // Cloudflare overwrites this header at the trusted edge. Never trust a
  // client-supplied X-Forwarded-For chain.
  const address = request?.headers.get("cf-connecting-ip")?.trim();
  if (!address) throw new Error("Lead submission is temporarily unavailable");
  const secret =
    process.env["LEAD_RATE_LIMIT_SECRET"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!secret) {
    throw new Error("Lead submission is temporarily unavailable");
  }
  return createHmac("sha256", secret).update(address).digest("hex");
}

function leadFingerprint(
  websiteId: string,
  submissionId: string | undefined,
  accepted: Record<string, string | null>,
) {
  const stable = Object.keys(accepted)
    .sort()
    .map((key) => [key, accepted[key]]);
  return createHash("sha256")
    .update(
      JSON.stringify([websiteId, submissionId ?? [stable, new Date().toISOString().slice(0, 13)]]),
    )
    .digest("hex");
}

export const submitLead = createServerFn({ method: "POST" })
  .validator((data: unknown) => submitLeadSchema.parse(data))
  .handler(async ({ data }) => {
    const bucket = clientBucket();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.companyWebsite) return { success: true as const, leadId: randomUUID() };
    const { data: website, error: websiteError } = await supabaseAdmin
      .from("websites")
      .select("id, user_id, status, active_version_id, environment")
      .eq("id", data.websiteId)
      .single();
    if (websiteError || !website || website.status !== "live" || !website.active_version_id) {
      throw new Error("This site is not accepting leads");
    }
    const admissionCheckedAt = new Date().toISOString();
    const [entitlementResult, versionResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("website_entitlements")
        .select("id")
        .eq("website_id", website.id)
        .eq("profile_id", website.user_id)
        .eq("environment", website.environment)
        .in("plan", ["starter", "pro"])
        .in("state", ["active", "grace"])
        .eq("quote_admission", true)
        .not("effective_at", "is", null)
        .lte("effective_at", admissionCheckedAt)
        .or(`ends_at.is.null,ends_at.gt.${admissionCheckedAt}`)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("website_versions")
        .select("config_json")
        .eq("id", website.active_version_id)
        .eq("website_id", website.id)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("license_number, business_name")
        .eq("id", website.user_id)
        .single(),
    ]);
    if (entitlementResult.error || versionResult.error || profileResult.error) {
      throw new Error("Unable to verify lead admission");
    }
    const entitlement = entitlementResult.data;
    const version = versionResult.data;
    const profile = profileResult.data;
    if (!entitlement || !version || !profile) throw new Error("This site is not accepting leads");
    const config = (
      version.config_json && typeof version.config_json === "object" ? version.config_json : {}
    ) as Record<string, unknown>;
    if (config.contactHidden === true) throw new Error("This site is not accepting leads");
    const definitions = cleanFieldDefinitions(config.lead_form_fields);
    const { accepted, snapshot } = normalizeSubmission(data.formData, definitions);
    const fingerprint = leadFingerprint(website.id, data.submissionId, accepted);
    const payloadHash = createHash("sha256").update(JSON.stringify(accepted)).digest("hex");
    const sourceName =
      typeof config.businessName === "string" && config.businessName.trim()
        ? config.businessName.trim().slice(0, 160)
        : profile.business_name?.trim().slice(0, 160) || "Website";
    const sourceSnapshot = { name: sourceName, domain: null, path: `/lp/${website.id}` };
    const { data: leadId, error: submitError } = await supabaseAdmin.rpc(
      "submit_starter_website_lead",
      {
        p_website_id: website.id,
        p_version_id: website.active_version_id,
        p_form_data: accepted as Json,
        p_field_snapshot: snapshot as unknown as Json,
        p_source_snapshot: sourceSnapshot as Json,
        p_submission_fingerprint: fingerprint,
        p_payload_hash: payloadHash,
        p_rate_limit_key: bucket,
      },
    );
    if (submitError || !leadId) {
      console.error("[submitLead] failed", submitError?.code ?? "unknown");
      if (submitError?.message.includes("rate limit"))
        throw new Error("Too many requests. Please wait and try again.");
      if (submitError?.message.includes("not accepting"))
        throw new Error("This site is not accepting leads");
      throw new Error("Unable to submit lead");
    }
    return { success: true as const, leadId };
  });

async function requireContractorProfile() {
  const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
  const authUserId = await getContractorAuthUserId();
  if (!authUserId) throw new Error("Unauthorized");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const profile = await findProfileByAuthUserId(supabaseAdmin, authUserId);
  if (!profile?.auth_user_id) throw new Error("Forbidden");
  return { supabaseAdmin, profile };
}

export const getLeadsPage = createServerFn({ method: "GET" })
  .validator((data: unknown) => listLeadsSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin, profile } = await requireContractorProfile();
    const actorUserId = profile.auth_user_id;
    if (!actorUserId) throw new Error("Forbidden");
    let query = supabaseAdmin
      .from("leads")
      .select(
        "id, website_id, form_data, field_snapshot, source_snapshot, snapshot_status, snapshot_version, submitted_at",
      )
      .eq("user_id", profile.id)
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);
    if (data.cursor) {
      query = query.or(
        `submitted_at.lt.${data.cursor.submittedAt},and(submitted_at.eq.${data.cursor.submittedAt},id.lt.${data.cursor.id})`,
      );
    }
    const { data: rows, error } = await query;
    if (error) throw new Error("Unable to load leads");
    const page = (rows ?? []).slice(0, PAGE_SIZE);
    const auditResults = await Promise.all(
      page.map((lead) =>
        supabaseAdmin.rpc("record_lead_governance_event", {
          p_profile_id: profile.id,
          p_lead_id: lead.id,
          p_action: "view",
          p_actor_user_id: actorUserId,
          p_reason: "Authenticated contractor loaded lead details",
        }),
      ),
    );
    if (auditResults.some(({ error }) => error)) throw new Error("Unable to audit lead access");
    const hasMore = (rows?.length ?? 0) > PAGE_SIZE;
    const last = page.at(-1);
    const collectionCheckedAt = new Date().toISOString();
    const { data: leadEntitlements, error: entitlementError } = await supabaseAdmin
      .from("website_entitlements")
      .select("website_id")
      .eq("profile_id", profile.id)
      .eq("environment", profile.environment)
      .in("plan", ["starter", "pro"])
      .in("state", ["active", "grace"])
      .eq("quote_admission", true)
      .not("effective_at", "is", null)
      .lte("effective_at", collectionCheckedAt)
      .or(`ends_at.is.null,ends_at.gt.${collectionCheckedAt}`);
    if (entitlementError) throw new Error("Unable to load lead collection state");
    let collectionEnabled = false;
    const eligibleWebsiteIds = (leadEntitlements ?? []).map(({ website_id }) => website_id);
    if (eligibleWebsiteIds.length) {
      const { data: acceptingWebsites, error: websiteStateError } = await supabaseAdmin
        .from("websites")
        .select("id, active_version_id")
        .in("id", eligibleWebsiteIds)
        .eq("user_id", profile.id)
        .eq("environment", profile.environment)
        .eq("status", "live")
        .not("active_version_id", "is", null);
      if (websiteStateError) throw new Error("Unable to load lead collection state");
      const activeVersions = (acceptingWebsites ?? []).flatMap((website) =>
        website.active_version_id ? [{ id: website.active_version_id, websiteId: website.id }] : [],
      );
      if (activeVersions.length) {
        const { data: versions, error: versionStateError } = await supabaseAdmin
          .from("website_versions")
          .select("id, website_id, config_json")
          .in(
            "id",
            activeVersions.map(({ id }) => id),
          );
        if (versionStateError) throw new Error("Unable to load lead collection state");
        const activePairs = new Set(
          activeVersions.map(({ id, websiteId }) => `${id}:${websiteId}`),
        );
        collectionEnabled = (versions ?? []).some((version) => {
          const config =
            version.config_json && typeof version.config_json === "object"
              ? (version.config_json as Record<string, unknown>)
              : null;
          return (
            activePairs.has(`${version.id}:${version.website_id}`) && config?.contactHidden !== true
          );
        });
      }
    }
    return {
      leads: page,
      hasMore,
      cursor: hasMore && last ? { submittedAt: last.submitted_at, id: last.id } : null,
      collectionEnabled,
      profileId: profile.id,
    };
  });
