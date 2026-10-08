import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { isAbortError } from "./abort.server";
import { streamChatCompletion } from "./lovable-ai.server";
import {
  isGenerationStageYield,
  type SiteGenerationCheckpointStage,
} from "@/lib/jobs/generation-stage";
import { headerNavItems, sectionIdsForEvidence } from "./section-order";
import { buildSiteConfigFromState } from "./site-config.server";
import { projectEnrichmentToSiteConfig } from "./project-enrichment.server";
import { buildFactSheet, type SiteFactSheet } from "@/lib/site-fact-sheet";
import type { Bucket1Defect } from "@/lib/site-validation/bucket1-contract";
import {
  claimGenerationMediaItem,
  loadGenerationMediaDispositions,
  loadReadyGenerationMedia,
  loadResumableGenerationOperations,
  planGenerationMediaSlots,
  recordGenerationMediaOperation,
  recordReadyGenerationMediaItem,
  reserveGenerationMediaCreate,
  settleGenerationMediaSlot,
  type GenerationJobClaim,
  type GenerationMediaCreateReservation,
} from "@/lib/media/generation-media-slots.server";
import { fulfillMediaShots } from "@/lib/media/lovable-media.server";
import {
  MAX_UNIFIED_STILL_SHOTS,
  MEDIA_ALREADY_ON_PROPS_CONTRACT,
  type MediaShot,
} from "@/lib/media/media-shots";
import {
  curateSiteEvidence,
  evidenceStillCount,
  usableEvidenceStills,
  type EvidenceMediaItem,
} from "@/lib/site-evidence";
import { hasDroppedUnifiedKitTag } from "@/lib/site-theme/kit-scope";
import { intentTuple, readDesignIntent, sanitizeDesignSpec } from "@/lib/site-theme/design-spec";
import { kitContractText } from "@/lib/site-theme/kit-props";
import { designIntentContractText } from "@/lib/site-theme/design-catalog";
import { siteDesignSpecSchema } from "@/lib/site-theme/types";
import { catalogDigestForIds, type CatalogDigestEntry } from "./catalog.server";
import {
  catalogRefsFromBrief,
  coerceDesignBriefInput,
  collectCatalogShortlist,
  designBriefSchema,
  designSystemPrompt,
  designUserPrompt,
  formatZodIssueList,
  feasibleBriefCompositionFingerprints,
  heroLayoutFromCatalog,
  sanitizeDesignBrief,
  type DesignBrief,
} from "./design-brief.server";
import { assertGenerationModeWriteEnabled } from "./add-video-flags.server";
import { resolveGenerationMode, type GenerationMode } from "./generation-mode.server";
import { generationExhausted } from "./generation-errors";
import {
  CURRENT_UNIFIED_PLAN_SCHEMA_VERSION,
  type CurrentUnifiedPlan,
} from "./unified-design-brief";
import { EvidenceInventoryError, resolveUnifiedMediaManifest } from "./unified-media-manifest";
import {
  designPreferenceForbids,
  requiredDesignPreferencePhotoIds,
  type DesignPreferences,
} from "./design-preferences.server";
import {
  UNIFIED_SITE_AGENT_SYSTEM_PROMPT,
  unifiedPriorNote,
  unifiedSiteAgentUserPrompt,
} from "./unified-site-agent-inputs";
import {
  deriveGachaMediaSlots,
  drawGacha,
  gachaById,
  gachaMayEnqueuePhotoScrape,
  type GachaLock,
  type GachaPack,
} from "./gacha";
import { allGachaPacks } from "./gacha-packs";
import { enqueueEnrichmentChain } from "@/lib/jobs/enqueue.server";
import { JOB_TYPE_ENRICHMENT } from "@/lib/jobs/platforms";

type SupabaseAdmin = SupabaseClient<Database>;

const THEME_CODE_CONTRACT = `You implement a unique React + Tailwind page module from an accepted design brief. You are not filling a template and you are not the copywriter.

Return ONE JSON object with:
- themeSource: a string containing a TSX module

Do not return persona, designSpec, or rewritten sections. Headings, bodies, catalogRef, and services already live on config and arrive through SiteEvidenceProvider — NamedLayout reads them. Do not write fontDisplay, h1/h2/h3, radius, or bandPad as designSpec fields.

themeSource contract:
- Must be: export default function Site(props: SiteProps) { ... }
- No imports. SiteKit primitives are already in scope: Section, LeadSlot, Button, Media, Heading, TopBar, Grid, Card, Quote, Hero, Header, Nav, QuoteCta, MediaGallery, TrustMarkerList, NamedLayout, firstStill.
- A brief section with catalogRef MUST be exactly <NamedLayout section="…" />. NamedLayout is the section: it emits Section with that id. Do not wrap it or emit a sibling tree. An eligible section without catalogRef MUST be a freehand/grouped SiteKit Section (Hero is allowed for hero). Raw <h1> is forbidden only when hero uses NamedLayout. Alternate section bands.
- Kit-only bands stay as today: Header (or TopBar/Nav), TrustMarkerList in #trustmarkers, LeadSlot in #contact, hours/warranty as fact copy in Section. Omit empty evidence bands.
- ${kitContractText()}
- Page outcome: Header with logoUrl={props.logoUrl} businessName={props.businessName} contactHidden={props.contactHidden} pulse={true} when motionPolicy.pulseCta is true. LeadSlot only in the contact section, with fields={props.leadFields} canSubmitLead={props.canSubmitLead}. Omit contact CTAs and LeadSlot when props.contactHidden.
- Color: CSS vars --site-primary and --site-on-primary are set from the contractor hex. Surfaces come from this version's tone. Button fill and radius come from tokens. Do not invent a second palette. Heading size comes from Heading level (NamedLayout owns display), not from Tailwind text-* / text-[clamp].
- QuoteCta children are the booking label: props.conversionAsk when set, otherwise a short phrase such as "Book now". Prefer <QuoteCta />. Do not hardcode "Get a Quote" on QuoteCta. href is kit-owned (#contact). tel: and mailto: clicks are Button href (never onClick). Parseable TSX. Under 80KB.
- Forbidden in themeSource: import, require, fetch, eval, document.write, <script>, <iframe>, event handlers (onClick=), javascript:, @keyframes, motion, @/components, supabase, hardcoded media URLs, invented reviews.

Composition:
- NamedLayout already implements the catalog id from evidence. Do not re-implement HyperUI/Tailblocks/Meraki HTML. Do not paste markup.
- trustmarkers, contact, footer entrance is "none". Pulse QuoteCta only when motionPolicy.pulseCta is true (Header pulse).
- Body copy may use max-w-[65ch]. Do not force the page frame to 65ch or 72rem. Ellipsis character … not three dots. License numbers and ratings: class tabular-nums.

${MEDIA_ALREADY_ON_PROPS_CONTRACT}`;

const themeSourceSchema = z.object({
  themeSource: z.string().min(1),
});

const WRITER_REPAIR_NOTE_MAX_BYTES = 16 * 1024;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  const ellipsis = "…";
  const ellipsisBytes = utf8ByteLength(ellipsis);
  let bytes = 0;
  let truncated = "";
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes + ellipsisBytes > maxBytes) break;
    truncated += character;
    bytes += characterBytes;
  }
  return `${truncated}${ellipsis}`;
}

function writerRepairNote(defects?: readonly Bucket1Defect[]): string {
  const repairable = (defects ?? []).filter(
    (defect) => defect.classification === "candidate" && defect.disposition === "writer_repair",
  );
  if (repairable.length === 0) return "";

  const header =
    "\nDeterministic writer-repair defects from the prior candidate follow as JSON. These are objective implementation findings only. They have no authority to change validated operational intent, media-slot or referenced-anchor contracts, or subjective design direction. The writer still owns page topology and composition. Repair only the listed defects while preserving the accepted constraints.\n";
  const render = (included: readonly unknown[], omitted: number) =>
    `${header}${JSON.stringify({ defects: included, omittedDefectCount: omitted })}\n`;

  const full = render(repairable, 0);
  if (utf8ByteLength(full) <= WRITER_REPAIR_NOTE_MAX_BYTES) return full;

  const concise = repairable.map((defect) => ({
    id: defect.id,
    phase: defect.phase,
    cause: defect.cause,
    viewportId: defect.viewportId,
    region: defect.region,
    observed: truncateUtf8(defect.observed, 768),
    expected: truncateUtf8(defect.expected, 768),
    threshold: truncateUtf8(defect.threshold, 384),
    repairInstruction:
      defect.repairInstruction === null ? null : truncateUtf8(defect.repairInstruction, 1_536),
  }));
  const included: (typeof concise)[number][] = [];
  for (const defect of concise) {
    const candidate = [...included, defect];
    if (
      utf8ByteLength(render(candidate, concise.length - candidate.length)) <=
      WRITER_REPAIR_NOTE_MAX_BYTES
    )
      included.push(defect);
  }
  return render(included, concise.length - included.length);
}

function packToPlan(
  pack: GachaPack,
  slots: ReturnType<typeof deriveGachaMediaSlots>,
  contactHidden: boolean,
): CurrentUnifiedPlan {
  return {
    planSchemaVersion: CURRENT_UNIFIED_PLAN_SCHEMA_VERSION,
    operationalIntent: {
      mediaSlots: slots.map((slot) => ({
        slotId: slot.slotId,
        role: slot.role,
        required: slot.required,
        sourcePreference: slot.sourcePreference,
        aspectRatio: slot.aspectRatio,
        cropGuidance: slot.cropGuidance,
        textOverlayAllowed: slot.textOverlayAllowed,
        proofEligibleRequired: slot.proofEligibleRequired,
        ...(slot.generationPrompt ? { generationPrompt: slot.generationPrompt } : {}),
      })),
      operationalAnchors: contactHidden
        ? []
        : [{ slug: "contact", purposes: ["contact", "navigation"] }],
    },
    creativeBrief: {
      rationale: pack.writerGuidance,
      mood: pack.family,
      hierarchy: pack.heroTreatment,
      mediaOpportunities: pack.mediaRecipe.proofStripRequired
        ? "Lead with real project photos when present; atmosphere never impersonates work."
        : "Atmosphere stills only; do not invent project proof.",
      responsiveBehavior: pack.mobile,
    },
  };
}

type FencedBlock = { lang: string; body: string };

function extractFencedBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const re = /```(\w+)?\s*\n([\s\S]*?)```/g;
  for (const match of text.matchAll(re)) {
    blocks.push({ lang: (match[1] ?? "").toLowerCase(), body: (match[2] ?? "").trim() });
  }
  return blocks;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const strippedFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed = tryParseJson(strippedFence);
  const fences = extractFencedBlocks(trimmed);
  const jsonFence = fences.find((block) => block.lang === "json");
  if (!parsed && jsonFence) parsed = tryParseJson(jsonFence.body);
  if (!parsed) {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) parsed = tryParseJson(trimmed.slice(first, last + 1));
  }
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as Record<string, unknown>;
}

/** JSON parse, then fence fallback when themeSource TSX was not valid JSON. */
function parseGeneratedPayload(raw: string): unknown | null {
  const parsed = parseJsonObject(raw);
  const fences = extractFencedBlocks(raw.trim());
  const tsxFence =
    fences.find((block) => ["tsx", "jsx", "typescript", "ts"].includes(block.lang)) ??
    fences.find((block) => block.lang === "");
  if (!parsed) {
    if (tsxFence?.body) return { themeSource: tsxFence.body };
    return null;
  }
  if (typeof parsed.themeSource !== "string" && tsxFence?.body) {
    return { ...parsed, themeSource: tsxFence.body };
  }
  return parsed;
}

function formatCatalogDigest(digest: CatalogDigestEntry[]): string {
  if (digest.length === 0) return "(none)";
  return digest
    .map((entry) => {
      const title = entry.title ? ` — ${entry.title}` : "";
      const lines = [
        `${entry.id}${title} (${entry.category}; ${entry.mood_tags.join(", ") || "no mood tags"})`,
      ];
      if (entry.layoutSketch) lines.push(`sketch: ${entry.layoutSketch}`);
      if (entry.layoutFamily) lines.push(`layoutFamily: ${entry.layoutFamily}`);
      if (entry.upstream) lines.push(`upstream: ${entry.upstream}`);
      if (entry.requires) {
        const bits = Object.entries(entry.requires)
          .filter(([, count]) => typeof count === "number")
          .map(([key, count]) => `${key}≥${count}`);
        if (bits.length > 0) lines.push(`requires: ${bits.join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatProjectedCopy(config: Record<string, unknown>): string {
  const sections = Array.isArray(config.sections)
    ? (config.sections as Array<Record<string, unknown>>)
    : [];
  const services = Array.isArray(config.services)
    ? (config.services as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  return JSON.stringify(
    {
      services,
      sections: sections.map((section) => ({
        type: section.type,
        heading: section.heading,
        body: section.body,
        catalogRef: section.catalogRef,
        entrance: section.entrance,
        stagger: section.stagger,
        hover: section.hover,
      })),
    },
    null,
    2,
  );
}

function projectFromBrief(
  onboarding: Record<string, unknown>,
  enrichment: Record<string, unknown>,
  variantKey: string,
  brief: DesignBrief,
  photoCount: number,
): Record<string, unknown> {
  const base = buildSiteConfigFromState(onboarding, enrichment, variantKey) as unknown as Record<
    string,
    unknown
  >;
  const merged = {
    ...base,
    variantKey,
    heroLayout: heroLayoutFromCatalog({
      catalogRef: brief.sections.find((section) => section.type === "hero")?.catalogRef,
      photoCount,
    }),
    sectionOrder: brief.sections.map((section) => section.type),
    sections: brief.sections.map((section) => ({
      id: section.id,
      type: section.type,
      heading: section.heading,
      body: section.body,
      catalogRef: section.catalogRef,
      entrance: section.entrance,
      stagger: section.stagger,
      hover: section.hover,
      click: section.click,
    })),
    extraReviews: brief.extraReviews ?? base.extraReviews,
    component_ids: catalogRefsFromBrief(brief),
    designBrief: brief,
    persona: brief.persona,
  };
  return projectEnrichmentToSiteConfig(merged, enrichment);
}

async function fulfillAndMergeGeneratedMedia(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  projected: Record<string, unknown>;
  shots: unknown;
  evidenceImages: EvidenceMediaItem[];
  signal?: AbortSignal;
  onProgress?: (message: string) => void | Promise<void>;
  maxStills?: number;
  parallelStills?: boolean;
  stillConcurrency?: number;
  requiredStillCount?: number;
  requiredStillSlotIds?: string[];
  requireVideoSource?: boolean;
  resumeItems?: EvidenceMediaItem[];
  onItemReady?: (item: EvidenceMediaItem, shot: MediaShot) => void | Promise<void>;
  onBeforeGenerate?: (shot: MediaShot) => string | void | Promise<string | void>;
  onItemFailed?: (
    shot: MediaShot,
    reason: string,
    disposition?: "retryable" | "terminal" | "fatal" | "indeterminate",
    operationId?: string,
    effectCertainty?: "not_started" | "definite_failure" | "definite_success" | "indeterminate",
  ) => void | Promise<void>;
  onItemAbandoned?: (shot: MediaShot, reason: string) => void | Promise<void>;
  resumeOperationIds?: ReadonlyMap<string, string>;
  onOperationAccepted?: (shot: MediaShot, operationId: string) => void | Promise<void>;
  maxStillAttempts?: number;
  requireUniqueStills?: boolean;
  deadlineAt?: number;
}): Promise<EvidenceMediaItem[]> {
  const generated = await fulfillMediaShots({
    websiteId: options.websiteId,
    shots: options.shots,
    evidenceImages: options.evidenceImages,
    signal: options.signal,
    onProgress: options.onProgress,
    supabase: options.supabase,
    maxStills: options.maxStills,
    parallelStills: options.parallelStills,
    stillConcurrency: options.stillConcurrency,
    requiredStillCount: options.requiredStillCount,
    requiredStillSlotIds: options.requiredStillSlotIds,
    requireVideoSource: options.requireVideoSource,
    resumeItems: options.resumeItems,
    onItemReady: options.onItemReady,
    onBeforeGenerate: options.onBeforeGenerate,
    onItemFailed: options.onItemFailed,
    onItemAbandoned: options.onItemAbandoned,
    resumeOperationIds: options.resumeOperationIds,
    onOperationAccepted: options.onOperationAccepted,
    maxStillAttempts: options.maxStillAttempts,
    requireUniqueStills: options.requireUniqueStills,
    deadlineAt: options.deadlineAt,
  });
  if (generated.length === 0) return [];
  const existing = Array.isArray(options.projected.mediaGallery)
    ? (options.projected.mediaGallery as EvidenceMediaItem[])
    : [];
  options.projected.mediaGallery = [...existing, ...generated];
  return generated;
}

async function generateUnifiedThemeSource(args: {
  supabase: SupabaseAdmin;
  websiteId: string;
  variantKey: string;
  onboarding: Record<string, unknown>;
  enrichment: Record<string, unknown>;
  factSheet: SiteFactSheet;
  contactHidden: boolean;
  priorVariantSummary?: string;
  onProgress?: (message: string) => void | Promise<void>;
  signal?: AbortSignal;
  jobClaim?: GenerationJobClaim;
  resumeGachaLock?: GachaLock;
  onGachaLockAccepted?: (lock: GachaLock) => void | Promise<void>;
  onStageCheckpoint?: (stage: SiteGenerationCheckpointStage) => void | Promise<void>;
  evidenceMedia?: EvidenceMediaItem[];
  designPreferences: DesignPreferences;
  sourceEvidenceOnly?: boolean;
  creativeDirection?: string;
  gachaId?: string;
  gachaFilter?: string[];
  recentGachaIds?: string[];
  generationKind?: "initial" | "regeneration";
  executionUnit?: "planning" | "media" | "composition";
  writerRepairDefects?: Bucket1Defect[];
  deferStillWait?: boolean;
  stillDeadlineAt?: number;
}): Promise<Record<string, unknown>> {
  const {
    supabase,
    websiteId,
    variantKey,
    onboarding,
    enrichment,
    factSheet,
    contactHidden,
    priorVariantSummary,
    onProgress,
    signal,
    jobClaim,
    resumeGachaLock,
    onGachaLockAccepted,
    onStageCheckpoint,
    evidenceMedia,
    designPreferences,
    sourceEvidenceOnly,
    creativeDirection,
    gachaId,
    gachaFilter,
    recentGachaIds,
    generationKind = "initial",
    executionUnit,
    writerRepairDefects,
    deferStillWait,
    stillDeadlineAt,
  } = args;

  const projectedBase = projectEnrichmentToSiteConfig(
    buildSiteConfigFromState(onboarding, enrichment, variantKey) as unknown as Record<
      string,
      unknown
    >,
    enrichment,
  );
  if (contactHidden) projectedBase.contactHidden = true;
  projectedBase.generator = "unified-site-agent";
  projectedBase.component_ids = [];
  projectedBase.sections = [];
  projectedBase.sectionOrder = [];
  delete projectedBase.designBrief;
  delete projectedBase.designSpec;

  const inventoryFactSheet = buildFactSheet(onboarding, enrichment, {
    imageCap: Number.MAX_SAFE_INTEGER,
  });
  const evidenceInventory = usableEvidenceStills(
    sourceEvidenceOnly
      ? (evidenceMedia ?? [])
      : [...inventoryFactSheet.images, ...(evidenceMedia ?? [])],
  );
  const priorNote = [
    unifiedPriorNote(priorVariantSummary),
    creativeDirection ? `User-requested creative direction: ${creativeDirection}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  await onProgress?.("Picking a look…");

  const packs = allGachaPacks();
  let lockedPack: GachaPack | undefined;
  const scrapeAlready = resumeGachaLock?.scrapeEnqueued === true;
  const enqueueScrapeAndYield = async () => {
    if (scrapeAlready) return;
    let researchStatus: string | null = null;
    if (generationKind === "initial") {
      const { data, error: researchError } = await supabase
        .from("websites")
        .select("research_status")
        .eq("id", websiteId)
        .maybeSingle();
      if (researchError) throw new Error("Unable to inspect research status");
      researchStatus = data?.research_status ?? null;
    }
    if (!gachaMayEnqueuePhotoScrape({ generationKind, researchStatus })) return;
    const { count, error } = await supabase
      .from("background_jobs")
      .select("*", { count: "exact", head: true })
      .eq("website_id", websiteId)
      .eq("job_type", JOB_TYPE_ENRICHMENT)
      .in("status", ["pending", "running", "finalizing"]);
    if (error) throw new Error("Unable to inspect enrichment jobs");
    if ((count ?? 0) === 0) {
      await enqueueEnrichmentChain(
        supabase,
        { kind: "website", websiteId },
        `${websiteId}:enrichment:gacha`,
      );
    }
    await onGachaLockAccepted?.({
      ...(lockedPack
        ? { gachaId: lockedPack.id, gachaVersion: lockedPack.version }
        : resumeGachaLock?.gachaId
          ? { gachaId: resumeGachaLock.gachaId, gachaVersion: resumeGachaLock.gachaVersion }
          : {}),
      evidenceAssetIdBySlot: resumeGachaLock?.evidenceAssetIdBySlot ?? {},
      scrapeEnqueued: true,
    });
    await onStageCheckpoint?.("planning");
    if (executionUnit === "planning")
      throw new Error("Planning unit requires durable checkpoint settlement");
  };
  if (evidenceInventory.length === 0) {
    await enqueueScrapeAndYield();
  }
  lockedPack = resumeGachaLock?.gachaId
    ? gachaById(packs, resumeGachaLock.gachaId, resumeGachaLock.gachaVersion)
    : drawGacha(packs, {
        seed: variantKey,
        evidenceStillCount: evidenceInventory.length,
        lookAndFeel: factSheet.lookAndFeel,
        tags: gachaFilter,
        recentGachaIds,
        requestedId: gachaId,
      });
  if (!lockedPack) throw generationExhausted("unified-design", "gacha pack missing");
  const requiredEvidence = Math.max(
    lockedPack.minEvidenceStills,
    lockedPack.mediaRecipe.proofStripRequired ? 1 : 0,
  );
  if (evidenceInventory.length < requiredEvidence) {
    await enqueueScrapeAndYield();
  }
  if (evidenceInventory.length < requiredEvidence && !gachaId) {
    lockedPack = drawGacha(packs, {
      seed: `${variantKey}:zero-photo`,
      evidenceStillCount: 0,
      lookAndFeel: factSheet.lookAndFeel,
      tags: gachaFilter,
      recentGachaIds,
    });
  }
  const derived = deriveGachaMediaSlots(
    lockedPack,
    {
      trade: factSheet.trade,
      city: factSheet.city,
      businessName: factSheet.businessName,
    },
    evidenceInventory.length,
  );
  const acceptedPlan = packToPlan(lockedPack, derived, contactHidden);
  if (
    contactHidden &&
    acceptedPlan.operationalIntent.operationalAnchors.some((anchor) =>
      anchor.purposes.includes("contact"),
    )
  ) {
    throw generationExhausted("unified-design", "contact-hidden plan declared a contact anchor");
  }

  const identity = (item: EvidenceMediaItem) => item.contentHash ?? item.storagePath;
  const inventoryIds = evidenceInventory.map(identity).filter((id): id is string => Boolean(id));
  const requiredPhotoIds = requiredDesignPreferencePhotoIds(designPreferences);
  const plannedSlots = acceptedPlan.operationalIntent.mediaSlots;
  const resumedEvidenceAssets =
    resumeGachaLock?.gachaId === lockedPack.id ? resumeGachaLock.evidenceAssetIdBySlot : undefined;
  if (designPreferenceForbids(designPreferences, "motion")) {
    // Initial generation is still-only already; retain an explicit guard for the accepted contract.
    if (plannedSlots.some((slot) => slot.role === "motion-poster")) {
      throw new EvidenceInventoryError("no-motion design preference forbids motion-poster slots");
    }
  }
  if (designPreferenceForbids(designPreferences, "media") && plannedSlots.length > 0) {
    throw new EvidenceInventoryError("no-media design preference requires an empty media plan");
  }
  if (
    designPreferenceForbids(designPreferences, "generated-imagery") &&
    plannedSlots.some((slot) => slot.sourcePreference !== "evidence")
  ) {
    throw new EvidenceInventoryError(
      "no-generated-imagery design preference requires evidence-only media slots",
    );
  }
  if (requiredPhotoIds.length > plannedSlots.length) {
    throw new EvidenceInventoryError("required photo constraints exceed planned media slots");
  }
  let evidenceAssetIdBySlot = new Map<string, string>();
  const effectiveSourceBySlot = new Map<string, "evidence" | "generated">();
  const resumedEntries = resumedEvidenceAssets ? Object.entries(resumedEvidenceAssets) : [];
  if (resumedEvidenceAssets !== undefined) {
    if (resumedEntries.some(([, assetId]) => !inventoryIds.includes(assetId)))
      throw new EvidenceInventoryError(
        "Persisted evidence identity is absent from the frozen inventory",
      );
    evidenceAssetIdBySlot = new Map(resumedEntries);
  }

  const usedEvidence = new Set(evidenceAssetIdBySlot.values());
  for (const requiredPhotoId of requiredPhotoIds) {
    if (usedEvidence.has(requiredPhotoId)) continue;
    const slot = plannedSlots.find(
      (candidate) =>
        candidate.sourcePreference !== "generated" && !evidenceAssetIdBySlot.has(candidate.slotId),
    );
    if (!slot) {
      throw new EvidenceInventoryError(
        `Required authorized photo ${requiredPhotoId} has no compatible planned slot`,
      );
    }
    evidenceAssetIdBySlot.set(slot.slotId, requiredPhotoId);
    usedEvidence.add(requiredPhotoId);
  }
  for (const slot of plannedSlots) {
    const persistedEvidence = evidenceAssetIdBySlot.get(slot.slotId);
    let source: "evidence" | "generated";
    if (persistedEvidence) source = "evidence";
    else if (slot.sourcePreference === "evidence") source = "evidence";
    else if (slot.sourcePreference === "generated") source = "generated";
    else source = inventoryIds.some((id) => !usedEvidence.has(id)) ? "evidence" : "generated";
    effectiveSourceBySlot.set(slot.slotId, source);
    if (source === "evidence" && !persistedEvidence) {
      const assetId = inventoryIds.find((id) => !usedEvidence.has(id));
      if (!assetId) {
        if (slot.required)
          throw new EvidenceInventoryError(
            `Required evidence slot ${slot.slotId} is unavailable in the authoritative inventory`,
          );
        if (!designPreferenceForbids(designPreferences, "generated-imagery"))
          effectiveSourceBySlot.set(slot.slotId, "generated");
        continue;
      }
      usedEvidence.add(assetId);
      evidenceAssetIdBySlot.set(slot.slotId, assetId);
    }
  }

  const mediaShots: MediaShot[] = acceptedPlan.operationalIntent.mediaSlots
    .filter((slot) => effectiveSourceBySlot.get(slot.slotId) === "generated")
    .map((slot) => ({
      id: slot.slotId,
      kind: "image" as const,
      role: slot.role === "hero" ? "hero" : "atmosphere",
      prompt: slot.generationPrompt!,
      aspectRatio: slot.aspectRatio,
      cropGuidance: slot.cropGuidance,
    }));
  await onGachaLockAccepted?.({
    gachaId: lockedPack.id,
    gachaVersion: lockedPack.version,
    evidenceAssetIdBySlot: Object.fromEntries(evidenceAssetIdBySlot),
    scrapeEnqueued: resumeGachaLock?.scrapeEnqueued,
  });
  if (!resumeGachaLock?.gachaId) {
    await onStageCheckpoint?.("media");
    if (executionUnit === "planning")
      throw new Error("Planning unit requires durable checkpoint settlement");
  }

  const requiredStillSlotIds = acceptedPlan.operationalIntent.mediaSlots
    .filter((slot) => effectiveSourceBySlot.get(slot.slotId) === "generated" && slot.required)
    .map((slot) => slot.slotId);
  if (jobClaim) {
    await planGenerationMediaSlots({
      supabase,
      websiteId,
      jobClaim,
      slots: [
        ...acceptedPlan.operationalIntent.mediaSlots.map((slot) => ({
          slotId: slot.slotId,
          kind: "image" as const,
          role: slot.role,
          provenance:
            effectiveSourceBySlot.get(slot.slotId) === "generated"
              ? ("generated" as const)
              : ("evidence" as const),
          required: slot.required,
          proofEligible: slot.proofEligibleRequired,
        })),
      ],
    });
  }
  const resumableMedia = jobClaim
    ? await loadReadyGenerationMedia({ supabase, websiteId, jobClaim })
    : [];
  const resumableOperations = jobClaim
    ? await loadResumableGenerationOperations({ supabase, websiteId, jobClaim })
    : new Map<string, string>();
  const mediaDispositions = jobClaim
    ? await loadGenerationMediaDispositions({ supabase, websiteId, jobClaim })
    : new Map<
        string,
        { status: string; required: boolean; effectCertainty: string; providerCreateCount: number }
      >();
  const terminalOptionalSlotIds = new Set(
    [...mediaDispositions]
      .filter(
        ([, item]) =>
          !item.required &&
          (item.status === "abandoned" ||
            (item.status === "failed" &&
              item.effectCertainty !== "indeterminate" &&
              item.providerCreateCount >= 2)),
      )
      .map(([slotId]) => slotId),
  );
  const requiredTerminalFailure = [...mediaDispositions].find(
    ([, item]) =>
      item.required &&
      (item.status === "abandoned" ||
        (item.status === "failed" &&
          item.effectCertainty !== "indeterminate" &&
          item.providerCreateCount >= 2)),
  );
  if (requiredTerminalFailure)
    throw new Error(
      `required slot ${requiredTerminalFailure[0]} exhausted its bounded media budget`,
    );
  const slotById = new Map(
    acceptedPlan.operationalIntent.mediaSlots.map((slot) => [slot.slotId, slot]),
  );
  const readySlotIds = new Set(
    resumableMedia.map((item) => item.generationSlotId).filter((id): id is string => Boolean(id)),
  );
  const reservationBySlot = new Map<string, GenerationMediaCreateReservation>();
  const nextMediaShot = (mediaShots as MediaShot[]).find(
    (shot) => !readySlotIds.has(shot.id) && !terminalOptionalSlotIds.has(shot.id),
  );
  if (deferStillWait && nextMediaShot?.kind === "image") {
    await onStageCheckpoint?.("media");
    if (executionUnit === "media")
      throw new Error("Media unit requires durable checkpoint settlement");
  }
  const generatedMedia = await fulfillAndMergeGeneratedMedia({
    supabase,
    websiteId,
    projected: projectedBase,
    // One claim performs at most one provider unit; ready siblings are replayed.
    shots: nextMediaShot ? [nextMediaShot] : [],
    evidenceImages: evidenceInventory,
    signal,
    onProgress,
    maxStills: MAX_UNIFIED_STILL_SHOTS,
    parallelStills: false,
    stillConcurrency: 1,
    requiredStillSlotIds,
    requireVideoSource: false,
    requireUniqueStills: true,
    // Each provider create is one durable unit; retry after fenced settlement/reclaim.
    maxStillAttempts: 1,
    resumeItems: resumableMedia,
    resumeOperationIds: resumableOperations,
    deadlineAt: stillDeadlineAt,
    onOperationAccepted: jobClaim
      ? async (shot, operationId) => {
          await recordGenerationMediaOperation({
            supabase,
            websiteId,
            jobClaim,
            slotId: shot.id,
            operationId,
            reservationId: reservationBySlot.get(shot.id)!.reservationId,
          });
        }
      : undefined,
    onBeforeGenerate: jobClaim
      ? async (shot) => {
          const planned = shot.kind === "video" ? undefined : slotById.get(shot.id);
          await claimGenerationMediaItem({
            supabase,
            websiteId,
            jobClaim,
            slotId: shot.id,
            kind: shot.kind,
            role: shot.kind === "video" ? "atmosphere" : (planned?.role ?? "atmosphere"),
            required: shot.kind === "video" ? true : (planned?.required ?? true),
            sourceSlotId: shot.kind === "video" ? shot.sourceShotId : undefined,
          });
          const reservation = await reserveGenerationMediaCreate({
            supabase,
            websiteId,
            jobClaim,
            slotId: shot.id,
            provider: shot.kind === "image" ? "lovable-image" : "lovable-video",
            requestHash: createHash("sha256")
              .update(
                JSON.stringify({
                  kind: shot.kind,
                  prompt: shot.prompt,
                  aspectRatio: shot.kind === "image" ? shot.aspectRatio : undefined,
                  cropGuidance: shot.kind === "image" ? shot.cropGuidance : undefined,
                }),
              )
              .digest("hex"),
          });
          if (typeof reservation !== "number") {
            reservationBySlot.set(shot.id, reservation);
            return reservation.idempotencyKey;
          }
          return undefined;
        }
      : undefined,
    onItemAbandoned: jobClaim
      ? async (shot, reason) => {
          await settleGenerationMediaSlot({
            supabase,
            websiteId,
            jobClaim,
            slotId: shot.id,
            status: "abandoned",
            reservationId: reservationBySlot.get(shot.id)?.reservationId,
            errorMessage: reason,
            effectCertainty: "not_started",
          });
        }
      : undefined,
    onItemFailed: jobClaim
      ? async (shot, reason, disposition, operationId, exactEffectCertainty) => {
          await settleGenerationMediaSlot({
            supabase,
            websiteId,
            jobClaim,
            slotId: shot.id,
            status: "failed",
            reservationId: reservationBySlot.get(shot.id)?.reservationId,
            errorMessage: reason,
            effectCertainty:
              exactEffectCertainty ??
              (disposition === "indeterminate"
                ? "indeterminate"
                : disposition === "terminal" && operationId
                  ? "definite_success"
                  : "definite_failure"),
          });
        }
      : undefined,
    onItemReady: jobClaim
      ? async (item, shot) => {
          const planned = shot.kind === "video" ? undefined : slotById.get(shot.id);
          await recordReadyGenerationMediaItem({
            supabase,
            websiteId,
            jobClaim,
            item,
            slotId: shot.id,
            reservation: reservationBySlot.get(shot.id),
            role: shot.kind === "video" ? "atmosphere" : (planned?.role ?? "atmosphere"),
            required: shot.kind === "video" ? true : (planned?.required ?? true),
          });
        }
      : undefined,
  });
  if (nextMediaShot) {
    // A claimed media sub-unit completed. Persist/reclaim before inspecting another slot.
    await onStageCheckpoint?.("media");
    if (executionUnit === "media")
      throw new Error("Media unit requires durable checkpoint settlement");
  }
  const completeGeneratedMedia = [...resumableMedia, ...generatedMedia].filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.generationSlotId === item.generationSlotId) === index,
  );
  const generatedStillCount = new Set(
    completeGeneratedMedia
      .filter(
        (item) => !(item.mimeType ?? "").startsWith("video/") && item.mimeType !== "image/gif",
      )
      .map((item) => item.storagePath),
  ).size;
  const missingRequiredStillIds = requiredStillSlotIds.filter(
    (slotId) =>
      !completeGeneratedMedia.some(
        (item) => item.generationSlotId === slotId && !(item.mimeType ?? "").startsWith("video/"),
      ),
  );
  if (missingRequiredStillIds.length > 0) {
    throw new Error(
      `Unified media generation is missing required still slots [${missingRequiredStillIds.join(", ")}]`,
    );
  }

  const mediaManifest = resolveUnifiedMediaManifest({
    plan: acceptedPlan,
    evidence: evidenceInventory,
    generated: completeGeneratedMedia,
    effectiveSourceBySlot,
    evidenceAssetIdBySlot,
  });
  for (const requiredPhotoId of requiredPhotoIds) {
    if (
      !mediaManifest.slots.some(
        (slot) => slot.assetId === requiredPhotoId && slot.origin === "evidence",
      )
    ) {
      throw new EvidenceInventoryError(
        `Required authorized photo ${requiredPhotoId} is absent from the resolved manifest`,
      );
    }
  }
  if (
    designPreferenceForbids(designPreferences, "generated-imagery") &&
    mediaManifest.slots.some((slot) => slot.origin === "generated")
  ) {
    throw new EvidenceInventoryError(
      "no-generated-imagery design preference was violated by the resolved manifest",
    );
  }
  projectedBase.mediaManifest = mediaManifest;

  if (executionUnit === "media") {
    await onStageCheckpoint?.("composition");
    throw new Error("Media unit requires durable checkpoint settlement");
  }
  await onProgress?.("Writing the page…");

  let jsonText = "";
  try {
    await streamChatCompletion({
      messages: [
        { role: "system", content: UNIFIED_SITE_AGENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: unifiedSiteAgentUserPrompt({
            variantKey,
            contactHidden,
            factSheet,
            priorNote,
            retryNote: writerRepairNote(writerRepairDefects),
            unifiedPlan: acceptedPlan,
            gachaPack: lockedPack,
            mediaManifest,
            designPreferences,
          }),
        },
      ],
      onToken: (text) => {
        jsonText += text;
      },
      signal,
    });
  } catch (error) {
    if (isAbortError(error) || isGenerationStageYield(error)) throw error;
    console.error("[generateUnifiedThemeSource] writer LLM", error);
    throw generationExhausted("unified-code", "writer provider failed");
  }

  const parsed = parseGeneratedPayload(jsonText);
  if (!parsed) throw generationExhausted("unified-code", "themeSource JSON parse failed");
  const validated = themeSourceSchema.safeParse(parsed);
  if (!validated.success) throw generationExhausted("unified-code", "themeSource missing");
  const themeSource = validated.data.themeSource.trim();
  if (
    designPreferenceForbids(designPreferences, "motion") &&
    /\bmotion\s*=|@keyframes|\banimation(?:Name|Duration|TimingFunction)?\s*:|\btransition(?:Property|Duration|TimingFunction)?\s*:|\b(?:animate|transition)-[a-z0-9[\]-]+/iu.test(
      themeSource,
    )
  ) {
    throw generationExhausted("unified-code", "no-motion design preference was violated");
  }
  return {
    ...projectedBase,
    themeSource,
    generator: "unified-site-agent",
    generatorSchemaVersion: 4,
    gacha: { id: lockedPack.id, version: lockedPack.version },
    mediaManifest,
  };
}

export type FrozenGenerationContext = {
  onboarding: Record<string, unknown>;
  enrichment: Record<string, unknown>;
  evidenceMedia: EvidenceMediaItem[];
  contactHidden: boolean;
  priorVariantSummary?: string;
  creativeDirection?: string;
  designPreferences: DesignPreferences;
  gachaId?: string;
  gachaFilter?: string[];
  recentGachaIds?: string[];
  generationKind: "initial" | "regeneration";
};

/** New writes are Unified-only. Background jobs must provide their acceptance-time frozen context. */
export async function generateWebsiteContentForVariant(
  supabase: SupabaseAdmin,
  websiteId: string,
  variantKey: string,
  options?: {
    priorVariantSummary?: string;
    onProgress?: (message: string) => void | Promise<void>;
    signal?: AbortSignal;
    generationMode?: GenerationMode;
    jobClaim?: GenerationJobClaim;
    resumeGachaLock?: GachaLock;
    onGachaLockAccepted?: (lock: GachaLock) => void | Promise<void>;
    onStageCheckpoint?: (stage: SiteGenerationCheckpointStage) => void | Promise<void>;
    evidenceMedia?: EvidenceMediaItem[];
    sourceEvidenceOnly?: boolean;
    creativeDirection?: string;
    frozenContext?: FrozenGenerationContext;
    executionUnit?: "planning" | "media" | "composition";
    writerRepairDefects?: Bucket1Defect[];
    deferStillWait?: boolean;
    stillDeadlineAt?: number;
  },
): Promise<Record<string, unknown>> {
  const generationMode = options?.generationMode ?? (await resolveGenerationMode(supabase));
  assertGenerationModeWriteEnabled(generationMode);

  let onboarding: Record<string, unknown>;
  let enrichment: Record<string, unknown>;
  let frozenEvidence: EvidenceMediaItem[];
  let contactHidden: boolean;
  if (options?.frozenContext) {
    onboarding = options.frozenContext.onboarding;
    enrichment = options.frozenContext.enrichment;
    frozenEvidence = options.frozenContext.evidenceMedia;
    contactHidden = options.frozenContext.contactHidden;
  } else {
    if (options?.jobClaim)
      throw new Error("Server-owned generation requires an acceptance-time frozen context");
    const { data: website, error: websiteError } = await supabase
      .from("websites")
      .select("onboarding_state")
      .eq("id", websiteId)
      .single();
    if (websiteError || !website) throw new Error("Website not found");
    const { data: contractor, error: contractorError } = await supabase
      .from("contractor_profiles")
      .select("enrichment_json")
      .eq("website_id", websiteId)
      .maybeSingle();
    if (contractorError) throw new Error("Unable to load enrichment");
    onboarding = (website.onboarding_state as Record<string, unknown>) ?? {};
    enrichment = (contractor?.enrichment_json as Record<string, unknown>) ?? {};
    frozenEvidence = options?.evidenceMedia ?? [];
    contactHidden = onboarding.contactHidden === true;
  }

  const factSheet = buildFactSheet(onboarding, enrichment);
  const inventoryFactSheet = buildFactSheet(onboarding, enrichment, {
    imageCap: Number.MAX_SAFE_INTEGER,
  });
  const evidenceInventory = usableEvidenceStills(
    options?.sourceEvidenceOnly
      ? frozenEvidence
      : [...inventoryFactSheet.images, ...frozenEvidence],
  );

  const effectivePriorVariantSummary = options?.frozenContext
    ? options.frozenContext.priorVariantSummary
    : options?.priorVariantSummary;
  const effectiveCreativeDirection = options?.frozenContext
    ? options.frozenContext.creativeDirection
    : options?.creativeDirection;

  if (generationMode === "unified") {
    return generateUnifiedThemeSource({
      supabase,
      websiteId,
      variantKey,
      onboarding,
      enrichment,
      factSheet,
      contactHidden,
      priorVariantSummary: effectivePriorVariantSummary,
      onProgress: options?.onProgress,
      signal: options?.signal,
      jobClaim: options?.jobClaim,
      resumeGachaLock: options?.resumeGachaLock,
      onGachaLockAccepted: options?.onGachaLockAccepted,
      onStageCheckpoint: options?.onStageCheckpoint,
      evidenceMedia: evidenceInventory,
      designPreferences:
        options?.frozenContext?.designPreferences ??
        (() => {
          throw new Error("Unified generation requires normalized designPreferences");
        })(),
      sourceEvidenceOnly: true,
      creativeDirection: effectiveCreativeDirection,
      gachaId: options?.frozenContext?.gachaId,
      gachaFilter: options?.frozenContext?.gachaFilter,
      recentGachaIds: options?.frozenContext?.recentGachaIds,
      generationKind: options?.frozenContext?.generationKind,
      executionUnit: options?.executionUnit,
      writerRepairDefects: options?.writerRepairDefects,
      deferStillWait: options?.deferStillWait,
      stillDeadlineAt: options?.stillDeadlineAt,
    });
  }

  throw new Error("Legacy generation modes are read-only");
}
