/**
 * Versioned Bucket 1 realized-output contract.
 *
 * This module contains data only so the browser runtime, server validator, and
 * publish attestation verifier can share one closed, deterministic contract.
 */

export const BUCKET1_VALIDATION_SCHEMA_VERSION = 1 as const;
export const BUCKET1_ATTESTATION_SCHEMA_VERSION = 1 as const;
export const SITE_RUNTIME_CONTRACT_VERSION = 1 as const;

export const SHA256_HEX = /^[a-f0-9]{64}$/;

export const BUCKET1_VALIDATION_LIMITS = {
  sourceBytes: 80 * 1024,
  manifestBytes: 64 * 1024,
  operationalPlanBytes: 64 * 1024,
  hostPropsBytes: 128 * 1024,
  attachmentCount: 64,
  resourceCount: 64,
  operationalAnchorCount: 32,
  runtimeDefectCount: 256,
  runtimeDetailBytes: 2 * 1024,
  attestationTtlMs: 24 * 60 * 60 * 1000,
} as const;

export const BUCKET1_RUNTIME_CHECK_IDS = [
  "runtime-errors",
  "horizontal-overflow",
  "clipping",
  "interactive-overlap",
  "media-containment",
  "lead-action",
  "accessible-names",
  "heading-landmarks",
  "keyboard-navigation",
  "focus-actions",
  "contrast",
  "severe-responsive-regression",
] as const;

export type Bucket1RuntimeCheckId = (typeof BUCKET1_RUNTIME_CHECK_IDS)[number];

export type Bucket1Viewport = {
  id: string;
  width: number;
  height: number;
  dpr: number;
  textScale: number;
  orientation: "portrait" | "landscape";
  reducedMotion: true;
};

/**
 * Includes canonical desktop/mobile, one tablet, mobile landscape, configured
 * text scaling, and both sides of every Tailwind v4 default breakpoint.
 */
export const BUCKET1_VIEWPORT_MATRIX: readonly Bucket1Viewport[] = [
  {
    id: "mobile-390",
    width: 390,
    height: 844,
    dpr: 2,
    textScale: 1,
    orientation: "portrait",
    reducedMotion: true,
  },
  {
    id: "mobile-390-text-125",
    width: 390,
    height: 844,
    dpr: 2,
    textScale: 1.25,
    orientation: "portrait",
    reducedMotion: true,
  },
  {
    id: "mobile-landscape",
    width: 844,
    height: 390,
    dpr: 2,
    textScale: 1,
    orientation: "landscape",
    reducedMotion: true,
  },
  {
    id: "sm-before",
    width: 639,
    height: 900,
    dpr: 1,
    textScale: 1,
    orientation: "portrait",
    reducedMotion: true,
  },
  {
    id: "sm-after",
    width: 641,
    height: 900,
    dpr: 1,
    textScale: 1,
    orientation: "portrait",
    reducedMotion: true,
  },
  {
    id: "md-before",
    width: 767,
    height: 1024,
    dpr: 1,
    textScale: 1,
    orientation: "portrait",
    reducedMotion: true,
  },
  {
    id: "md-after",
    width: 769,
    height: 1024,
    dpr: 1,
    textScale: 1,
    orientation: "portrait",
    reducedMotion: true,
  },
  {
    id: "tablet",
    width: 834,
    height: 1112,
    dpr: 2,
    textScale: 1,
    orientation: "portrait",
    reducedMotion: true,
  },
  {
    id: "lg-before",
    width: 1023,
    height: 900,
    dpr: 1,
    textScale: 1,
    orientation: "landscape",
    reducedMotion: true,
  },
  {
    id: "lg-after",
    width: 1025,
    height: 900,
    dpr: 1,
    textScale: 1,
    orientation: "landscape",
    reducedMotion: true,
  },
  {
    id: "xl-before",
    width: 1279,
    height: 900,
    dpr: 1,
    textScale: 1,
    orientation: "landscape",
    reducedMotion: true,
  },
  {
    id: "xl-after",
    width: 1281,
    height: 900,
    dpr: 1,
    textScale: 1,
    orientation: "landscape",
    reducedMotion: true,
  },
  {
    id: "desktop-1440",
    width: 1440,
    height: 900,
    dpr: 1,
    textScale: 1,
    orientation: "landscape",
    reducedMotion: true,
  },
  {
    id: "2xl-before",
    width: 1535,
    height: 960,
    dpr: 1,
    textScale: 1,
    orientation: "landscape",
    reducedMotion: true,
  },
  {
    id: "2xl-after",
    width: 1537,
    height: 960,
    dpr: 1,
    textScale: 1,
    orientation: "landscape",
    reducedMotion: true,
  },
] as const;

export type Bucket1ResourcePolicy = {
  version: 1;
  network: "fulfill-bound-resources-only";
  imagePolicy: "manifest-attachments-only";
  fontPolicy: "frozen-response-or-system-fallback";
  blockedResourceIsInfrastructureFailure: true;
  resourceTimeoutMs: number;
  maximumResources: number;
  allowedSchemes: readonly ["data", "blob"];
};

export type Bucket1HostContract = {
  version: 1;
  runtimeProtocolVersion: 1;
  runtimeBuild: string;
  injectedPropsSchemaVersion: 1;
  siteKitRegistryVersion: 1;
  visualRegistryVersion: 1;
  mediaAdapterVersion: 1;
  leadSlotAdapterVersion: 1;
  navigationAnchorVersion: 1;
  sectionMarkerAttribute: "data-site-section";
  mediaMarkerAttribute: "data-site-media";
  leadMessageType: "lead-submit";
};

export type Bucket1ValidationContract = {
  schemaVersion: 1;
  validatorBuild: string;
  runtime: {
    protocolVersion: 1;
    build: string;
    hostDocument: "/site-runtime/host.html";
  };
  browser: {
    engine: "chromium";
    playwrightVersion: "1.55.0";
    revision: "1187";
    browserVersion: "140.0.7339.16";
  };
  styles: {
    tailwindBrowserVersion: "4.3.3";
    fontContractVersion: 1;
  };
  locale: "en-US";
  timezone: "UTC";
  colorScheme: "light";
  animationState: "reduced-motion";
  readyTimeoutMs: number;
  layoutStabilitySamples: number;
  totalTimeoutMs: number;
  viewports: readonly Bucket1Viewport[];
  checks: readonly Bucket1RuntimeCheckId[];
  tolerances: {
    version: 1;
    overflowPx: number;
    clippingPx: number;
    overlapAreaPx2: number;
    minimumNormalTextContrast: number;
    minimumLargeTextContrast: number;
    stableLayoutDeltaPx: number;
  };
  intentionalExceptions: {
    version: 1;
    overlay: "none-unless-host-marker-is-versioned";
    mediaCrop: "object-cover-inside-data-site-media-only";
  };
  resources: Bucket1ResourcePolicy;
  host: Bucket1HostContract;
};

export const BUCKET1_VALIDATION_CONTRACT: Bucket1ValidationContract = {
  schemaVersion: BUCKET1_VALIDATION_SCHEMA_VERSION,
  validatorBuild: "bucket1-realized-output-validator-v1",
  runtime: {
    protocolVersion: SITE_RUNTIME_CONTRACT_VERSION,
    build: "site-runtime-v1",
    hostDocument: "/site-runtime/host.html",
  },
  browser: {
    engine: "chromium",
    playwrightVersion: "1.55.0",
    revision: "1187",
    browserVersion: "140.0.7339.16",
  },
  styles: {
    tailwindBrowserVersion: "4.3.3",
    fontContractVersion: 1,
  },
  locale: "en-US",
  timezone: "UTC",
  colorScheme: "light",
  animationState: "reduced-motion",
  readyTimeoutMs: 4_000,
  layoutStabilitySamples: 3,
  totalTimeoutMs: 45_000,
  viewports: BUCKET1_VIEWPORT_MATRIX,
  checks: BUCKET1_RUNTIME_CHECK_IDS,
  tolerances: {
    version: 1,
    overflowPx: 1,
    clippingPx: 1,
    overlapAreaPx2: 4,
    minimumNormalTextContrast: 4.5,
    minimumLargeTextContrast: 3,
    stableLayoutDeltaPx: 0.5,
  },
  intentionalExceptions: {
    version: 1,
    overlay: "none-unless-host-marker-is-versioned",
    mediaCrop: "object-cover-inside-data-site-media-only",
  },
  resources: {
    version: 1,
    network: "fulfill-bound-resources-only",
    imagePolicy: "manifest-attachments-only",
    fontPolicy: "frozen-response-or-system-fallback",
    blockedResourceIsInfrastructureFailure: true,
    resourceTimeoutMs: 5_000,
    maximumResources: BUCKET1_VALIDATION_LIMITS.resourceCount,
    allowedSchemes: ["data", "blob"],
  },
  host: {
    version: 1,
    runtimeProtocolVersion: SITE_RUNTIME_CONTRACT_VERSION,
    runtimeBuild: "site-runtime-v1",
    injectedPropsSchemaVersion: 1,
    siteKitRegistryVersion: 1,
    visualRegistryVersion: 1,
    mediaAdapterVersion: 1,
    leadSlotAdapterVersion: 1,
    navigationAnchorVersion: 1,
    sectionMarkerAttribute: "data-site-section",
    mediaMarkerAttribute: "data-site-media",
    leadMessageType: "lead-submit",
  },
};

export type Bucket1BoundAttachment = {
  assetId: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
};

export type Bucket1BoundResource = {
  logicalId: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  kind: "image" | "font" | "video";
};

export type Bucket1CompilePolicy = {
  kitScope: "unified";
  generatorSchemaVersion: number;
  contactHidden: boolean;
  operationalAnchors: Array<{ slug: string }>;
};

export type Bucket1ValidationInput = {
  generationContractEpoch: number;
  contextHash: string;
  candidateRevision: string;
  candidateConfigHash: string;
  candidateSource: string;
  manifest: unknown;
  attachments: Bucket1BoundAttachment[];
  operationalPlan: unknown;
  hostProps: unknown;
  compilePolicy: Bucket1CompilePolicy;
  resources: Bucket1BoundResource[];
};

export type Bucket1ValidationBinding = {
  generationContractEpoch: number;
  contextHash: string;
  candidateRevision: string;
  candidateConfigHash: string;
  sourceHash: string;
  compilePolicyHash: string;
  manifestHash: string;
  attachmentHash: string;
  operationalPlanHash: string;
  hostPropsHash: string;
  resourceSetHash: string;
  hostContractHash: string;
  validationContractHash: string;
  candidateBindingHash: string;
};

export type Bucket1DefectCause =
  | "source_contract"
  | "manifest_contract"
  | "operational_plan_contract"
  | "host_props_contract"
  | "attachment_contract"
  | "resource_contract"
  | "static_compile"
  | Bucket1RuntimeCheckId
  | "browser_launch"
  | "browser_unavailable"
  | "runtime_ready_timeout"
  | "resource_timeout"
  | "font_timeout"
  | "image_timeout"
  | "host_injection"
  | "validator_timeout"
  | "validator_crash"
  | "runtime_evidence_contract"
  | "attestation_contract"
  | "attestation_expired"
  | "attestation_binding_mismatch";

export type Bucket1Defect = {
  defectVersion: 1;
  id: string;
  phase: "static" | "runtime" | "attestation";
  cause: Bucket1DefectCause;
  classification: "candidate" | "infrastructure";
  severity: "blocking";
  disposition: "writer_repair" | "infrastructure_retry" | "reject_attestation";
  viewportId: string | null;
  region: {
    kind:
      "source" | "document" | "selector" | "site-section" | "media-slot" | "lead-slot" | "contract";
    id: string;
  };
  observed: string;
  expected: string;
  threshold: string;
  repairInstruction: string | null;
};

export type Bucket1StaticResult = {
  status: "passed" | "failed";
  defects: Bucket1Defect[];
  advisories: Array<{ code: string; message: string }>;
};

export type Bucket1RuntimeCheckEvidence = {
  checkId: Bucket1RuntimeCheckId;
  status: "passed" | "failed";
  region: Bucket1Defect["region"];
  observed: string;
  expected: string;
  threshold: string;
  repairInstruction: string | null;
};

export type Bucket1ViewportEvidence = {
  viewportId: string;
  runtimeReady: true;
  fontsReady: true;
  resourcesSettled: true;
  layoutStabilitySamples: number;
  checks: Bucket1RuntimeCheckEvidence[];
};

export type Bucket1HeadlessSuccess = {
  schemaVersion: 1;
  kind: "headless-browser";
  status: "completed";
  bindingHash: string;
  validationContractHash: string;
  browser: Bucket1ValidationContract["browser"];
  viewports: Bucket1ViewportEvidence[];
};

export type Bucket1InfrastructureFailure = {
  schemaVersion: 1;
  kind: "headless-browser";
  status: "infrastructure_failed";
  cause: Extract<
    Bucket1DefectCause,
    | "browser_launch"
    | "browser_unavailable"
    | "runtime_ready_timeout"
    | "resource_timeout"
    | "font_timeout"
    | "image_timeout"
    | "host_injection"
    | "validator_timeout"
    | "validator_crash"
    | "runtime_evidence_contract"
  >;
  detail: string;
};

export type Bucket1HeadlessObservation = Bucket1HeadlessSuccess | Bucket1InfrastructureFailure;

export type Bucket1RuntimeResult = {
  status: "not_run" | "passed" | "candidate_failed" | "infrastructure_failed";
  evidenceKind: "none" | "headless-browser";
  evidenceHash: string | null;
  completedViewportIds: string[];
  defects: Bucket1Defect[];
};

export type Bucket1ValidationResult = {
  schemaVersion: 1;
  kind: "bucket1-validation-result";
  outcome: "passed" | "candidate_failed" | "infrastructure_failed";
  binding: Bucket1ValidationBinding | null;
  static: Bucket1StaticResult;
  runtime: Bucket1RuntimeResult;
  attestation: null;
};

export type Bucket1AttestationSigner = {
  keyId: string;
  secret: string | Uint8Array;
};

export type Bucket1ValidationAttestation = {
  schemaVersion: 1;
  kind: "bucket1-validation-attestation";
  binding: Bucket1ValidationBinding;
  runtimeEvidenceHash: string;
  issuedAt: string;
  expiresAt: string;
  issuerKeyId: string;
  attestationHash: string;
  signature: string;
};

export type Bucket1AttestationVerification =
  { ok: true; binding: Bucket1ValidationBinding } | { ok: false; defects: Bucket1Defect[] };

export interface Bucket1HeadlessRuntime {
  validate(request: {
    input: Bucket1ValidationInput;
    binding: Bucket1ValidationBinding;
    contract: Bucket1ValidationContract;
    signal?: AbortSignal;
  }): Promise<Bucket1HeadlessObservation>;
}
