import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { compileThemeSource } from "../site-theme/compile-theme-source.ts";
import { parseMediaManifest } from "../site-theme/media-manifest.ts";
import {
  BUCKET1_ATTESTATION_SCHEMA_VERSION,
  BUCKET1_RUNTIME_CHECK_IDS,
  BUCKET1_VALIDATION_CONTRACT,
  BUCKET1_VALIDATION_LIMITS,
  BUCKET1_VALIDATION_SCHEMA_VERSION,
  SHA256_HEX,
  type Bucket1AttestationSigner,
  type Bucket1AttestationVerification,
  type Bucket1Defect,
  type Bucket1DefectCause,
  type Bucket1HeadlessObservation,
  type Bucket1HeadlessRuntime,
  type Bucket1HeadlessSuccess,
  type Bucket1ValidationAttestation,
  type Bucket1ValidationBinding,
  type Bucket1ValidationContract,
  type Bucket1ValidationInput,
  type Bucket1ValidationResult,
} from "./bucket1-contract.ts";

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();
const INPUT_KEYS = [
  "generationContractEpoch",
  "contextHash",
  "candidateRevision",
  "candidateConfigHash",
  "candidateSource",
  "manifest",
  "attachments",
  "operationalPlan",
  "hostProps",
  "compilePolicy",
  "resources",
] as const;
const COMPILE_POLICY_KEYS = [
  "kitScope",
  "generatorSchemaVersion",
  "contactHidden",
  "operationalAnchors",
] as const;
const ATTACHMENT_KEYS = ["assetId", "contentHash", "mimeType", "byteSize"] as const;
const RESOURCE_KEYS = ["logicalId", "contentHash", "mimeType", "byteSize", "kind"] as const;
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
const BINDING_HASH_KEYS = [
  "contextHash",
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
const CONTRACT_KEYS = [
  "schemaVersion",
  "validatorBuild",
  "runtime",
  "browser",
  "styles",
  "locale",
  "timezone",
  "colorScheme",
  "animationState",
  "readyTimeoutMs",
  "layoutStabilitySamples",
  "totalTimeoutMs",
  "viewports",
  "checks",
  "tolerances",
  "intentionalExceptions",
  "resources",
  "host",
] as const;

function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  let nodes = 0;
  const walk = (current: unknown, depth: number): string => {
    if (++nodes > 20_000 || depth > 64) throw new Error("canonical JSON exceeds traversal limits");
    if (current === null || typeof current === "boolean" || typeof current === "string")
      return JSON.stringify(current);
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error("non-finite numbers are not canonical JSON");
      return JSON.stringify(Object.is(current, -0) ? 0 : current);
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) throw new Error("cyclic values are not canonical JSON");
      if (Object.keys(current).length !== current.length)
        throw new Error("sparse arrays are not canonical JSON");
      seen.add(current);
      const serialized = `[${current.map((entry) => walk(entry, depth + 1)).join(",")}]`;
      seen.delete(current);
      return serialized;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (Object.getPrototypeOf(record) !== Object.prototype || seen.has(record))
        throw new Error("only acyclic plain objects are canonical JSON");
      const descriptors = Object.getOwnPropertyDescriptors(record);
      if (
        Object.values(descriptors).some(
          (entry) => typeof entry.get === "function" || typeof entry.set === "function",
        )
      )
        throw new Error("accessors are not canonical JSON");
      seen.add(record);
      const keys = Object.keys(record).sort();
      const serialized = `{${keys.map((key) => `${JSON.stringify(key)}:${walk(record[key], depth + 1)}`).join(",")}}`;
      seen.delete(record);
      return serialized;
    }
    throw new Error(`unsupported canonical JSON value: ${typeof current}`);
  };
  return walk(value, 0);
}

function hashBytes(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function bucket1CanonicalHash(value: unknown): string {
  return hashBytes(canonicalJson(value));
}

/**
 * Projects the exact render/persist candidate config for hashing. The only
 * excluded top-level fields are the validation input and attestations because
 * they contain this hash (directly or through the binding) and would recurse.
 * The remaining value is normalized to its persisted JSON shape: undefined
 * object properties are omitted and undefined array entries become null. Every
 * other persisted key and value remains in the canonical, key-sorted JSON hash.
 */
export function bucket1CandidateConfigProjection(
  candidateConfig: Record<string, unknown>,
): Record<string, unknown> {
  const seen = new Set<object>();
  let nodes = 0;
  const excludedTopLevelKeys = new Set([
    "bucket1ValidationInput",
    "bucket1ValidationAttestation",
    "validationAttestation",
  ]);
  const walk = (current: unknown, depth: number): unknown => {
    if (++nodes > 20_000 || depth > 64)
      throw new Error("candidate config exceeds traversal limits");
    if (current === null || typeof current === "boolean" || typeof current === "string")
      return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return null;
      return Object.is(current, -0) ? 0 : current;
    }
    if (current === undefined || typeof current === "function" || typeof current === "symbol")
      return undefined;
    if (Array.isArray(current)) {
      if (seen.has(current)) throw new Error("cyclic candidate config is not persisted JSON");
      if (Object.keys(current).length !== current.length)
        throw new Error("sparse candidate config arrays are not persisted JSON");
      seen.add(current);
      const projected = current.map((entry) => walk(entry, depth + 1) ?? null);
      seen.delete(current);
      return projected;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (Object.getPrototypeOf(record) !== Object.prototype || seen.has(record))
        throw new Error("candidate config must contain acyclic plain objects");
      const descriptors = Object.getOwnPropertyDescriptors(record);
      if (
        Object.values(descriptors).some(
          (entry) => typeof entry.get === "function" || typeof entry.set === "function",
        )
      )
        throw new Error("candidate config accessors are not persisted JSON");
      seen.add(record);
      const projected = Object.fromEntries(
        Object.entries(record).flatMap(([key, value]) => {
          if (depth === 0 && excludedTopLevelKeys.has(key)) return [];
          const entry = walk(value, depth + 1);
          return entry === undefined ? [] : [[key, entry]];
        }),
      );
      seen.delete(record);
      return projected;
    }
    throw new Error(`unsupported persisted candidate config value: ${typeof current}`);
  };
  const projected = walk(candidateConfig, 0);
  if (!projected || typeof projected !== "object" || Array.isArray(projected))
    throw new Error("candidate config must be a plain object");
  return projected as Record<string, unknown>;
}

export function bucket1CandidateConfigHash(candidateConfig: Record<string, unknown>): string {
  return bucket1CanonicalHash(bucket1CandidateConfigProjection(candidateConfig));
}

function byteLength(value: unknown): number {
  return UTF8.encode(typeof value === "string" ? value : canonicalJson(value)).byteLength;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function boundedDetail(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return UTF8_DECODER.decode(
    UTF8.encode(text).slice(0, BUCKET1_VALIDATION_LIMITS.runtimeDetailBytes),
  );
}

function defect(options: {
  id: string;
  phase: Bucket1Defect["phase"];
  cause: Bucket1DefectCause;
  classification: Bucket1Defect["classification"];
  disposition: Bucket1Defect["disposition"];
  viewportId?: string | null;
  region?: Bucket1Defect["region"];
  observed: string;
  expected: string;
  threshold?: string;
  repairInstruction?: string | null;
}): Bucket1Defect {
  return {
    defectVersion: 1,
    id: options.id,
    phase: options.phase,
    cause: options.cause,
    classification: options.classification,
    severity: "blocking",
    disposition: options.disposition,
    viewportId: options.viewportId ?? null,
    region: options.region ?? { kind: "contract", id: options.cause },
    observed: boundedDetail(options.observed),
    expected: boundedDetail(options.expected),
    threshold: boundedDetail(options.threshold ?? options.expected),
    repairInstruction:
      options.repairInstruction == null ? null : boundedDetail(options.repairInstruction),
  };
}

function candidateContractDefect(
  id: string,
  cause: Extract<
    Bucket1DefectCause,
    | "source_contract"
    | "manifest_contract"
    | "operational_plan_contract"
    | "host_props_contract"
    | "attachment_contract"
    | "resource_contract"
    | "static_compile"
  >,
  observed: string,
  expected: string,
): Bucket1Defect {
  return defect({
    id,
    phase: "static",
    cause,
    classification: "candidate",
    disposition: "writer_repair",
    region: {
      kind: cause === "source_contract" || cause === "static_compile" ? "source" : "contract",
      id: cause,
    },
    observed,
    expected,
    repairInstruction: `Correct ${cause.replaceAll("_", " ")} and submit a new candidate revision.`,
  });
}

type InfrastructureCause = Extract<
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

function infrastructureDefect(
  id: string,
  cause: InfrastructureCause,
  observed: string,
): Bucket1Defect {
  return defect({
    id,
    phase: "runtime",
    cause,
    classification: "infrastructure",
    disposition: "infrastructure_retry",
    observed,
    expected: "Pinned server-owned headless validation must complete with exact evidence.",
  });
}

function safeHash(value: unknown): { ok: true; hash: string } | { ok: false; error: string } {
  try {
    return { ok: true, hash: bucket1CanonicalHash(value) };
  } catch (error) {
    return { ok: false, error: boundedDetail(error) };
  }
}

function sortedAttachments(input: Bucket1ValidationInput): Bucket1ValidationInput["attachments"] {
  return [...input.attachments].sort(
    (a, b) =>
      a.assetId.localeCompare(b.assetId) ||
      a.contentHash.localeCompare(b.contentHash) ||
      a.mimeType.localeCompare(b.mimeType) ||
      a.byteSize - b.byteSize,
  );
}

function sortedResources(input: Bucket1ValidationInput): Bucket1ValidationInput["resources"] {
  return [...input.resources].sort(
    (a, b) =>
      a.logicalId.localeCompare(b.logicalId) ||
      a.contentHash.localeCompare(b.contentHash) ||
      a.mimeType.localeCompare(b.mimeType) ||
      a.byteSize - b.byteSize ||
      a.kind.localeCompare(b.kind),
  );
}

function validateInput(input: Bucket1ValidationInput): Bucket1Defect[] {
  const defects: Bucket1Defect[] = [];
  if (
    !input ||
    typeof input !== "object" ||
    !exactKeys(input as unknown as Record<string, unknown>, INPUT_KEYS)
  ) {
    return [
      candidateContractDefect(
        "static:input-envelope",
        "operational_plan_contract",
        "Unknown or missing validation input fields.",
        "The closed Bucket 1 validation input v1 envelope.",
      ),
    ];
  }
  if (!Number.isSafeInteger(input.generationContractEpoch) || input.generationContractEpoch < 1)
    defects.push(
      candidateContractDefect(
        "static:generation-contract-epoch",
        "operational_plan_contract",
        String(input.generationContractEpoch),
        "A positive safe integer generation contract epoch.",
      ),
    );
  if (!SHA256_HEX.test(input.contextHash))
    defects.push(
      candidateContractDefect(
        "static:context-hash",
        "operational_plan_contract",
        input.contextHash,
        "A lowercase SHA-256 context hash.",
      ),
    );
  if (!SHA256_HEX.test(input.candidateConfigHash))
    defects.push(
      candidateContractDefect(
        "static:candidate-config-hash",
        "operational_plan_contract",
        input.candidateConfigHash,
        "The lowercase SHA-256 hash of the exact normalized candidate config projection.",
      ),
    );
  if (!input.candidateRevision || input.candidateRevision.length > 128)
    defects.push(
      candidateContractDefect(
        "static:candidate-revision",
        "source_contract",
        String(input.candidateRevision),
        "A non-empty candidate revision of at most 128 characters.",
      ),
    );
  if (
    !input.candidateSource.trim() ||
    byteLength(input.candidateSource) > BUCKET1_VALIDATION_LIMITS.sourceBytes
  )
    defects.push(
      candidateContractDefect(
        "static:source-size",
        "source_contract",
        `${byteLength(input.candidateSource)} bytes`,
        `A non-empty candidate source of at most ${BUCKET1_VALIDATION_LIMITS.sourceBytes} bytes.`,
      ),
    );
  for (const [label, value, maximum, cause] of [
    ["manifest", input.manifest, BUCKET1_VALIDATION_LIMITS.manifestBytes, "manifest_contract"],
    [
      "operational-plan",
      input.operationalPlan,
      BUCKET1_VALIDATION_LIMITS.operationalPlanBytes,
      "operational_plan_contract",
    ],
    [
      "host-props",
      input.hostProps,
      BUCKET1_VALIDATION_LIMITS.hostPropsBytes,
      "host_props_contract",
    ],
  ] as const) {
    try {
      const bytes = byteLength(value);
      if (bytes > maximum)
        defects.push(
          candidateContractDefect(
            `static:${label}-size`,
            cause,
            `${bytes} bytes`,
            `Canonical JSON of at most ${maximum} bytes.`,
          ),
        );
    } catch (error) {
      defects.push(
        candidateContractDefect(
          `static:${label}-canonical`,
          cause,
          boundedDetail(error),
          "Canonical JSON containing only finite JSON values.",
        ),
      );
    }
  }
  if (
    !input.compilePolicy ||
    typeof input.compilePolicy !== "object" ||
    !exactKeys(input.compilePolicy as unknown as Record<string, unknown>, COMPILE_POLICY_KEYS)
  ) {
    defects.push(
      candidateContractDefect(
        "static:compile-policy",
        "source_contract",
        "Unknown or missing compile policy fields.",
        "The closed compile policy v1 shape.",
      ),
    );
    return defects;
  }
  if (input.compilePolicy.kitScope !== "unified")
    defects.push(
      candidateContractDefect(
        "static:kit-scope",
        "source_contract",
        input.compilePolicy.kitScope,
        "The unified runtime scope.",
      ),
    );
  if (
    !Number.isSafeInteger(input.compilePolicy.generatorSchemaVersion) ||
    input.compilePolicy.generatorSchemaVersion < 1
  )
    defects.push(
      candidateContractDefect(
        "static:generator-schema",
        "manifest_contract",
        String(input.compilePolicy.generatorSchemaVersion),
        "A positive integer generator schema version.",
      ),
    );
  if (
    !Array.isArray(input.compilePolicy.operationalAnchors) ||
    input.compilePolicy.operationalAnchors.length > BUCKET1_VALIDATION_LIMITS.operationalAnchorCount
  ) {
    defects.push(
      candidateContractDefect(
        "static:anchor-count",
        "operational_plan_contract",
        String(input.compilePolicy.operationalAnchors?.length),
        `At most ${BUCKET1_VALIDATION_LIMITS.operationalAnchorCount} operational anchors.`,
      ),
    );
  } else {
    const anchorIds = input.compilePolicy.operationalAnchors.map((anchor) => anchor?.slug);
    if (
      input.compilePolicy.operationalAnchors.some(
        (anchor) => !anchor || !exactKeys(anchor as unknown as Record<string, unknown>, ["slug"]),
      ) ||
      new Set(anchorIds).size !== anchorIds.length ||
      anchorIds.some((slug) => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug))
    )
      defects.push(
        candidateContractDefect(
          "static:anchors",
          "operational_plan_contract",
          anchorIds.join(","),
          "Closed, unique lowercase kebab-case operational anchors.",
        ),
      );
  }
  if (
    !Array.isArray(input.attachments) ||
    input.attachments.length > BUCKET1_VALIDATION_LIMITS.attachmentCount
  ) {
    defects.push(
      candidateContractDefect(
        "static:attachment-count",
        "attachment_contract",
        String(input.attachments?.length),
        `At most ${BUCKET1_VALIDATION_LIMITS.attachmentCount} attachments.`,
      ),
    );
  } else {
    const attachmentIds = new Set<string>();
    for (const [index, attachment] of input.attachments.entries()) {
      if (
        !attachment ||
        !exactKeys(attachment as unknown as Record<string, unknown>, ATTACHMENT_KEYS) ||
        !attachment.assetId ||
        attachmentIds.has(attachment.assetId) ||
        !SHA256_HEX.test(attachment.contentHash) ||
        !attachment.mimeType ||
        !Number.isSafeInteger(attachment.byteSize) ||
        attachment.byteSize < 0
      )
        defects.push(
          candidateContractDefect(
            `static:attachment:${index}`,
            "attachment_contract",
            safeHash(attachment).ok
              ? "Invalid or duplicate attachment identity."
              : "Non-canonical attachment.",
            "A closed attachment with unique assetId, SHA-256, MIME type, and non-negative byte size.",
          ),
        );
      attachmentIds.add(attachment.assetId);
    }
  }
  if (
    !Array.isArray(input.resources) ||
    input.resources.length > BUCKET1_VALIDATION_LIMITS.resourceCount
  ) {
    defects.push(
      candidateContractDefect(
        "static:resource-count",
        "resource_contract",
        String(input.resources?.length),
        `At most ${BUCKET1_VALIDATION_LIMITS.resourceCount} resources.`,
      ),
    );
  } else {
    const resourceIds = new Set<string>();
    for (const [index, resource] of input.resources.entries()) {
      if (
        !resource ||
        !exactKeys(resource as unknown as Record<string, unknown>, RESOURCE_KEYS) ||
        !resource.logicalId ||
        resourceIds.has(resource.logicalId) ||
        !SHA256_HEX.test(resource.contentHash) ||
        !resource.mimeType ||
        !Number.isSafeInteger(resource.byteSize) ||
        resource.byteSize < 0 ||
        !["image", "font", "video"].includes(resource.kind)
      )
        defects.push(
          candidateContractDefect(
            `static:resource:${index}`,
            "resource_contract",
            "Invalid or duplicate resource identity.",
            "A closed resource with unique logicalId, SHA-256, MIME type, non-negative byte size, and supported kind.",
          ),
        );
      resourceIds.add(resource.logicalId);
    }
    const attachmentHashes = new Set(input.attachments.map((attachment) => attachment.contentHash));
    for (const resource of input.resources) {
      if (resource.kind !== "font" && !attachmentHashes.has(resource.contentHash)) {
        defects.push(
          candidateContractDefect(
            `static:resource-attachment:${resource.logicalId}`,
            "resource_contract",
            `${resource.kind} resource ${resource.logicalId} is not backed by a bound attachment hash.`,
            "Every image/video resource must be content-addressed by the frozen attachment set.",
          ),
        );
      }
    }
  }
  return defects;
}

function validationContractHash(contract: Bucket1ValidationContract): string {
  const record = contract as unknown as Record<string, unknown>;
  if (!exactKeys(record, CONTRACT_KEYS))
    throw new Error("validation contract contains unknown or missing fields");
  return bucket1CanonicalHash(contract);
}

export function bindBucket1ValidationInput(
  input: Bucket1ValidationInput,
  contract: Bucket1ValidationContract = BUCKET1_VALIDATION_CONTRACT,
): { ok: true; binding: Bucket1ValidationBinding } | { ok: false; defects: Bucket1Defect[] } {
  const defects = validateInput(input);
  if (defects.length > 0) return { ok: false, defects };
  const hashes = {
    manifest: safeHash(input.manifest),
    plan: safeHash(input.operationalPlan),
    props: safeHash(input.hostProps),
    attachments: safeHash(sortedAttachments(input)),
    resources: safeHash(sortedResources(input)),
  };
  const failed = Object.values(hashes).find((entry) => entry.ok === false);
  if (failed?.ok === false)
    return {
      ok: false,
      defects: [
        candidateContractDefect(
          "static:canonical-hash",
          "operational_plan_contract",
          failed.error,
          "All bound inputs must be canonical JSON.",
        ),
      ],
    };
  try {
    const bindingBase = {
      generationContractEpoch: input.generationContractEpoch,
      contextHash: input.contextHash,
      candidateRevision: input.candidateRevision,
      candidateConfigHash: input.candidateConfigHash,
      sourceHash: hashBytes(input.candidateSource),
      compilePolicyHash: bucket1CanonicalHash(input.compilePolicy),
      manifestHash: hashes.manifest.ok ? hashes.manifest.hash : "",
      attachmentHash: hashes.attachments.ok ? hashes.attachments.hash : "",
      operationalPlanHash: hashes.plan.ok ? hashes.plan.hash : "",
      hostPropsHash: hashes.props.ok ? hashes.props.hash : "",
      resourceSetHash: hashes.resources.ok ? hashes.resources.hash : "",
      hostContractHash: bucket1CanonicalHash(contract.host),
      validationContractHash: validationContractHash(contract),
    };
    return {
      ok: true,
      binding: { ...bindingBase, candidateBindingHash: bucket1CanonicalHash(bindingBase) },
    };
  } catch (error) {
    return {
      ok: false,
      defects: [
        candidateContractDefect(
          "static:binding",
          "operational_plan_contract",
          boundedDetail(error),
          "A closed supported validation contract and canonical bound inputs.",
        ),
      ],
    };
  }
}

function staticValidation(input: Bucket1ValidationInput): Bucket1ValidationResult["static"] {
  const manifest = parseMediaManifest(input.compilePolicy.generatorSchemaVersion, input.manifest);
  if (manifest.ok === false)
    return {
      status: "failed",
      defects: [
        candidateContractDefect(
          "static:manifest",
          "manifest_contract",
          manifest.error,
          "A valid versioned media manifest, including an empty v4 manifest when appropriate.",
        ),
      ],
      advisories: [],
    };
  const compiled = compileThemeSource(input.candidateSource, {
    unifiedLoose: true,
    bindingScope: input.compilePolicy.kitScope,
    generatorSchemaVersion: input.compilePolicy.generatorSchemaVersion,
    mediaManifest: input.manifest,
    contactHidden: input.compilePolicy.contactHidden,
    operationalAnchors: input.compilePolicy.operationalAnchors,
  });
  if (compiled.ok === false)
    return {
      status: "failed",
      defects: [
        candidateContractDefect(
          "static:compile",
          "static_compile",
          compiled.error,
          "Candidate source that passes the shared preview/runtime compiler and binding policy.",
        ),
      ],
      advisories: compiled.advisories?.map(({ code, message }) => ({ code, message })) ?? [],
    };
  return {
    status: "passed",
    defects: [],
    advisories: compiled.advisories.map(({ code, message }) => ({ code, message })),
  };
}

function noRuntimeResult(): Bucket1ValidationResult["runtime"] {
  return {
    status: "not_run",
    evidenceKind: "none",
    evidenceHash: null,
    completedViewportIds: [],
    defects: [],
  };
}

function runtimeEvidenceEnvelopeError(observation: Bucket1HeadlessSuccess): string | null {
  if (
    observation.schemaVersion !== 1 ||
    observation.kind !== "headless-browser" ||
    observation.status !== "completed" ||
    !SHA256_HEX.test(observation.bindingHash) ||
    !SHA256_HEX.test(observation.validationContractHash) ||
    !Array.isArray(observation.viewports)
  )
    return "Malformed or unsupported headless evidence envelope.";
  for (const viewport of observation.viewports) {
    if (
      !viewport ||
      typeof viewport.viewportId !== "string" ||
      viewport.runtimeReady !== true ||
      viewport.fontsReady !== true ||
      viewport.resourcesSettled !== true ||
      !Number.isSafeInteger(viewport.layoutStabilitySamples) ||
      !Array.isArray(viewport.checks)
    )
      return "Malformed viewport or unsettled runtime evidence.";
    for (const check of viewport.checks) {
      if (
        !check ||
        !BUCKET1_RUNTIME_CHECK_IDS.includes(check.checkId) ||
        (check.status !== "passed" && check.status !== "failed") ||
        !check.region ||
        typeof check.region.id !== "string" ||
        typeof check.observed !== "string" ||
        typeof check.expected !== "string" ||
        typeof check.threshold !== "string" ||
        !(check.repairInstruction === null || typeof check.repairInstruction === "string") ||
        byteLength(check.observed) > BUCKET1_VALIDATION_LIMITS.runtimeDetailBytes ||
        byteLength(check.expected) > BUCKET1_VALIDATION_LIMITS.runtimeDetailBytes ||
        byteLength(check.threshold) > BUCKET1_VALIDATION_LIMITS.runtimeDetailBytes
      )
        return "Malformed, unknown, or oversized runtime check evidence.";
    }
  }
  return null;
}

function runtimeEvidenceDefects(
  observation: Bucket1HeadlessSuccess,
  binding: Bucket1ValidationBinding,
  contract: Bucket1ValidationContract,
): Bucket1Defect[] {
  const envelopeError = runtimeEvidenceEnvelopeError(observation);
  if (envelopeError)
    return [
      infrastructureDefect("runtime:evidence-envelope", "runtime_evidence_contract", envelopeError),
    ];
  const defects: Bucket1Defect[] = [];
  if (
    observation.bindingHash !== binding.candidateBindingHash ||
    observation.validationContractHash !== binding.validationContractHash
  )
    defects.push(
      infrastructureDefect(
        "runtime:evidence-binding",
        "runtime_evidence_contract",
        "Headless evidence is bound to different candidate or validator inputs.",
      ),
    );
  if (canonicalJson(observation.browser) !== canonicalJson(contract.browser))
    defects.push(
      infrastructureDefect(
        "runtime:browser-build",
        "runtime_evidence_contract",
        "Headless evidence reports an unexpected browser build.",
      ),
    );
  const expectedViewports = new Set(contract.viewports.map((viewport) => viewport.id));
  if (
    observation.viewports.length !== expectedViewports.size ||
    new Set(observation.viewports.map((viewport) => viewport.viewportId)).size !==
      observation.viewports.length
  )
    defects.push(
      infrastructureDefect(
        "runtime:viewport-matrix",
        "runtime_evidence_contract",
        "Headless evidence did not contain every viewport exactly once.",
      ),
    );
  for (const viewport of observation.viewports) {
    if (!expectedViewports.has(viewport.viewportId)) {
      defects.push(
        infrastructureDefect(
          `runtime:viewport:${viewport.viewportId}`,
          "runtime_evidence_contract",
          `Unknown viewport ${viewport.viewportId}.`,
        ),
      );
      continue;
    }
    if (viewport.layoutStabilitySamples < contract.layoutStabilitySamples)
      defects.push(
        infrastructureDefect(
          `runtime:stability:${viewport.viewportId}`,
          "runtime_evidence_contract",
          `${viewport.layoutStabilitySamples} stable samples for ${viewport.viewportId}.`,
        ),
      );
    const checks = new Map(viewport.checks.map((check) => [check.checkId, check]));
    if (
      checks.size !== BUCKET1_RUNTIME_CHECK_IDS.length ||
      viewport.checks.length !== checks.size
    ) {
      defects.push(
        infrastructureDefect(
          `runtime:checks:${viewport.viewportId}`,
          "runtime_evidence_contract",
          `Incomplete or duplicate checks for ${viewport.viewportId}.`,
        ),
      );
      continue;
    }
    for (const checkId of BUCKET1_RUNTIME_CHECK_IDS) {
      const check = checks.get(checkId);
      if (!check) {
        defects.push(
          infrastructureDefect(
            `runtime:check:${viewport.viewportId}:${checkId}`,
            "runtime_evidence_contract",
            `Missing ${checkId} for ${viewport.viewportId}.`,
          ),
        );
      } else if (check.status === "failed") {
        defects.push(
          defect({
            id: `runtime:${viewport.viewportId}:${checkId}:${bucket1CanonicalHash(check.region).slice(0, 12)}`,
            phase: "runtime",
            cause: checkId,
            classification: "candidate",
            disposition: "writer_repair",
            viewportId: viewport.viewportId,
            region: check.region,
            observed: check.observed,
            expected: check.expected,
            threshold: check.threshold,
            repairInstruction:
              check.repairInstruction ??
              `Correct the ${checkId} defect at ${check.region.kind} ${check.region.id}.`,
          }),
        );
      }
    }
  }
  return defects.slice(0, BUCKET1_VALIDATION_LIMITS.runtimeDefectCount);
}

export function validateBucket1CandidateStatic(options: {
  input: Bucket1ValidationInput;
  contract?: Bucket1ValidationContract;
}): Bucket1ValidationResult {
  const contract = options.contract ?? BUCKET1_VALIDATION_CONTRACT;
  const bound = bindBucket1ValidationInput(options.input, contract);
  if (bound.ok === false)
    return {
      schemaVersion: BUCKET1_VALIDATION_SCHEMA_VERSION,
      kind: "bucket1-validation-result",
      outcome: "candidate_failed",
      binding: null,
      static: { status: "failed", defects: bound.defects, advisories: [] },
      runtime: noRuntimeResult(),
      attestation: null,
    };
  const staticResult = staticValidation(options.input);
  return {
    schemaVersion: BUCKET1_VALIDATION_SCHEMA_VERSION,
    kind: "bucket1-validation-result",
    outcome: staticResult.status === "passed" ? "passed" : "candidate_failed",
    binding: bound.binding,
    static: staticResult,
    runtime: noRuntimeResult(),
    attestation: null,
  };
}

export async function validateBucket1Candidate(options: {
  input: Bucket1ValidationInput;
  runtime?: Bucket1HeadlessRuntime | null;
  contract?: Bucket1ValidationContract;
  signal?: AbortSignal;
}): Promise<Bucket1ValidationResult> {
  const contract = options.contract ?? BUCKET1_VALIDATION_CONTRACT;
  const cheap = validateBucket1CandidateStatic({ input: options.input, contract });
  if (cheap.static.status === "failed") return cheap;
  const binding = cheap.binding!;
  const staticResult = cheap.static;
  if (!options.runtime) {
    const unavailable = infrastructureDefect(
      "runtime:unavailable",
      "browser_unavailable",
      "No server-owned headless runtime adapter was supplied.",
    );
    return {
      schemaVersion: BUCKET1_VALIDATION_SCHEMA_VERSION,
      kind: "bucket1-validation-result",
      outcome: "infrastructure_failed",
      binding,
      static: staticResult,
      runtime: {
        status: "infrastructure_failed",
        evidenceKind: "none",
        evidenceHash: null,
        completedViewportIds: [],
        defects: [unavailable],
      },
      attestation: null,
    };
  }
  let observation: Bucket1HeadlessObservation;
  try {
    options.signal?.throwIfAborted();
    observation = await options.runtime.validate({
      input: options.input,
      binding,
      contract,
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      const reason = options.signal.reason;
      throw reason instanceof Error && reason.name === "AbortError"
        ? reason
        : new DOMException("Aborted", "AbortError");
    }
    if (error instanceof Error && error.name === "AbortError") throw error;
    observation = failureObservation("validator_crash", boundedDetail(error));
  }
  if (observation.status === "infrastructure_failed") {
    const failed = infrastructureDefect(
      `runtime:${observation.cause}`,
      observation.cause,
      observation.detail,
    );
    return {
      schemaVersion: BUCKET1_VALIDATION_SCHEMA_VERSION,
      kind: "bucket1-validation-result",
      outcome: "infrastructure_failed",
      binding,
      static: staticResult,
      runtime: {
        status: "infrastructure_failed",
        evidenceKind: "headless-browser",
        evidenceHash: bucket1CanonicalHash(observation),
        completedViewportIds: [],
        defects: [failed],
      },
      attestation: null,
    };
  }
  const runtimeDefects = runtimeEvidenceDefects(observation, binding, contract);
  const hasInfrastructure = runtimeDefects.some(
    (entry) => entry.classification === "infrastructure",
  );
  return {
    schemaVersion: BUCKET1_VALIDATION_SCHEMA_VERSION,
    kind: "bucket1-validation-result",
    outcome: hasInfrastructure
      ? "infrastructure_failed"
      : runtimeDefects.length > 0
        ? "candidate_failed"
        : "passed",
    binding,
    static: staticResult,
    runtime: {
      status: hasInfrastructure
        ? "infrastructure_failed"
        : runtimeDefects.length > 0
          ? "candidate_failed"
          : "passed",
      evidenceKind: "headless-browser",
      evidenceHash: bucket1CanonicalHash(observation),
      completedViewportIds: observation.viewports.map((viewport) => viewport.viewportId).sort(),
      defects: runtimeDefects,
    },
    attestation: null,
  };
}

function failureObservation(cause: "validator_crash", detail: string): Bucket1HeadlessObservation {
  return {
    schemaVersion: 1,
    kind: "headless-browser",
    status: "infrastructure_failed",
    cause,
    detail,
  };
}

export function issueBucket1ValidationAttestation(options: {
  result: Bucket1ValidationResult;
  issuedAt: Date;
  signer: Bucket1AttestationSigner;
  ttlMs?: number;
}): Bucket1ValidationAttestation {
  if (
    options.result.outcome !== "passed" ||
    !options.result.binding ||
    options.result.runtime.status !== "passed" ||
    !options.result.runtime.evidenceHash
  )
    throw new Error("Only a completed passing headless validation can be attested");
  const ttlMs = options.ttlMs ?? BUCKET1_VALIDATION_LIMITS.attestationTtlMs;
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > BUCKET1_VALIDATION_LIMITS.attestationTtlMs
  )
    throw new Error("Attestation TTL is outside the bounded policy");
  if (
    !options.signer.keyId ||
    options.signer.keyId.length > 128 ||
    (typeof options.signer.secret === "string" && options.signer.secret.length < 32) ||
    (options.signer.secret instanceof Uint8Array && options.signer.secret.byteLength < 32)
  )
    throw new Error("Attestation signer is missing a bounded key id or strong secret");
  const unsigned = {
    schemaVersion: BUCKET1_ATTESTATION_SCHEMA_VERSION,
    kind: "bucket1-validation-attestation" as const,
    binding: options.result.binding,
    runtimeEvidenceHash: options.result.runtime.evidenceHash,
    issuedAt: options.issuedAt.toISOString(),
    expiresAt: new Date(options.issuedAt.getTime() + ttlMs).toISOString(),
    issuerKeyId: options.signer.keyId,
  };
  const attestationHash = bucket1CanonicalHash(unsigned);
  const signature = createHmac("sha256", options.signer.secret)
    .update(attestationHash)
    .digest("hex");
  return { ...unsigned, attestationHash, signature };
}

function attestationDefect(
  id: string,
  cause: "attestation_contract" | "attestation_expired" | "attestation_binding_mismatch",
  observed: string,
  expected: string,
): Bucket1Defect {
  return defect({
    id,
    phase: "attestation",
    cause,
    classification: "candidate",
    disposition: "reject_attestation",
    observed,
    expected,
    region: { kind: "contract", id: "validation-attestation" },
  });
}

export function verifyBucket1ValidationAttestation(options: {
  input: Bucket1ValidationInput;
  attestation: Bucket1ValidationAttestation;
  now: Date;
  signer: Bucket1AttestationSigner;
}): Bucket1AttestationVerification {
  const { attestation } = options;
  const binding = attestation?.binding as unknown as Record<string, unknown> | undefined;
  const expectedKeys = [
    "schemaVersion",
    "kind",
    "binding",
    "runtimeEvidenceHash",
    "issuedAt",
    "expiresAt",
    "issuerKeyId",
    "attestationHash",
    "signature",
  ];
  if (
    !attestation ||
    !exactKeys(attestation as unknown as Record<string, unknown>, expectedKeys) ||
    attestation.schemaVersion !== BUCKET1_ATTESTATION_SCHEMA_VERSION ||
    attestation.kind !== "bucket1-validation-attestation" ||
    !binding ||
    !exactKeys(binding, BINDING_KEYS) ||
    !Number.isSafeInteger(binding.generationContractEpoch) ||
    (binding.generationContractEpoch as number) < 1 ||
    typeof binding.candidateRevision !== "string" ||
    !binding.candidateRevision ||
    binding.candidateRevision.length > 128 ||
    BINDING_HASH_KEYS.some(
      (key) => typeof binding[key] !== "string" || !SHA256_HEX.test(binding[key] as string),
    ) ||
    !SHA256_HEX.test(attestation.runtimeEvidenceHash) ||
    !SHA256_HEX.test(attestation.attestationHash) ||
    !SHA256_HEX.test(attestation.signature) ||
    attestation.issuerKeyId !== options.signer.keyId
  )
    return {
      ok: false,
      defects: [
        attestationDefect(
          "attestation:schema",
          "attestation_contract",
          "Malformed or unsupported attestation envelope.",
          "A closed Bucket 1 attestation schema v1 envelope.",
        ),
      ],
    };
  const issued = Date.parse(attestation.issuedAt);
  const expires = Date.parse(attestation.expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= issued ||
    expires - issued > BUCKET1_VALIDATION_LIMITS.attestationTtlMs
  )
    return {
      ok: false,
      defects: [
        attestationDefect(
          "attestation:window",
          "attestation_contract",
          `${attestation.issuedAt}..${attestation.expiresAt}`,
          "A valid bounded issuance window no longer than policy TTL.",
        ),
      ],
    };
  if (options.now.getTime() < issued || options.now.getTime() >= expires)
    return {
      ok: false,
      defects: [
        attestationDefect(
          "attestation:expired",
          "attestation_expired",
          options.now.toISOString(),
          `A verification time within [${attestation.issuedAt}, ${attestation.expiresAt}).`,
        ),
      ],
    };
  const { attestationHash: _hash, signature: _signature, ...payload } = attestation;
  if (bucket1CanonicalHash(payload) !== attestation.attestationHash)
    return {
      ok: false,
      defects: [
        attestationDefect(
          "attestation:hash",
          "attestation_contract",
          attestation.attestationHash,
          "The canonical attestation payload hash.",
        ),
      ],
    };
  const expectedSignature = createHmac("sha256", options.signer.secret)
    .update(attestation.attestationHash)
    .digest();
  const suppliedSignature = Buffer.from(attestation.signature, "hex");
  if (
    expectedSignature.byteLength !== suppliedSignature.byteLength ||
    !timingSafeEqual(expectedSignature, suppliedSignature)
  )
    return {
      ok: false,
      defects: [
        attestationDefect(
          "attestation:signature",
          "attestation_contract",
          "Invalid server attestation signature.",
          "A signature from the active server key.",
        ),
      ],
    };
  const cheap = validateBucket1CandidateStatic({ input: options.input });
  if (cheap.static.status === "failed") return { ok: false, defects: cheap.static.defects };
  const rebound = cheap.binding!;
  if (canonicalJson(rebound) !== canonicalJson(attestation.binding)) {
    const mismatchFields = Object.keys(rebound).filter(
      (key) =>
        (rebound as unknown as Record<string, unknown>)[key] !==
        (attestation.binding as unknown as Record<string, unknown>)[key],
    );
    return {
      ok: false,
      defects: [
        attestationDefect(
          "attestation:binding",
          "attestation_binding_mismatch",
          mismatchFields.join(", ") || "binding mismatch",
          "Every candidate config, source, manifest, attachment, plan, props, resource, host, runtime, and validator binding must match exactly.",
        ),
      ],
    };
  }
  return { ok: true, binding: rebound };
}
