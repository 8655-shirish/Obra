import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { coerceLookAndFeel } from "@/lib/site-evidence";
import { buildFactSheet } from "@/lib/site-fact-sheet";
import { attachBlockHtmlToConfig } from "./block-html.server";
import {
  buildStoredPriorVariantSummary,
  layoutFingerprint,
  priorIntentTuples,
  priorLayoutFingerprints,
  priorUnifiedPlans,
} from "./prior-variant-summary";
import { CANONICAL_SECTION_ORDER } from "./section-order";
import type { Json } from "@/integrations/supabase/types";
import { recordReadyGenerationMediaSlots } from "@/lib/media/generation-media-slots.server";
import { isOwnedEvidenceMediaPath } from "@/lib/media/persist-scraped-media.server";
import { mediaManifestFromConfig } from "@/lib/site-theme/media-manifest";
import type { Bucket1Defect } from "@/lib/site-validation/bucket1-contract";

type SupabaseAdmin = SupabaseClient<Database>;

const CROSS_WEBSITE_LAYOUT_SAMPLE_CAP = 12;

export interface TrustMarker {
  id: string;
  label: string;
  detail?: string;
  href?: string;
  kind: string;
}

export interface SiteConfig {
  theme: string;
  primaryColor: string;
  lookAndFeel: string;
  businessName: string;
  licenseNumber: string;
  trade: string;
  city: string;
  services: unknown;
  variantKey: string;
  heroLayout: string;
  sectionOrder: string[];
  component_ids: string[];
  sections: Array<{
    id: string;
    type: string;
    heading: string;
    body: string;
    html?: string;
    entrance?:
      "fade" | "fadeUp" | "fadeDown" | "scaleIn" | "slideFromLeft" | "slideFromRight" | "none";
    stagger?: boolean;
    hover?: "lift" | "underline" | "zoomMedia" | "grow" | "none";
    click?: "quoteCta" | "nav" | "tel" | "mailto" | "none";
  }>;
  block_html?: Record<string, string>;
  lead_form_fields?: Array<{ id: string; label: string; required: boolean }>;
  trustMarkers?: TrustMarker[];
  phone?: string;
  address?: string;
}

function pickPrimaryColor(state: Record<string, unknown>): string {
  const color = state.primaryColor;
  if (typeof color === "string" && /^#[0-9A-Fa-f]{6}$/.test(color)) return color;
  return "#1e3a5f";
}

export function buildSiteConfigFromState(
  onboarding: Record<string, unknown>,
  enrichment: Record<string, unknown>,
  variantKey: string,
): SiteConfig {
  const lookAndFeel = coerceLookAndFeel(onboarding.lookAndFeel);
  const theme = String(onboarding.theme ?? "light");
  const businessName = String(onboarding.businessName ?? "Your Business");
  const licenseNumber = String(onboarding.licenseNumber ?? "");
  const trade = String(onboarding.trade ?? "");
  const city = String(onboarding.city ?? "California");
  const services = onboarding.services ?? [];

  const heroLayout = "centered";
  const sectionOrder = [...CANONICAL_SECTION_ORDER];

  const sheet = buildFactSheet(onboarding, enrichment);
  const enrichmentPlatforms =
    enrichment.platforms && typeof enrichment.platforms === "object"
      ? (enrichment.platforms as Record<string, unknown>)
      : {};

  const reviewFromMatched = sheet.reviews[0]?.quote ?? null;
  const reviewSnippet =
    reviewFromMatched ??
    (Object.keys(enrichmentPlatforms).length > 0
      ? "Reviews and credentials sourced from public listings where available."
      : "Professional contractor services tailored to your project needs.");

  const sections = sectionOrder.map((type) => {
    if (type === "hero") {
      return {
        id: `${variantKey}-hero`,
        type: "hero",
        heading: businessName,
        body: `${trade} services in ${city}.`,
      };
    }
    if (type === "trustmarkers") {
      return {
        id: `${variantKey}-trustmarkers`,
        type: "trustmarkers",
        heading: "Trusted credentials",
        body: "",
      };
    }
    if (type === "services") {
      return {
        id: `${variantKey}-services`,
        type: "services",
        heading: "Services offered",
        body: trade ? `${trade} work in ${city}.` : `Contractor services in ${city}.`,
      };
    }
    if (type === "beforeAfter") {
      return {
        id: `${variantKey}-beforeAfter`,
        type: "beforeAfter",
        heading: "Our work",
        body: "Project photos from recent jobs.",
      };
    }
    if (type === "reviews") {
      return {
        id: `${variantKey}-reviews`,
        type: "reviews",
        heading: "Reviews",
        body: reviewSnippet,
      };
    }
    if (type === "contact") {
      return {
        id: `${variantKey}-contact`,
        type: "contact",
        heading: "Request a quote",
        body: `Tell us about your project in ${city} and surrounding areas.`,
      };
    }
    if (type === "warranty") {
      return {
        id: `${variantKey}-warranty`,
        type: "warranty",
        heading: "Warranty",
        body: "",
      };
    }
    if (type === "hours") {
      return {
        id: `${variantKey}-hours`,
        type: "hours",
        heading: "Hours",
        body: "",
      };
    }
    return {
      id: `${variantKey}-footer`,
      type: "footer",
      heading: businessName,
      body: [licenseNumber ? `Licensed #${licenseNumber}` : null, city].filter(Boolean).join(" · "),
    };
  });

  return {
    theme,
    primaryColor: pickPrimaryColor(onboarding),
    lookAndFeel,
    businessName,
    licenseNumber,
    trade,
    city,
    services,
    variantKey,
    heroLayout,
    sectionOrder,
    component_ids: [],
    sections,
    lead_form_fields: [
      { id: "name", label: "Name", required: true },
      { id: "email", label: "Email", required: true },
      { id: "phone", label: "Phone", required: false },
      { id: "message", label: "Project details", required: true },
    ],
  };
}

type SourceVersionSnapshot = {
  config: Record<string, unknown>;
  evidenceMedia: import("@/lib/site-evidence").EvidenceMediaItem[];
};
function stableEvidenceId(item: import("@/lib/site-evidence").EvidenceMediaItem): string {
  return item.contentHash ?? item.storagePath ?? "";
}
function sourceManifestEvidence(
  websiteId: string,
  config: Record<string, unknown>,
  attachments: Array<{
    slot_id: string;
    asset_id: string;
    storage_path: string;
    mime_type: string;
    provenance: string;
    role: string;
    required: boolean;
    proof_eligible: boolean;
    source_slot_id: string | null;
    poster_slot_id: string | null;
  }>,
): import("@/lib/site-evidence").EvidenceMediaItem[] {
  const parsed = mediaManifestFromConfig(config);
  if (parsed.kind !== "current") return [];
  const attached = new Map(attachments.map((row) => [row.slot_id, row]));
  if (attached.size !== attachments.length || attachments.length !== parsed.manifest.slots.length)
    throw new Error("Source media manifest and attachment ledger differ");
  return parsed.manifest.slots.flatMap((slot) => {
    const row = attached.get(slot.slotId);
    if (!row) throw new Error("Source media manifest and attachment ledger differ");
    if (
      row.asset_id !== slot.assetId ||
      row.storage_path !== slot.storagePath ||
      row.mime_type !== slot.mimeType ||
      row.provenance !== slot.origin ||
      row.role !== slot.role ||
      row.required !== Boolean(slot.required) ||
      row.proof_eligible !== Boolean(slot.proofEligible) ||
      row.source_slot_id !== (slot.sourceSlotId ?? null) ||
      row.poster_slot_id !== (slot.posterSlotId ?? null)
    )
      throw new Error("Source media manifest and attachment ledger differ");
    if (slot.origin !== "evidence") return [];
    if (!row.storage_path.startsWith(websiteId + "/")) return [];
    return [
      {
        url: row.storage_path,
        storagePath: row.storage_path,
        mimeType: row.mime_type,
        contentHash: row.asset_id,
        width: slot.width,
        height: slot.height,
        aspect: slot.width && slot.height ? slot.width / slot.height : undefined,
        orientation:
          slot.width && slot.height
            ? slot.width === slot.height
              ? "square"
              : slot.width > slot.height
                ? "landscape"
                : "portrait"
            : undefined,
        alt: slot.alt,
        proofEligible: row.proof_eligible && slot.proofEligible,
        provenance: { kind: "evidence", sourceUrl: row.storage_path, storageBucket: "site-media" },
      } satisfies import("@/lib/site-evidence").EvidenceMediaItem,
    ];
  });
}
async function loadSourceVersionSnapshot(
  supabase: SupabaseAdmin,
  websiteId: string,
  sourceVersionId: string,
  sourceRevision: number,
): Promise<SourceVersionSnapshot> {
  const { data: snapshots, error: snapshotError } = await supabase.rpc(
    "get_website_version_media_snapshot",
    { p_website_id: websiteId, p_version_id: sourceVersionId, p_revision: sourceRevision },
  );
  const version = snapshots?.[0];
  if (snapshotError || !version)
    throw new Error("Source website version revision no longer matches");
  const attachments = Array.isArray(version.media_slots)
    ? (version.media_slots as Array<{
        slot_id: string;
        asset_id: string;
        storage_path: string;
        mime_type: string;
        provenance: string;
        role: string;
        required: boolean;
        proof_eligible: boolean;
        source_slot_id: string | null;
        poster_slot_id: string | null;
      }>)
    : [];
  const config = (
    version.config_json &&
    typeof version.config_json === "object" &&
    !Array.isArray(version.config_json)
      ? version.config_json
      : {}
  ) as Record<string, unknown>;
  const manifestEvidence = sourceManifestEvidence(websiteId, config, attachments ?? []);
  const gallery =
    config.generatorSchemaVersion === 3
      ? []
      : (Array.isArray(config.mediaGallery) ? config.mediaGallery : [])
          .filter((item): item is import("@/lib/site-evidence").EvidenceMediaItem =>
            Boolean(item && typeof item === "object" && !Array.isArray(item)),
          )
          .map((item) => ({ ...item, url: item.storagePath }))
          .filter(
            (item) =>
              item.origin !== "generated" &&
              item.provenance?.kind === "evidence" &&
              typeof item.contentHash === "string" &&
              item.contentHash.length === 64 &&
              isOwnedEvidenceMediaPath(websiteId, item.storagePath),
          );
  const directFirst = [...manifestEvidence, ...gallery].sort(
    (a, b) =>
      Number(Boolean(a.storagePath?.includes("/enrichment/"))) -
      Number(Boolean(b.storagePath?.includes("/enrichment/"))),
  );
  const seen = new Set<string>();
  return {
    config,
    evidenceMedia: directFirst.filter((item) => {
      const id = stableEvidenceId(item);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  };
}

/** Shared compose path for agent tool + background site generation jobs. */
export async function composeSiteConfigForWebsite(
  supabase: SupabaseAdmin,
  websiteId: string,
  variantKey: string,
  options?: {
    priorVariantSummary?: string;
    priorLayoutFingerprints?: string[];
    priorIntentTuples?: string[];
    priorUnifiedPlans?: import("./unified-design-brief").StoredUnifiedPlan[];
    onProgress?: (message: string) => void | Promise<void>;
    signal?: AbortSignal;
    generationMode?: "unified";
    jobClaim?: import("@/lib/media/generation-media-slots.server").GenerationJobClaim;
    resumeGachaLock?: import("./gacha").GachaLock;
    onGachaLockAccepted?: (lock: import("./gacha").GachaLock) => void | Promise<void>;
    onStageCheckpoint?: (
      stage: import("@/lib/jobs/generation-stage").SiteGenerationCheckpointStage,
    ) => void | Promise<void>;
    evidenceMedia?: import("@/lib/site-evidence").EvidenceMediaItem[];
    sourceEvidenceOnly?: boolean;
    creativeDirection?: string;
    frozenContext?: import("./website-generator.server").FrozenGenerationContext;
    executionUnit?: "planning" | "media" | "composition";
    writerRepairDefects?: Bucket1Defect[];
    deferStillWait?: boolean;
    stillDeadlineAt?: number;
  },
): Promise<Record<string, unknown>> {
  const { generateWebsiteContentForVariant } = await import("./website-generator.server");
  const baseConfig = await generateWebsiteContentForVariant(
    supabase,
    websiteId,
    variantKey,
    options,
  );
  return await attachBlockHtmlToConfig(supabase, baseConfig);
}

function parseVariantGroup(variantKey: string): number | null {
  const legacy = variantKey.match(/^v(\d+)-[ab]$/);
  if (legacy) return Number.parseInt(legacy[1], 10);
  const single = variantKey.match(/^v(\d+)$/);
  if (single) return Number.parseInt(single[1], 10);
  return null;
}

export function normalizeWebsiteGenerationCandidate(
  configJson: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...configJson,
    mediaGallery: Array.isArray(configJson.mediaGallery)
      ? configJson.mediaGallery.map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? { ...(item as Record<string, unknown>), url: undefined }
            : item,
        )
      : configJson.mediaGallery,
    mediaManifest:
      configJson.mediaManifest && typeof configJson.mediaManifest === "object"
        ? {
            ...(configJson.mediaManifest as Record<string, unknown>),
            slots: Array.isArray((configJson.mediaManifest as Record<string, unknown>).slots)
              ? ((configJson.mediaManifest as Record<string, unknown>).slots as unknown[]).map(
                  (slot) =>
                    slot && typeof slot === "object" && !Array.isArray(slot)
                      ? { ...(slot as Record<string, unknown>), url: undefined }
                      : slot,
                )
              : undefined,
          }
        : configJson.mediaManifest,
    layoutFingerprint: layoutFingerprint(configJson).trim(),
  };
}

export async function persistWebsiteGenerationCandidate(
  supabase: SupabaseAdmin,
  websiteId: string,
  configJson: Record<string, unknown>,
  options: { jobClaim: { id: string; attempts: number; claimEpoch: number; runnerId: string } },
): Promise<{ versionIds: string[] }> {
  if (
    configJson.generator !== "unified-site-agent" ||
    typeof configJson.themeSource !== "string" ||
    !configJson.themeSource.trim()
  )
    throw new Error("Unified generation did not produce a renderable design");

  const parsedManifest = mediaManifestFromConfig(configJson);
  if (parsedManifest.kind !== "current")
    throw new Error("Unified generation produced an unsupported media manifest");
  const mediaSlotIds = await recordReadyGenerationMediaSlots({
    supabase,
    websiteId,
    jobClaim: options.jobClaim,
    generatorSchemaVersion: parsedManifest.version,
    manifest: parsedManifest.manifest,
  });
  const { data: inserted, error } = await supabase.rpc(
    "insert_generated_website_version_with_slots",
    {
      p_website_id: websiteId,
      p_config_json: configJson as Json,
      p_job_id: options.jobClaim.id,
      p_claim_epoch: options.jobClaim.claimEpoch,
      p_media_slot_ids: mediaSlotIds,
    },
  );
  const data = inserted?.[0] ?? null;
  if (error || !data) {
    console.error("[persistWebsiteGenerationCandidate]", error);
    throw new Error("Unable to create website version");
  }
  return { versionIds: [data.id] };
}

export async function createWebsiteVariants(
  supabase: SupabaseAdmin,
  websiteId: string,
  options: (
    | { generationKind: "initial"; sourceVersionId?: never; sourceRevision?: never }
    | {
        generationKind: "regeneration";
        sourceVersionId: string;
        sourceRevision: number;
        creativeDirection?: string;
      }
  ) & {
    onVariantProgress?: (variantKey: string, message: string) => void | Promise<void>;
    signal?: AbortSignal;
    jobClaim?: import("@/lib/media/generation-media-slots.server").GenerationJobClaim;
    generationMode?: "unified";
    resumeGachaLock?: import("./gacha").GachaLock;
    onGachaLockAccepted?: (lock: import("./gacha").GachaLock) => void | Promise<void>;
    onStageCheckpoint?: (
      stage: import("@/lib/jobs/generation-stage").SiteGenerationCheckpointStage,
    ) => void | Promise<void>;
    evidenceMedia?: import("@/lib/site-evidence").EvidenceMediaItem[];
    frozenContext?: import("./website-generator.server").FrozenGenerationContext;
    executionUnit?: "planning" | "media" | "composition";
    writerRepairDefects?: Bucket1Defect[];
    deferStillWait?: boolean;
    stillDeadlineAt?: number;
  },
): Promise<{ versionIds: string[] }> {
  if (options.jobClaim && !options.frozenContext)
    throw new Error("Server-owned generation requires an acceptance-time frozen context");
  const { data: priorRows, error: priorRowsError } = await supabase
    .from("website_versions")
    .select("id, version_number, config_json")
    .eq("website_id", websiteId)
    .order("version_number", { ascending: false })
    .limit(4);
  if (priorRowsError) throw new Error("Unable to load prior website versions");

  const { data: websiteState, error: websiteStateError } = await supabase
    .from("websites")
    .select("active_version_id")
    .eq("id", websiteId)
    .maybeSingle();
  if (websiteStateError) throw new Error("Unable to load website version state");
  const recentPriors = (priorRows ?? []).map((row) => ({
    id: row.id,
    version_number: row.version_number,
    config_json: row.config_json,
  }));
  const extraPriorIds = [
    ...new Set(
      [options.sourceVersionId, websiteState?.active_version_id].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  ].filter((id) => !recentPriors.some((row) => row.id === id));
  let extraPriors: typeof recentPriors = [];
  if (extraPriorIds.length > 0) {
    const { data, error } = await supabase
      .from("website_versions")
      .select("id, version_number, config_json")
      .eq("website_id", websiteId)
      .in("id", extraPriorIds);
    if (error) throw new Error("Unable to load referenced website versions");
    extraPriors = data ?? [];
  }
  const storedPriors = [...extraPriors, ...recentPriors];
  // Cross-site diversity is advisory input. The RPC atomically samples current active
  // versions without exposing config_json; an outage must not block generation.
  const { data: crossWebsiteRows } = await supabase.rpc("list_cross_website_layout_fingerprints", {
    p_website_id: websiteId,
    p_limit: CROSS_WEBSITE_LAYOUT_SAMPLE_CAP,
  });
  const crossWebsiteLayoutFingerprints = (crossWebsiteRows ?? []).flatMap((row) => {
    const fingerprint = row.layout_fingerprint?.trim();
    return fingerprint ? [fingerprint] : [];
  });
  const storedPriorSummary = buildStoredPriorVariantSummary(storedPriors, options.sourceVersionId);
  const storedLayoutFingerprints = [
    ...new Set([...priorLayoutFingerprints(storedPriors), ...crossWebsiteLayoutFingerprints]),
  ];
  const storedIntentTuples = priorIntentTuples(storedPriors);
  const storedUnifiedPlans = priorUnifiedPlans(storedPriors, options.sourceVersionId);
  const sourceEvidenceMedia =
    options.generationKind === "regeneration"
      ? (
          await loadSourceVersionSnapshot(
            supabase,
            websiteId,
            options.sourceVersionId,
            options.sourceRevision,
          )
        ).evidenceMedia
      : [];

  const { data: existingVersions, error: existingVersionsError } = await supabase
    .from("website_versions")
    .select("version_number, variant_key")
    .eq("website_id", websiteId)
    .order("version_number", { ascending: false });
  if (existingVersionsError) throw new Error("Unable to load existing website versions");

  const rows = existingVersions ?? [];
  let maxGroup = 0;
  for (const row of rows) {
    const group = parseVariantGroup(row.variant_key);
    if (group !== null && group > maxGroup) maxGroup = group;
  }
  const variantKey = `v${maxGroup + 1}`;

  const configJson = await composeSiteConfigForWebsite(supabase, websiteId, variantKey, {
    priorVariantSummary: storedPriorSummary,
    priorLayoutFingerprints: storedLayoutFingerprints,
    priorIntentTuples: storedIntentTuples,
    priorUnifiedPlans: storedUnifiedPlans,
    onProgress: async (message) => {
      await options.onVariantProgress?.(variantKey, message);
    },
    signal: options.signal,
    generationMode: options.generationMode,
    jobClaim: options.jobClaim,
    resumeGachaLock: options.resumeGachaLock,
    onGachaLockAccepted: options.onGachaLockAccepted,
    onStageCheckpoint: options.onStageCheckpoint,
    evidenceMedia: sourceEvidenceMedia,
    sourceEvidenceOnly: false,
    creativeDirection:
      options.generationKind === "regeneration" ? options.creativeDirection : undefined,
    frozenContext: options.frozenContext,
    executionUnit: options.executionUnit,
    writerRepairDefects: options.writerRepairDefects,
    deferStillWait: options.deferStillWait,
    stillDeadlineAt: options.stillDeadlineAt,
  });

  if (
    configJson.generator === "unified-site-agent" &&
    (typeof configJson.themeSource !== "string" || !configJson.themeSource.trim())
  ) {
    throw new Error("Unified generation did not produce a renderable design");
  }

  if (options.signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");

  let mediaSlotIds: string[] | undefined;
  if (configJson.generator === "unified-site-agent" && options.jobClaim) {
    const parsedManifest = mediaManifestFromConfig(configJson);
    if (parsedManifest.kind !== "current")
      throw new Error("Unified generation produced an unsupported media manifest");
    mediaSlotIds = await recordReadyGenerationMediaSlots({
      supabase,
      websiteId,
      jobClaim: options.jobClaim,
      generatorSchemaVersion: parsedManifest.version,
      manifest: parsedManifest.manifest,
    });
  }

  const realizedLayoutFingerprint = layoutFingerprint(configJson).trim();
  const persistedConfigJson = {
    ...configJson,
    mediaGallery: Array.isArray(configJson.mediaGallery)
      ? configJson.mediaGallery.map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? { ...(item as Record<string, unknown>), url: undefined }
            : item,
        )
      : configJson.mediaGallery,
    mediaManifest:
      configJson.mediaManifest && typeof configJson.mediaManifest === "object"
        ? {
            ...(configJson.mediaManifest as Record<string, unknown>),
            slots: Array.isArray((configJson.mediaManifest as Record<string, unknown>).slots)
              ? ((configJson.mediaManifest as Record<string, unknown>).slots as unknown[]).map(
                  (slot) =>
                    slot && typeof slot === "object" && !Array.isArray(slot)
                      ? { ...(slot as Record<string, unknown>), url: undefined }
                      : slot,
                )
              : undefined,
          }
        : configJson.mediaManifest,
    layoutFingerprint: realizedLayoutFingerprint,
  };
  if (!mediaSlotIds || !options.jobClaim || options.jobClaim.claimEpoch === undefined) {
    throw new Error(
      "Website persistence requires an epoch-fenced generation job and ready media slots",
    );
  }
  const { data: inserted, error } = await supabase.rpc(
    "insert_generated_website_version_with_slots",
    {
      p_website_id: websiteId,
      p_config_json: persistedConfigJson as Json,
      p_job_id: options.jobClaim.id,
      p_claim_epoch: options.jobClaim.claimEpoch,
      p_media_slot_ids: mediaSlotIds,
    },
  );
  const data = inserted?.[0] ?? null;

  if (error || !data) {
    console.error("[createWebsiteVariants]", error);
    throw new Error("Unable to create website version");
  }

  return { versionIds: [data.id] };
}
