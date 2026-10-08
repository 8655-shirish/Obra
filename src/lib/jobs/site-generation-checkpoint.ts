import { createHash } from "node:crypto";

import type { Json } from "@/integrations/supabase/types";
import { GACHA_PACK_VERSION, type GachaLock } from "@/lib/agent/gacha";
import type { EvidenceMediaItem } from "@/lib/site-evidence";
import {
  parseDesignPreferences,
  type DesignPreferences,
} from "@/lib/agent/design-preferences.server";
import { parseMediaManifest, type ResolvedMediaManifest } from "@/lib/site-theme/media-manifest";
import { bucket1CandidateConfigHash } from "@/lib/site-validation/bucket1-validation.server";
import {
  BUCKET1_ATTESTATION_SCHEMA_VERSION,
  BUCKET1_RUNTIME_CHECK_IDS,
  BUCKET1_VALIDATION_LIMITS,
  SHA256_HEX,
  type Bucket1Defect,
  type Bucket1ValidationAttestation,
} from "@/lib/site-validation/bucket1-contract";
import {
  INVALID_GENERATION_CHECKPOINT_PREFIX,
  type SiteGenerationCheckpointStage,
} from "./generation-stage";

export const SITE_GENERATION_CHECKPOINT_SCHEMA_VERSION = 2 as const;
const SITE_GENERATION_CANDIDATE_CONFIG_MAX_BYTES = 512 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_ROLES = new Set(["hero", "proof", "support", "atmosphere", "texture", "motion-poster"]);
const STAGES: readonly SiteGenerationCheckpointStage[] = [
  "context",
  "planning",
  "media",
  "composition",
  "validation",
  "persistence",
];
const CHECKPOINT_KEYS = [
  "schemaVersion",
  "stage",
  "acceptedAt",
  "inputHash",
  "inputSizeBytes",
  "input",
  "variantKey",
  "designPreferences",
  "gachaLock",
  "scrapeEnqueued",
  "effectiveSourceBySlot",
  "mediaManifest",
  "candidateConfig",
  "candidateSourceHash",
  "candidateRevision",
  "defects",
  "validationAttestation",
  "resultVersionId",
] as const;
const INPUT_KEYS = [
  "schemaVersion",
  "normalizerVersion",
  "generationKind",
  "sourceVersionId",
  "sourceRevision",
  "sourceConfig",
  "sourceMedia",
  "onboarding",
  "enrichment",
  "contactPolicy",
  "instruction",
  "instructionByteLength",
  "requestPayloadHash",
  "priorIdentities",
  "crossSiteLayoutIdentities",
] as const;
const CONTACT_POLICY_KEYS = [
  "schemaVersion",
  "source",
  "sourcePresent",
  "sourceValue",
  "contactHidden",
  "privacyClassification",
  "privacySource",
  "capturedAtAcceptance",
] as const;
const SOURCE_MEDIA_KEYS = [
  "slotId",
  "assetId",
  "mimeType",
  "role",
  "origin",
  "required",
  "proofEligible",
  "storagePath",
  "sourceSlotId",
  "posterSlotId",
] as const;
const GACHA_LOCK_KEYS = ["gachaId", "gachaVersion", "evidenceAssetIdBySlot", "scrapeEnqueued"] as const;
const DEFECT_KEYS = [
  "defectVersion",
  "id",
  "phase",
  "cause",
  "classification",
  "severity",
  "disposition",
  "viewportId",
  "region",
  "observed",
  "expected",
  "threshold",
  "repairInstruction",
] as const;
const REGION_KEYS = ["kind", "id"] as const;
const ATTESTATION_KEYS = [
  "schemaVersion",
  "kind",
  "binding",
  "runtimeEvidenceHash",
  "issuedAt",
  "expiresAt",
  "issuerKeyId",
  "attestationHash",
  "signature",
] as const;
const BINDING_KEYS = [
  "generationContractEpoch",
  "contextHash",
  "candidateRevision",
  "candidateConfigHash",
  "sourceHash",
  "compilePolicyHash",
  "manifestHash",
  "attachmentHash",
  "operationalPlanHash",
  "hostPropsHash",
  "resourceSetHash",
  "hostContractHash",
  "validationContractHash",
  "candidateBindingHash",
] as const;
const DEFECT_PHASES = new Set(["static", "runtime", "attestation"]);
const DEFECT_CAUSES = new Set([
  "source_contract",
  "manifest_contract",
  "operational_plan_contract",
  "host_props_contract",
  "attachment_contract",
  "resource_contract",
  "static_compile",
  ...BUCKET1_RUNTIME_CHECK_IDS,
  "browser_launch",
  "browser_unavailable",
  "runtime_ready_timeout",
  "resource_timeout",
  "font_timeout",
  "image_timeout",
  "host_injection",
  "validator_timeout",
  "validator_crash",
  "runtime_evidence_contract",
  "attestation_contract",
  "attestation_expired",
  "attestation_binding_mismatch",
]);
const DEFECT_CLASSIFICATIONS = new Set(["candidate", "infrastructure"]);
const DEFECT_DISPOSITIONS = new Set([
  "writer_repair",
  "infrastructure_retry",
  "reject_attestation",
]);
const REGION_KINDS = new Set([
  "source",
  "document",
  "selector",
  "site-section",
  "media-slot",
  "lead-slot",
  "contract",
]);
const IDENTITY_ARRAY_MAX_ITEMS = 64;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 50_000;

export type FrozenSourceMediaRow = {
  slotId: string;
  assetId: string;
  mimeType: string;
  role: string;
  origin: "evidence" | "generated";
  required: boolean;
  proofEligible: boolean;
  storagePath: string;
  width?: number;
  height?: number;
  sourceSlotId: string | null;
  posterSlotId: string | null;
};

export type FrozenSiteGenerationInput = {
  schemaVersion: 1;
  normalizerVersion: "bucket1-context-v1";
  generationKind: "initial" | "regeneration";
  sourceVersionId: string | null;
  sourceRevision: number | null;
  sourceConfig: Record<string, unknown> | null;
  sourceMedia: FrozenSourceMediaRow[];
  onboarding: Record<string, unknown>;
  enrichment: Record<string, unknown>;
  contactPolicy: {
    schemaVersion: 1;
    source: "websites.onboarding_state.contactHidden";
    sourcePresent: boolean;
    sourceValue: boolean | null;
    contactHidden: boolean;
    privacyClassification: "generation-private";
    privacySource: "server-generation-storage-policy-v1";
    capturedAtAcceptance: true;
  };
  instruction: string;
  instructionByteLength: number;
  requestPayloadHash: string;
  priorIdentities: Array<Record<string, unknown>>;
  crossSiteLayoutIdentities: Array<Record<string, unknown>>;
};

export type SiteGenerationCheckpoint = {
  schemaVersion: 2;
  stage: SiteGenerationCheckpointStage;
  acceptedAt: string;
  inputHash: string;
  inputSizeBytes: number;
  input: FrozenSiteGenerationInput;
  variantKey?: string;
  designPreferences?: DesignPreferences;
  gachaLock?: GachaLock;
  scrapeEnqueued?: boolean;
  effectiveSourceBySlot?: Record<string, "evidence" | "generated">;
  mediaManifest?: ResolvedMediaManifest;
  candidateConfig?: Record<string, unknown>;
  candidateSourceHash?: string;
  candidateRevision?: number;
  defects?: Bucket1Defect[];
  validationAttestation?: Bucket1ValidationAttestation;
  resultVersionId?: string;
};

export type ParseSiteGenerationCheckpointOptions = {
  expectedGenerationInputSnapshot?: unknown;
  expectedGenerationInputHash?: string;
};

function invalid(detail: string): never {
  throw new Error(`${INVALID_GENERATION_CHECKPOINT_PREFIX} ${detail}`);
}

function objectValue(value: unknown, detail: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(detail);
  const result = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(result);
  if (prototype !== Object.prototype && prototype !== null) invalid(detail);
  if (
    Object.values(Object.getOwnPropertyDescriptors(result)).some(
      (descriptor) => typeof descriptor.get === "function" || typeof descriptor.set === "function",
    )
  )
    invalid(detail);
  return result;
}

function allowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  detail: string,
): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) invalid(detail);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  detail: string,
): void {
  allowedKeys(value, expected, detail);
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value)))
    invalid(detail);
}

function boundedString(value: unknown, detail: string, maxBytes = 16 * 1024): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes)
    invalid(detail);
  return value;
}

function hashValue(value: unknown, detail: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) invalid(detail);
  return value;
}

function integer(value: unknown, min: number, max: number, detail: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    invalid(detail);
  return value as number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timestamp(value: unknown, detail: string): string {
  const result = boundedString(value, detail, 128);
  if (!Number.isFinite(Date.parse(result))) invalid(detail);
  return result;
}

/** PostgreSQL jsonb::text for the bounded JSON subset this parser accepts. */
export function postgresJsonbText(value: unknown): string {
  const seen = new Set<object>();
  let nodes = 0;
  const walk = (current: unknown, depth: number): string => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) invalid("JSON traversal limits");
    if (current === null || typeof current === "boolean") return JSON.stringify(current);
    if (typeof current === "string") {
      if (/\u0000|[\ud800-\udfff]/u.test(current))
        invalid("JSON string is not representable by PostgreSQL jsonb");
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) invalid("JSON number");
      const text = JSON.stringify(current);
      if (!text || /[eE]/.test(text)) invalid("JSON number cannot be canonicalized exactly");
      return text;
    }
    if (Array.isArray(current)) {
      if (seen.has(current) || Object.keys(current).length !== current.length)
        invalid("cyclic or sparse JSON array");
      seen.add(current);
      const text = `[${current.map((entry) => walk(entry, depth + 1)).join(", ")}]`;
      seen.delete(current);
      return text;
    }
    if (typeof current === "object") {
      const object = objectValue(current, "JSON object");
      if (seen.has(object)) invalid("cyclic JSON object");
      seen.add(object);
      const keys = Object.keys(object).sort((left, right) => {
        const leftBytes = Buffer.from(left, "utf8");
        const rightBytes = Buffer.from(right, "utf8");
        return leftBytes.length - rightBytes.length || Buffer.compare(leftBytes, rightBytes);
      });
      const text = `{${keys
        .map((key) => `${JSON.stringify(key)}: ${walk(object[key], depth + 1)}`)
        .join(", ")}}`;
      seen.delete(object);
      return text;
    }
    invalid("unsupported JSON value");
  };
  return walk(value, 0);
}

export const POSTGRES_JSONB_TEXT_FIXTURES: ReadonlyArray<readonly [unknown, string]> = [
  [{ b: 2, aa: 3, a: 1 }, '{"a": 1, "b": 2, "aa": 3}'],
  [
    { nested: [true, null, { quote: 'a"b', slash: "a\\b", control: "a\nb" }] },
    '{"nested": [true, null, {"quote": "a\\"b", "slash": "a\\\\b", "control": "a\\nb"}]}',
  ],
  [{ é: 1, z: 2, aa: 3 }, '{"z": 2, "aa": 3, "é": 1}'],
];

export function verifyPostgresJsonbTextFixtures(): void {
  for (const [input, expected] of POSTGRES_JSONB_TEXT_FIXTURES) {
    if (postgresJsonbText(input) !== expected) invalid("PostgreSQL jsonb canonicalization fixture");
  }
}

function nullableSlot(value: unknown, detail: string): string | undefined {
  if (value === null) return undefined;
  return boundedString(value, detail, 256);
}

function parseSourceMedia(value: unknown): FrozenSourceMediaRow[] {
  if (!Array.isArray(value) || value.length > 256) invalid("sourceMedia array");
  const slotIds = new Set<string>();
  return value.map((entry, index) => {
    const row = objectValue(entry, `sourceMedia[${index}]`);
    exactKeys(row, SOURCE_MEDIA_KEYS, `sourceMedia[${index}] fields`);
    const generationSlotId = boundedString(row.slotId, `sourceMedia[${index}].slotId`, 256);
    if (slotIds.has(generationSlotId)) invalid("duplicate sourceMedia slotId");
    slotIds.add(generationSlotId);
    const contentHash = hashValue(row.assetId, `sourceMedia[${index}].assetId`);
    const mimeType = boundedString(
      row.mimeType,
      `sourceMedia[${index}].mimeType`,
      256,
    ).toLowerCase();
    const storagePath = boundedString(row.storagePath, `sourceMedia[${index}].storagePath`, 2048);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(storagePath)) invalid("sourceMedia storagePath URL");
    if (!MEDIA_ROLES.has(row.role as string)) invalid(`sourceMedia[${index}].role`);
    if (row.origin !== "evidence" && row.origin !== "generated")
      invalid(`sourceMedia[${index}].origin`);
    if (typeof row.required !== "boolean" || typeof row.proofEligible !== "boolean")
      invalid(`sourceMedia[${index}] booleans`);
    if (row.role === "proof" && (row.origin !== "evidence" || row.proofEligible !== true))
      invalid(`sourceMedia[${index}] proof metadata`);
    const sourceSlotId = nullableSlot(row.sourceSlotId, "sourceSlotId") ?? null;
    const posterSlotId = nullableSlot(row.posterSlotId, "posterSlotId") ?? null;
    return {
      slotId: generationSlotId,
      assetId: contentHash,
      mimeType,
      role: row.role as string,
      origin: row.origin,
      required: row.required,
      proofEligible: row.proofEligible,
      storagePath,
      sourceSlotId,
      posterSlotId,
    };
  });
}

function identityArray(value: unknown, detail: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > IDENTITY_ARRAY_MAX_ITEMS) invalid(detail);
  return value.map((entry, index) => objectValue(entry, `${detail}[${index}]`));
}

function parseContactPolicy(value: unknown): FrozenSiteGenerationInput["contactPolicy"] {
  const policy = objectValue(value, "contactPolicy");
  exactKeys(policy, CONTACT_POLICY_KEYS, "contactPolicy fields");
  if (
    policy.schemaVersion !== 1 ||
    policy.source !== "websites.onboarding_state.contactHidden" ||
    typeof policy.sourcePresent !== "boolean" ||
    !(policy.sourceValue === null || typeof policy.sourceValue === "boolean") ||
    policy.sourcePresent !== (policy.sourceValue !== null) ||
    typeof policy.contactHidden !== "boolean" ||
    policy.contactHidden !== (policy.sourceValue === true) ||
    policy.privacyClassification !== "generation-private" ||
    policy.privacySource !== "server-generation-storage-policy-v1" ||
    policy.capturedAtAcceptance !== true
  )
    invalid("contactPolicy contract");
  return {
    schemaVersion: 1,
    source: "websites.onboarding_state.contactHidden",
    sourcePresent: policy.sourcePresent,
    sourceValue: policy.sourceValue,
    contactHidden: policy.contactHidden,
    privacyClassification: "generation-private",
    privacySource: "server-generation-storage-policy-v1",
    capturedAtAcceptance: true,
  };
}

function parseInput(value: unknown): FrozenSiteGenerationInput {
  const input = objectValue(value, "input");
  exactKeys(input, INPUT_KEYS, "input fields");
  if (input.schemaVersion !== 1 || input.normalizerVersion !== "bucket1-context-v1")
    invalid("input version");
  if (input.generationKind !== "initial" && input.generationKind !== "regeneration")
    invalid("generationKind");
  const sourceVersionId =
    input.sourceVersionId === null
      ? null
      : boundedString(input.sourceVersionId, "sourceVersionId", 128);
  const sourceRevision =
    input.sourceRevision === null
      ? null
      : integer(input.sourceRevision, 0, Number.MAX_SAFE_INTEGER, "sourceRevision");
  const sourceConfig =
    input.sourceConfig === null ? null : objectValue(input.sourceConfig, "sourceConfig");
  if (
    input.generationKind === "initial" &&
    (sourceVersionId !== null || sourceRevision !== null || sourceConfig !== null)
  )
    invalid("initial source identity must be null");
  if (
    input.generationKind === "regeneration" &&
    (!sourceVersionId ||
      !UUID.test(sourceVersionId) ||
      sourceRevision === null ||
      sourceConfig === null)
  )
    invalid("regeneration source identity");
  if (typeof input.instruction !== "string") invalid("instruction");
  const instructionBytes = Buffer.byteLength(input.instruction, "utf8");
  const instructionByteLength = integer(
    input.instructionByteLength,
    0,
    Number.MAX_SAFE_INTEGER,
    "instructionByteLength",
  );
  if (instructionByteLength !== instructionBytes) invalid("instructionByteLength mismatch");
  const sourceMedia = parseSourceMedia(input.sourceMedia);
  return {
    schemaVersion: 1,
    normalizerVersion: "bucket1-context-v1",
    generationKind: input.generationKind,
    sourceVersionId,
    sourceRevision,
    sourceConfig,
    sourceMedia,
    onboarding: objectValue(input.onboarding, "onboarding"),
    enrichment: objectValue(input.enrichment, "enrichment"),
    contactPolicy: parseContactPolicy(input.contactPolicy),
    instruction: input.instruction,
    instructionByteLength,
    requestPayloadHash: hashValue(input.requestPayloadHash, "requestPayloadHash"),
    priorIdentities: identityArray(input.priorIdentities, "priorIdentities"),
    crossSiteLayoutIdentities: identityArray(
      input.crossSiteLayoutIdentities,
      "crossSiteLayoutIdentities",
    ),
  };
}

function parseEvidenceAssetIdBySlot(value: unknown): Record<string, string> {
  const entries = objectValue(value, "gachaLock evidenceAssetIdBySlot");
  if (Object.keys(entries).length > 64) invalid("gachaLock evidenceAssetIdBySlot size");
  return Object.fromEntries(
    Object.entries(entries).map(([slotId, assetId]) => {
      if (!slotId.trim() || Buffer.byteLength(slotId, "utf8") > 256) invalid("gachaLock slotId");
      return [slotId, hashValue(assetId, "gachaLock assetId")];
    }),
  );
}

function parseGachaLock(value: unknown): GachaLock {
  const lock = objectValue(value, "gachaLock");
  allowedKeys(lock, GACHA_LOCK_KEYS, "gachaLock fields");
  if (!("evidenceAssetIdBySlot" in lock)) invalid("gachaLock evidenceAssetIdBySlot");
  const evidenceAssetIdBySlot = parseEvidenceAssetIdBySlot(lock.evidenceAssetIdBySlot);
  if (lock.scrapeEnqueued !== undefined && typeof lock.scrapeEnqueued !== "boolean")
    invalid("gachaLock scrapeEnqueued");
  const scrapeEnqueued = lock.scrapeEnqueued === true ? true : undefined;
  if (lock.gachaId !== undefined) {
    const gachaId = boundedString(lock.gachaId, "gachaLock gachaId", 64);
    if (lock.gachaVersion !== GACHA_PACK_VERSION) invalid("gachaLock gachaVersion");
    return {
      gachaId,
      gachaVersion: GACHA_PACK_VERSION,
      evidenceAssetIdBySlot,
      ...(scrapeEnqueued ? { scrapeEnqueued: true } : {}),
    };
  }
  if (lock.gachaVersion !== undefined) invalid("gachaLock gachaVersion");
  return {
    evidenceAssetIdBySlot,
    ...(scrapeEnqueued ? { scrapeEnqueued: true } : {}),
  };
}

function parseEffectiveSources(value: unknown): Record<string, "evidence" | "generated"> {
  const sources = objectValue(value, "effectiveSourceBySlot");
  if (Object.keys(sources).length > 64) invalid("effectiveSourceBySlot size");
  return Object.fromEntries(
    Object.entries(sources).map(([slotId, origin]) => {
      if (!slotId.trim() || Buffer.byteLength(slotId, "utf8") > 256)
        invalid("effectiveSourceBySlot key");
      if (origin !== "evidence" && origin !== "generated") invalid("effectiveSourceBySlot origin");
      return [slotId, origin];
    }),
  );
}

function parseCandidate(value: unknown): Record<string, unknown> {
  const config = objectValue(value, "candidateConfig");
  if (config.generatorSchemaVersion !== 4) invalid("candidate generatorSchemaVersion");
  boundedString(config.themeSource, "candidate themeSource", 512 * 1024);
  const manifest = parseMediaManifest(4, config.mediaManifest);
  if (!manifest.ok) invalid(`candidate mediaManifest: ${manifest.error}`);
  if (
    Buffer.byteLength(postgresJsonbText(config), "utf8") >
    SITE_GENERATION_CANDIDATE_CONFIG_MAX_BYTES
  )
    invalid("candidateConfig exceeds 512 KiB");
  return config;
}

function detailString(value: unknown, detail: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  return boundedString(value, detail, BUCKET1_VALIDATION_LIMITS.runtimeDetailBytes);
}

function parseDefects(value: unknown): Bucket1Defect[] {
  if (!Array.isArray(value) || value.length > BUCKET1_VALIDATION_LIMITS.runtimeDefectCount)
    invalid("defects array");
  return value.map((entry, index) => {
    const defect = objectValue(entry, `defects[${index}]`);
    exactKeys(defect, DEFECT_KEYS, `defects[${index}] fields`);
    const region = objectValue(defect.region, `defects[${index}].region`);
    exactKeys(region, REGION_KEYS, `defects[${index}].region fields`);
    if (
      defect.defectVersion !== 1 ||
      !DEFECT_PHASES.has(defect.phase as string) ||
      !DEFECT_CAUSES.has(defect.cause as string) ||
      !DEFECT_CLASSIFICATIONS.has(defect.classification as string) ||
      defect.severity !== "blocking" ||
      !DEFECT_DISPOSITIONS.has(defect.disposition as string) ||
      !(defect.viewportId === null || typeof defect.viewportId === "string") ||
      !REGION_KINDS.has(region.kind as string)
    )
      invalid(`defects[${index}] contract`);
    if (
      (defect.classification === "infrastructure") !==
      (defect.disposition === "infrastructure_retry")
    )
      invalid(`defects[${index}] disposition`);
    return {
      defectVersion: 1,
      id: boundedString(defect.id, "defect id", 256),
      phase: defect.phase,
      cause: defect.cause,
      classification: defect.classification,
      severity: "blocking",
      disposition: defect.disposition,
      viewportId:
        defect.viewportId === null
          ? null
          : boundedString(defect.viewportId, "defect viewportId", 256),
      region: {
        kind: region.kind,
        id: boundedString(region.id, "defect region id", 256),
      },
      observed: detailString(defect.observed, "defect observed")!,
      expected: detailString(defect.expected, "defect expected")!,
      threshold: detailString(defect.threshold, "defect threshold")!,
      repairInstruction: detailString(defect.repairInstruction, "defect repairInstruction", true),
    } as Bucket1Defect;
  });
}

function parseAttestation(value: unknown): Bucket1ValidationAttestation {
  const envelope = objectValue(value, "validationAttestation");
  exactKeys(envelope, ATTESTATION_KEYS, "validationAttestation fields");
  const binding = objectValue(envelope.binding, "validationAttestation.binding");
  exactKeys(binding, BINDING_KEYS, "validationAttestation.binding fields");
  if (
    envelope.schemaVersion !== BUCKET1_ATTESTATION_SCHEMA_VERSION ||
    envelope.kind !== "bucket1-validation-attestation" ||
    binding.generationContractEpoch !== 2
  )
    invalid("validationAttestation contract");
  const issuedAt = timestamp(envelope.issuedAt, "validationAttestation.issuedAt");
  const expiresAt = timestamp(envelope.expiresAt, "validationAttestation.expiresAt");
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  if (expires <= issued || expires - issued > BUCKET1_VALIDATION_LIMITS.attestationTtlMs)
    invalid("validationAttestation time window");
  const parsedBinding: Bucket1ValidationAttestation["binding"] = {
    generationContractEpoch: 2,
    contextHash: hashValue(binding.contextHash, "attestation contextHash"),
    candidateRevision: boundedString(
      binding.candidateRevision,
      "attestation candidateRevision",
      128,
    ),
    candidateConfigHash: hashValue(binding.candidateConfigHash, "attestation candidateConfigHash"),
    sourceHash: hashValue(binding.sourceHash, "attestation sourceHash"),
    compilePolicyHash: hashValue(binding.compilePolicyHash, "attestation compilePolicyHash"),
    manifestHash: hashValue(binding.manifestHash, "attestation manifestHash"),
    attachmentHash: hashValue(binding.attachmentHash, "attestation attachmentHash"),
    operationalPlanHash: hashValue(binding.operationalPlanHash, "attestation operationalPlanHash"),
    hostPropsHash: hashValue(binding.hostPropsHash, "attestation hostPropsHash"),
    resourceSetHash: hashValue(binding.resourceSetHash, "attestation resourceSetHash"),
    hostContractHash: hashValue(binding.hostContractHash, "attestation hostContractHash"),
    validationContractHash: hashValue(
      binding.validationContractHash,
      "attestation validationContractHash",
    ),
    candidateBindingHash: hashValue(
      binding.candidateBindingHash,
      "attestation candidateBindingHash",
    ),
  };
  return {
    schemaVersion: 1,
    kind: "bucket1-validation-attestation",
    binding: parsedBinding,
    runtimeEvidenceHash: hashValue(envelope.runtimeEvidenceHash, "attestation runtimeEvidenceHash"),
    issuedAt,
    expiresAt,
    issuerKeyId: boundedString(envelope.issuerKeyId, "attestation issuerKeyId", 128),
    attestationHash: hashValue(envelope.attestationHash, "attestation hash"),
    signature: hashValue(envelope.signature, "attestation signature"),
  };
}

function validateStage(checkpoint: SiteGenerationCheckpoint): void {
  if (checkpoint.stage === "context" && checkpoint.variantKey !== undefined)
    invalid("context variantKey");
  if (checkpoint.stage !== "context" && !checkpoint.variantKey) invalid("stage variantKey");
  if (checkpoint.stage === "context" && checkpoint.designPreferences !== undefined)
    invalid("context designPreferences");
  if (checkpoint.stage !== "context" && !checkpoint.designPreferences)
    invalid("stage designPreferences");
  if (checkpoint.scrapeEnqueued !== undefined && checkpoint.scrapeEnqueued !== true)
    invalid("scrapeEnqueued");
  const postPlan = ["media", "composition", "validation", "persistence"].includes(checkpoint.stage);
  if (postPlan && !checkpoint.gachaLock?.gachaId) invalid("stage gachaLock");
  const candidateStage = checkpoint.stage === "validation" || checkpoint.stage === "persistence";
  const hasAllCandidateFields = Boolean(
    checkpoint.candidateConfig &&
    checkpoint.candidateSourceHash &&
    checkpoint.candidateRevision !== undefined,
  );
  if (candidateStage !== hasAllCandidateFields) invalid("stage candidate fields");
  if (candidateStage) {
    const source = checkpoint.candidateConfig!.themeSource;
    if (typeof source !== "string" || sha256(source) !== checkpoint.candidateSourceHash)
      invalid("candidate source hash mismatch");
    const manifest = parseMediaManifest(4, checkpoint.candidateConfig!.mediaManifest);
    if (!manifest.ok) invalid("candidate mediaManifest");
    if (
      checkpoint.mediaManifest &&
      postgresJsonbText(checkpoint.mediaManifest) !== postgresJsonbText(manifest.manifest)
    )
      invalid("mediaManifest mismatch");
  }
  if (checkpoint.validationAttestation) {
    if (!candidateStage || checkpoint.defects?.length) invalid("attestation with defects");
    const binding = checkpoint.validationAttestation.binding;
    if (
      binding.contextHash !== checkpoint.inputHash ||
      binding.sourceHash !== checkpoint.candidateSourceHash ||
      binding.candidateRevision !== String(checkpoint.candidateRevision) ||
      binding.candidateConfigHash !== bucket1CandidateConfigHash(checkpoint.candidateConfig!)
    )
      invalid("attestation candidate binding");
  }
  if (checkpoint.resultVersionId !== undefined && checkpoint.stage !== "persistence")
    invalid("resultVersionId before persistence");
}

export function parseSiteGenerationCheckpoint(
  value: unknown,
  options: ParseSiteGenerationCheckpointOptions = {},
): SiteGenerationCheckpoint {
  const raw = objectValue(value, "checkpoint object");
  allowedKeys(raw, CHECKPOINT_KEYS, "checkpoint fields");
  for (const key of [
    "schemaVersion",
    "stage",
    "acceptedAt",
    "inputHash",
    "inputSizeBytes",
    "input",
  ])
    if (!(key in raw)) invalid(`missing ${key}`);
  if (raw.schemaVersion !== SITE_GENERATION_CHECKPOINT_SCHEMA_VERSION) invalid("schemaVersion");
  if (!STAGES.includes(raw.stage as SiteGenerationCheckpointStage)) invalid("stage");

  const rawInput = objectValue(raw.input, "input");
  const canonicalInput = postgresJsonbText(rawInput);
  const canonicalBytes = Buffer.byteLength(canonicalInput, "utf8");
  const inputHash = hashValue(raw.inputHash, "inputHash");
  if (sha256(canonicalInput) !== inputHash) invalid("inputHash mismatch");
  const inputSizeBytes = integer(raw.inputSizeBytes, 0, Number.MAX_SAFE_INTEGER, "inputSizeBytes");
  if (inputSizeBytes !== canonicalBytes) invalid("inputSizeBytes mismatch");

  if (options.expectedGenerationInputHash !== undefined) {
    const expectedHash = hashValue(
      options.expectedGenerationInputHash,
      "expected generation_input_hash",
    );
    if (expectedHash !== inputHash) invalid("generation_input_hash mismatch");
  }
  if (options.expectedGenerationInputSnapshot !== undefined) {
    const expectedText = postgresJsonbText(options.expectedGenerationInputSnapshot);
    if (expectedText !== canonicalInput || sha256(expectedText) !== inputHash)
      invalid("generation_input_snapshot mismatch");
  }

  let mediaManifest: ResolvedMediaManifest | undefined;
  if (raw.mediaManifest !== undefined) {
    const parsed = parseMediaManifest(4, raw.mediaManifest);
    if (!parsed.ok) invalid(`mediaManifest: ${parsed.error}`);
    mediaManifest = parsed.manifest;
  }
  const checkpoint: SiteGenerationCheckpoint = {
    schemaVersion: 2,
    stage: raw.stage as SiteGenerationCheckpointStage,
    acceptedAt: timestamp(raw.acceptedAt, "acceptedAt"),
    inputHash,
    inputSizeBytes,
    input: parseInput(rawInput),
    ...(raw.variantKey === undefined
      ? {}
      : { variantKey: boundedString(raw.variantKey, "variantKey", 256) }),
    ...(raw.designPreferences === undefined
      ? {}
      : { designPreferences: parseDesignPreferences(raw.designPreferences) }),
    ...(raw.gachaLock === undefined ? {} : { gachaLock: parseGachaLock(raw.gachaLock) }),
    ...(raw.scrapeEnqueued === undefined
      ? {}
      : raw.scrapeEnqueued === true
        ? { scrapeEnqueued: true as const }
        : invalid("scrapeEnqueued")),
    ...(raw.effectiveSourceBySlot === undefined
      ? {}
      : { effectiveSourceBySlot: parseEffectiveSources(raw.effectiveSourceBySlot) }),
    ...(mediaManifest ? { mediaManifest } : {}),
    ...(raw.candidateConfig === undefined
      ? {}
      : { candidateConfig: parseCandidate(raw.candidateConfig) }),
    ...(raw.candidateSourceHash === undefined
      ? {}
      : { candidateSourceHash: hashValue(raw.candidateSourceHash, "candidateSourceHash") }),
    ...(raw.candidateRevision === undefined
      ? {}
      : {
          candidateRevision: integer(
            raw.candidateRevision,
            1,
            Number.MAX_SAFE_INTEGER,
            "candidateRevision",
          ),
        }),
    ...(raw.defects === undefined ? {} : { defects: parseDefects(raw.defects) }),
    ...(raw.validationAttestation === undefined
      ? {}
      : { validationAttestation: parseAttestation(raw.validationAttestation) }),
    ...(raw.resultVersionId === undefined
      ? {}
      : {
          resultVersionId: (() => {
            const id = boundedString(raw.resultVersionId, "resultVersionId", 128);
            if (!UUID.test(id)) invalid("resultVersionId UUID");
            return id;
          })(),
        }),
  };
  validateStage(checkpoint);
  return checkpoint;
}

export function generationCheckpointJson(checkpoint: SiteGenerationCheckpoint): Json {
  return checkpoint as unknown as Json;
}
