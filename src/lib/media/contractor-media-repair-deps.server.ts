import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";

import type { ContractorMediaRepairDeps, RepairVersionRow } from "./contractor-media-repair.server";

type SupabaseAdmin = SupabaseClient<Database>;

const BUCKET = "site-media";

/** Strip tokens/URLs from database errors before they reach an API response. */
function sanitize(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}/g, "[token]")
    .slice(0, 300);
}

export function createContractorMediaRepairDeps(
  supabase: SupabaseAdmin,
): ContractorMediaRepairDeps {
  return {
    async loadWebsite(websiteId) {
      const { data, error } = await supabase
        .from("websites")
        .select("id, active_version_id")
        .eq("id", websiteId)
        .maybeSingle();
      if (error || !data) return null;
      return { id: data.id, activeVersionId: data.active_version_id };
    },
    async loadEnrichment(websiteId) {
      const { data } = await supabase
        .from("contractor_profiles")
        .select("enrichment_json")
        .eq("website_id", websiteId)
        .maybeSingle();
      const enrichment = data?.enrichment_json;
      return enrichment && typeof enrichment === "object" && !Array.isArray(enrichment)
        ? (enrichment as Record<string, unknown>)
        : {};
    },
    async loadVersions(websiteId) {
      const { data, error } = await supabase
        .from("website_versions")
        .select("id, status, revision, version_number, variant_key, config_json")
        .eq("website_id", websiteId)
        .order("version_number", { ascending: true });
      if (error || !data) return [];
      return data.map((row) => ({
        id: row.id,
        status: row.status,
        revision: row.revision,
        version_number: row.version_number,
        variant_key: row.variant_key,
        config_json:
          row.config_json && typeof row.config_json === "object" && !Array.isArray(row.config_json)
            ? (row.config_json as Record<string, unknown>)
            : {},
      })) satisfies RepairVersionRow[];
    },
    async loadSlots(websiteId) {
      const { data, error } = await supabase
        .from("website_version_media_slots")
        .select(
          "version_id, slot_id, asset_id, storage_path, mime_type, provenance, role, required, proof_eligible, source_slot_id, poster_slot_id",
        )
        .eq("website_id", websiteId);
      if (error || !data) return [];
      return data;
    },
    async storageExists(storagePath) {
      const slash = storagePath.lastIndexOf("/");
      const prefix = slash === -1 ? "" : storagePath.slice(0, slash);
      const name = storagePath.slice(slash + 1);
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(prefix, { search: name, limit: 100 });
      if (error || !data) return false;
      return data.some((object) => object.name === name && object.id);
    },
    async upload(storagePath, bytes, mimeType) {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
      if (!error) return true;
      return /already exists|duplicate/i.test(error.message ?? "");
    },
    async saveEnrichment(websiteId, enrichment) {
      const { error } = await supabase
        .from("contractor_profiles")
        .update({ enrichment_json: enrichment as unknown as Json })
        .eq("website_id", websiteId);
      return !error;
    },
    async updateVersionMedia({ websiteId, versionId, expectedRevision, configJson, mediaSlots }) {
      // Historical (pre schema-v3) configs are not valid input for the v3 media RPC.
      // They take a minimal, revision-fenced, draft-only gallery update instead.
      if (Number((configJson as Record<string, unknown>).generatorSchemaVersion) !== 3) {
        const { data: current, error: readError } = await supabase
          .from("website_versions")
          .select("config_json, status")
          .eq("id", versionId)
          .eq("website_id", websiteId)
          .eq("revision", expectedRevision)
          .maybeSingle();
        if (readError) return { ok: false, error: sanitize(readError.message) };
        if (!current) return { ok: false, error: "version not found at expected revision" };
        if (current.status === "live")
          return { ok: false, error: "refusing to modify a live version" };

        const base =
          current.config_json &&
          typeof current.config_json === "object" &&
          !Array.isArray(current.config_json)
            ? (current.config_json as Record<string, unknown>)
            : {};
        const nextConfig = {
          ...base,
          mediaGallery: (configJson as Record<string, unknown>).mediaGallery ?? [],
        };

        const { data: updated, error: updateError } = await supabase
          .from("website_versions")
          .update({
            config_json: nextConfig as unknown as Json,
            revision: expectedRevision + 1,
          })
          .eq("id", versionId)
          .eq("website_id", websiteId)
          .eq("revision", expectedRevision)
          .neq("status", "live")
          .select("id")
          .maybeSingle();
        if (updateError) {
          console.error("[repair] updateVersionMedia(legacy)", versionId, updateError.message);
          return { ok: false, error: sanitize(updateError.message) };
        }
        if (!updated) return { ok: false, error: "revision conflict or live version" };
        return { ok: true };
      }

      const { error } = await supabase.rpc("update_website_version_config_with_media_atomic", {
        p_website_id: websiteId,
        p_version_id: versionId,
        p_expected_revision: expectedRevision,
        p_config_json: configJson as unknown as Json,
        p_category: "media",
        p_patch_json: { kind: "historical-media-repair" } as unknown as Json,
        p_media_slots: mediaSlots as unknown as Json,
      });
      if (error) console.error("[repair] updateVersionMedia", versionId, error.message);
      return error ? { ok: false, error: sanitize(error.message) } : { ok: true };
    },
    async forkVersion({ websiteId, versionId, expectedRevision }) {
      const { data, error } = await supabase.rpc("fork_website_version_with_media", {
        p_website_id: websiteId,
        p_source_version_id: versionId,
        p_expected_revision: expectedRevision,
      });
      if (error || !data) {
        console.error("[repair] forkVersion", versionId, error?.message);
        return null;
      }
      const row = (Array.isArray(data) ? data[0] : data) as RepairVersionRow | undefined;
      if (!row) return null;
      return {
        id: row.id,
        status: row.status,
        revision: row.revision,
        version_number: row.version_number,
        variant_key: row.variant_key,
        config_json: (row.config_json ?? {}) as Record<string, unknown>,
      };
    },
    async publishVersion({ websiteId, versionId, expectedRevision, configJson, mediaSlots }) {
      const { error } = await supabase.rpc("publish_website_version_atomic", {
        p_website_id: websiteId,
        p_version_id: versionId,
        p_expected_revision: expectedRevision,
        p_expected_config_json: configJson as unknown as Json,
        p_expected_media_slots: mediaSlots as unknown as Json,
        p_validation_attestation: null,
      });
      if (error) console.error("[repair] publishVersion", versionId, error.message);
      return !error;
    },
    async recordAudit(event) {
      const { error } = await supabase.from("media_repair_events").insert({
        website_id: String(event.website_id),
        payload_json: event as unknown as Json,
      });
      if (error) console.error("[repair] recordAudit", error.message);
    },
  };
}
