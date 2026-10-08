import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectImageMimeType, validateDecodedImageBytes } from "@/lib/media/image-metadata";

const MAX_ATTACHMENT_BYTES = 10_485_760;
const MAX_FILES = 5;
const PROOF_TTL_MS = 24 * 60 * 60_000;
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const CLEAN_PROBE = "Obra booking attachment scanner clean proof v1";

const requestSchema = z.object({
  appointmentId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  base64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4),
  quotaSlot: z.number().int().min(1).max(MAX_FILES),
});

const listSchema = z.object({ appointmentIds: z.array(z.string().uuid()).max(25) });

export type BookingAttachmentCapability =
  | { enabled: true; maxFiles: 5; maxBytes: number; mimeTypes: string[] }
  | {
      enabled: false;
      reason:
        | "scanner_not_configured"
        | "scanner_not_proven"
        | "scanner_config_changed"
        | "upload_disabled";
    };

type ScannerVerdict = { clean: boolean; verdictId: string; sha256: string };

function attachmentEnvironment() {
  const environment = process.env["BOOKING_ATTACHMENT_ENVIRONMENT"]?.trim();
  return environment === "test" || environment === "live" ? environment : null;
}

function scannerConfiguration() {
  const provider = process.env["BOOKING_SCANNER_PROVIDER"]?.trim();
  const url = process.env["BOOKING_SCANNER_URL"]?.trim();
  const token = process.env["BOOKING_SCANNER_TOKEN"]?.trim();
  const credentialVersion = process.env["BOOKING_SCANNER_CREDENTIAL_VERSION"]?.trim();
  const allowedOrigin = process.env["BOOKING_SCANNER_ALLOWED_ORIGIN"]?.trim();
  const environment = attachmentEnvironment();
  if (!provider || !url || !token || !credentialVersion || !allowedOrigin || !environment)
    return null;
  let normalizedUrl: string;
  try {
    const parsed = new URL(url);
    const allowed = new URL(allowedOrigin);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if ((parsed.protocol !== "https:" && !local) || parsed.origin !== allowed.origin) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    normalizedUrl = parsed.toString();
  } catch {
    return null;
  }
  // Rotate this non-secret version whenever credentials change; secrets never enter persisted evidence.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({ provider, url: normalizedUrl, environment, credentialVersion, contract: 1 }),
    )
    .digest("hex");
  return { provider, url: normalizedUrl, token, environment, fingerprint };
}

function secretMatches(actual: string | null, expected: string) {
  if (actual === null) return false;
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256")
    .update("Bearer " + expected)
    .digest();
  return timingSafeEqual(left, right);
}

async function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function scanBytes(bytes: Uint8Array, mimeType: string): Promise<ScannerVerdict> {
  const config = scannerConfiguration();
  if (!config) throw new Error("Attachment scanner is unavailable");
  const { workerProviderFetch } = await import("@/lib/worker-deadline.server");
  const response = await workerProviderFetch(config.url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.token,
      "Content-Type": mimeType,
      "X-Obra-Content-SHA256": await checksum(bytes),
    },
    body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }),
    // redirect:"manual" (Workers rejects "error"); non-ok fails closed below.
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!response.ok || raw.length > 16_384) throw new Error("Attachment scanner is unavailable");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Attachment scanner is unavailable");
  }
  const expectedSha256 = await checksum(bytes);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { clean?: unknown }).clean !== "boolean" ||
    typeof (parsed as { verdictId?: unknown }).verdictId !== "string" ||
    !(parsed as { verdictId: string }).verdictId.trim() ||
    (parsed as { verdictId: string }).verdictId.length > 200 ||
    (parsed as { sha256?: unknown }).sha256 !== expectedSha256
  )
    throw new Error("Attachment scanner is unavailable");
  return {
    clean: (parsed as { clean: boolean }).clean,
    verdictId: (parsed as { verdictId: string }).verdictId,
    sha256: expectedSha256,
  };
}

async function capability(): Promise<BookingAttachmentCapability> {
  const config = scannerConfiguration();
  if (!config) return { enabled: false, reason: "scanner_not_configured" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("booking_attachment_security_v3" as never)
    .select("scanner_provider,clean_proven_at,upload_enabled")
    .eq("environment", config.environment)
    .eq("config_fingerprint", config.fingerprint)
    .maybeSingle();
  if (error || !data) return { enabled: false, reason: "scanner_not_configured" };
  const security = data as unknown as {
    clean_proven_at?: string;
    scanner_provider: string;
    upload_enabled: boolean;
  };
  if (!security.scanner_provider) return { enabled: false, reason: "scanner_not_configured" };
  const { data: ready, error: readyError } = await supabaseAdmin.rpc(
    "booking_attachment_scanner_ready_v3" as never,
    { p_config_fingerprint: config.fingerprint, p_environment: config.environment } as never,
  );
  if (readyError || ready !== true) {
    if (security.clean_proven_at && security.scanner_provider === config.provider)
      return { enabled: false, reason: "scanner_config_changed" };
    return { enabled: false, reason: "scanner_not_proven" };
  }
  if (!security.upload_enabled) return { enabled: false, reason: "upload_disabled" };
  return {
    enabled: true,
    maxFiles: MAX_FILES,
    maxBytes: MAX_ATTACHMENT_BYTES,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  };
}

export const getBookingAttachmentCapability = createServerFn({ method: "GET" }).handler(capability);

export const proveBookingAttachmentScanner = createServerFn({ method: "POST" }).handler(
  async () => {
    const expected = process.env["BOOKING_SCANNER_PROOF_SECRET"]?.trim();
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!expected || !secretMatches(getRequest()?.headers.get("authorization") ?? null, expected))
      throw new Error("Unauthorized");
    const config = scannerConfiguration();
    if (!config) throw new Error("Attachment scanner is unavailable");
    const cleanBytes = new TextEncoder().encode(CLEAN_PROBE);
    const eicarBytes = new TextEncoder().encode(EICAR);
    const [clean, eicar] = await Promise.all([
      scanBytes(cleanBytes, "text/plain"),
      scanBytes(eicarBytes, "text/plain"),
    ]);
    if (!clean.clean || eicar.clean) throw new Error("Attachment scanner proof failed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc(
      "record_booking_attachment_scanner_proof_v3" as never,
      {
        p_provider: config.provider,
        p_environment: config.environment,
        p_config_fingerprint: config.fingerprint,
        p_clean_was_clean: true,
        p_eicar_was_rejected: true,
        p_clean_checksum: await checksum(cleanBytes),
        p_eicar_checksum: await checksum(eicarBytes),
        p_clean_verdict_id: clean.verdictId,
        p_eicar_verdict_id: eicar.verdictId,
      } as never,
    );
    if (error) throw new Error("Unable to record scanner proof");
    return {
      proven: true as const,
      fingerprint: config.fingerprint,
      expiresInSeconds: PROOF_TTL_MS / 1000,
    };
  },
);

type PreparedAttachment = {
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  base64: string;
};

function uuidFromHash(value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    "a" + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

export async function uploadPreparedBookingAttachments(input: {
  appointmentId: string;
  contextId: string;
  contextToken: string;
  attachments: PreparedAttachment[];
}) {
  const config = scannerConfiguration();
  if (!config || !(await capability()).enabled) throw new Error("Attachment upload is unavailable");
  const parsed = z
    .object({
      appointmentId: z.string().uuid(),
      contextId: z.string().uuid(),
      contextToken: z.string().min(40).max(256),
      attachments: z
        .array(requestSchema.omit({ appointmentId: true, quotaSlot: true }))
        .min(1)
        .max(MAX_FILES),
    })
    .parse(input);
  const prepared = await Promise.all(
    parsed.attachments.map(async (attachment, index) => {
      const bytes = Uint8Array.from(atob(attachment.base64), (value) => value.charCodeAt(0));
      if (bytes.byteLength !== attachment.byteSize)
        throw new Error("Attachment size does not match bytes");
      const detected = detectImageMimeType(bytes);
      if (detected !== attachment.mimeType || !(await validateDecodedImageBytes(bytes)))
        throw new Error("Attachment is not a valid supported image");
      const digest = await checksum(bytes);
      const quotaSlot = index + 1;
      const identity = parsed.contextId + ":" + quotaSlot + ":" + digest;
      const attachmentId = uuidFromHash("attachment:" + identity);
      const requestId = uuidFromHash("request:" + identity);
      const grantId = uuidFromHash("grant:" + identity);
      const token = createHmac("sha256", parsed.contextToken)
        .update("upload:" + identity)
        .digest("base64url");
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            attachmentId,
            quotaSlot,
            digest,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
          }),
        )
        .digest("hex");
      return {
        attachment,
        bytes,
        digest,
        quotaSlot,
        attachmentId,
        requestId,
        grantId,
        token,
        requestHash,
        displayFilename: attachment.filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120),
      };
    }),
  );
  const totalBytes = prepared.reduce((total, item) => total + item.attachment.byteSize, 0);
  if (totalBytes > MAX_FILES * MAX_ATTACHMENT_BYTES)
    throw new Error("Attachment aggregate limit exceeded");
  const contextRequestHash = createHash("sha256")
    .update(
      JSON.stringify(
        prepared.map((item) => ({
          attachmentId: item.attachmentId,
          quotaSlot: item.quotaSlot,
          requestHash: item.requestHash,
        })),
      ),
    )
    .digest("hex");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: prepareError } = await supabaseAdmin.rpc(
    "prepare_booking_attachment_uploads_v3" as never,
    {
      p_context_id: parsed.contextId,
      p_appointment_id: parsed.appointmentId,
      p_context_token_hash: createHash("sha256").update(parsed.contextToken).digest("hex"),
      p_request_hash: contextRequestHash,
      p_manifest: prepared.map((item) => ({
        attachmentId: item.attachmentId,
        grantId: item.grantId,
        requestId: item.requestId,
        quotaSlot: item.quotaSlot,
        filename: item.attachment.filename,
        displayFilename: item.displayFilename,
        mimeType: item.attachment.mimeType,
        byteSize: item.attachment.byteSize,
        checksum: item.digest,
        tokenHash: createHash("sha256").update(item.token).digest("hex"),
        requestHash: item.requestHash,
      })),
    } as never,
  );
  if (prepareError) throw new Error("Attachment upload is unavailable");
  const results: unknown[] = [];
  for (const item of prepared) {
    const tokenHash = createHash("sha256").update(item.token).digest("hex");
    const { data: grant, error: grantError } = await supabaseAdmin.rpc(
      "begin_booking_attachment_upload_v3" as never,
      {
        p_token_hash: tokenHash,
        p_request_id: item.requestId,
        p_request_hash: item.requestHash,
      } as never,
    );
    if (grantError || !grant) throw new Error("Attachment upload grant is unavailable");
    const typed = grant as unknown as { storageObjectKey: string; state: string };
    if (typed.state !== "uploaded") {
      const { error: uploadError } = await supabaseAdmin.storage
        .from("booking-attachments")
        .upload(typed.storageObjectKey, item.bytes, {
          contentType: item.attachment.mimeType,
          upsert: false,
        });
      if (uploadError && !/already exists/i.test(uploadError.message))
        throw new Error("Unable to store attachment");
    }
    const { data: finalized, error: finalizeError } = await supabaseAdmin.rpc(
      "finalize_booking_attachment_upload_v3" as never,
      {
        p_token_hash: tokenHash,
        p_request_id: item.requestId,
        p_request_hash: item.requestHash,
      } as never,
    );
    if (finalizeError || !finalized) throw new Error("Unable to finalize attachment upload");
    results.push(finalized);
  }
  return results;
}

export async function processBookingAttachmentScans(environment: "test" | "live", _limit = 1) {
  const { workerCanContinue, WorkerDeadlineError } = await import("@/lib/worker-deadline.server");
  if (!workerCanContinue()) throw new WorkerDeadlineError();
  const config = scannerConfiguration();
  if (!config || config.environment !== environment || !(await capability()).enabled)
    return { processed: 0, disabled: true as const };
  const { bookingWorker } = await import("@/integrations/supabase/booking-worker.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const lease = crypto.randomUUID();
  const { data: due, error } = await bookingWorker.rpc(
    "claim_due_booking_attachment_scans_v3" as never,
    {
      p_environment: environment,
      p_lease_token: lease,
      // One thirty-second scanner call fits the 55-second family lease without takeover overlap.
      p_limit: 1,
    } as never,
  );
  if (error) throw new Error("Unable to load attachment scans");
  let processed = 0;
  for (const attachment of (due ?? []) as unknown as Array<{
    attachment_id: string;
    generation: number;
    storage_object_key: string;
    mime_type: string;
    checksum: string;
    scan_fencing_token: number;
  }>) {
    if (!workerCanContinue()) break;
    let providerVerdictObtained = false;
    try {
      const { data: object, error: downloadError } = await supabaseAdmin.storage
        .from("booking-attachments")
        .download(attachment.storage_object_key);
      if (downloadError || !object) throw new Error("Attachment bytes unavailable");
      const bytes = new Uint8Array(await object.arrayBuffer());
      const digest = await checksum(bytes);
      if (digest !== attachment.checksum) throw new Error("Attachment digest mismatch");
      const verdict = await scanBytes(bytes, attachment.mime_type);
      providerVerdictObtained = true;
      const { data: completed, error: completionError } = await bookingWorker.rpc(
        "complete_booking_attachment_scan_v3" as never,
        {
          p_attachment_id: attachment.attachment_id,
          p_generation: attachment.generation,
          p_environment: environment,
          p_lease_token: lease,
          p_fencing_token: attachment.scan_fencing_token,
          p_outcome: verdict.clean ? "clean" : "rejected",
          p_safe_error: verdict.clean ? null : "Malware scanner rejected attachment",
          p_config_fingerprint: config.fingerprint,
          p_scanned_checksum: digest,
          p_scanner_verdict_id: verdict.verdictId,
        } as never,
      );
      if (completionError || !completed) throw new Error("Unable to record scan verdict");
      processed++;
    } catch {
      // A durable scanner verdict must never be contradicted by fabricated outage evidence.
      // Response loss is reconciled by the same generation after this lease expires.
      if (providerVerdictObtained) continue;
      const { data: failed, error: failureError } = await bookingWorker.rpc(
        "complete_booking_attachment_scan_v3" as never,
        {
          p_attachment_id: attachment.attachment_id,
          p_generation: attachment.generation,
          p_environment: environment,
          p_lease_token: lease,
          p_fencing_token: attachment.scan_fencing_token,
          p_outcome: "scanner_unavailable",
          p_safe_error: "Attachment scanner unavailable",
          p_config_fingerprint: config.fingerprint,
          p_scanned_checksum: attachment.checksum,
          p_scanner_verdict_id: null,
        } as never,
      );
      if (failureError) throw new Error("Unable to record scanner outage");
      if (!failed) continue;
    }
  }
  return { processed };
}

export const listCleanBookingAttachments = createServerFn({ method: "GET" })
  .validator((input: unknown) => listSchema.parse(input))
  .handler(async ({ data }) => {
    const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
    const actor = await getContractorAuthUserId();
    if (!actor) throw new Error("Unauthorized");
    if (!data.appointmentIds.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc(
      "list_clean_contractor_booking_attachments_v3" as never,
      { p_actor_auth_user_id: actor, p_appointment_ids: data.appointmentIds } as never,
    );
    if (error) throw new Error("Unable to load booking attachments");
    return (rows ?? []) as unknown as Array<{
      id: string;
      appointment_id: string;
      display_filename: string;
      mime_type: string;
      byte_size: number;
      finalized_at: string;
    }>;
  });

function downloadSecret() {
  const secret = process.env["BOOKING_ATTACHMENT_DOWNLOAD_SECRET"]?.trim();
  if (!secret) throw new Error("Attachment download is unavailable");
  return secret;
}

async function authorizeAndSignDownload(attachmentId: string, actor: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc(
    "authorize_booking_attachment_download_v3" as never,
    {
      p_actor_auth_user_id: actor,
      p_attachment_id: attachmentId,
      p_generation: null,
    } as never,
  );
  const item = Array.isArray(data) ? data[0] : data;
  if (error || !item) throw new Error("Attachment not found");
  const typed = item as unknown as {
    storage_object_key: string;
    display_filename: string;
    mime_type: string;
  };
  const { data: signed, error: signedError } = await supabaseAdmin.storage
    .from("booking-attachments")
    .createSignedUrl(typed.storage_object_key, 60, { download: typed.display_filename });
  if (signedError || !signed?.signedUrl) throw new Error("Attachment download is unavailable");
  return { url: signed.signedUrl, filename: typed.display_filename, mimeType: typed.mime_type };
}

export const issueBookingAttachmentDownload = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ attachmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
    const actor = await getContractorAuthUserId();
    if (!actor) throw new Error("Unauthorized");
    await authorizeAndSignDownload(data.attachmentId, actor);
    const payload = Buffer.from(
      JSON.stringify({ attachmentId: data.attachmentId, actor, expiresAt: Date.now() + 60_000 }),
    ).toString("base64url");
    const signature = createHmac("sha256", downloadSecret()).update(payload).digest("base64url");
    return {
      route:
        "/api/booking/attachments/" +
        data.attachmentId +
        "/download?token=" +
        payload +
        "." +
        signature,
    };
  });

export async function resolveBookingAttachmentDownloadToken(input: {
  attachmentId: string;
  token: string;
}) {
  const parsed = z
    .object({ attachmentId: z.string().uuid(), token: z.string().max(2048) })
    .parse(input);
  const [payload, signature, extra] = parsed.token.split(".");
  if (!payload || !signature || extra) throw new Error("Attachment not found");
  const expected = createHmac("sha256", downloadSecret()).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Attachment not found");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Attachment not found");
  }
  const valid = z
    .object({
      attachmentId: z.string().uuid(),
      actor: z.string().uuid(),
      expiresAt: z.number().int(),
    })
    .safeParse(claims);
  if (
    !valid.success ||
    valid.data.attachmentId !== parsed.attachmentId ||
    valid.data.expiresAt <= Date.now() ||
    valid.data.expiresAt > Date.now() + 65_000
  )
    throw new Error("Attachment not found");
  return authorizeAndSignDownload(parsed.attachmentId, valid.data.actor);
}

export async function cleanupBookingAttachments(
  environment: "test" | "live",
  options: { limit?: number; discover?: boolean } = {},
) {
  const { workerCanContinue, WorkerDeadlineError } = await import("@/lib/worker-deadline.server");
  if (!workerCanContinue()) throw new WorkerDeadlineError();
  // Keep the sequential physical-delete batch well inside both the DB and family leases.
  const bounded = Math.max(1, Math.min(options.limit ?? 5, 10));
  const lease = crypto.randomUUID();
  const { bookingWorker } = await import("@/integrations/supabase/booking-worker.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await bookingWorker.rpc(
    "claim_booking_attachment_cleanup_v3" as never,
    {
      p_environment: environment,
      p_lease_token: lease,
      p_limit: bounded,
      p_discover: options.discover ?? true,
    } as never,
  );
  if (error) throw new Error("Unable to claim attachment cleanup");
  const candidates = (data ?? []) as unknown as Array<{
    attachment_id: string;
    generation: number;
    storage_object_key: string;
    deletion_fencing_token: number;
  }>;
  let deleted = 0;
  for (const candidate of candidates) {
    if (!workerCanContinue()) break;
    const { data: authorized, error: authorizationError } = await bookingWorker.rpc(
      "authorize_booking_attachment_cleanup_v3",
      {
        p_attachment_id: candidate.attachment_id,
        p_generation: candidate.generation,
        p_environment: environment,
        p_lease_token: lease,
        p_fencing_token: candidate.deletion_fencing_token,
      },
    );
    if (authorizationError) throw new Error("Unable to authorize attachment cleanup");
    if (authorized !== true) continue;
    const { error: removeError } = await supabaseAdmin.storage
      .from("booking-attachments")
      .remove([candidate.storage_object_key]);
    let absentAfterRemove = !removeError;
    if (removeError) {
      const separator = candidate.storage_object_key.lastIndexOf("/");
      const objectName = candidate.storage_object_key.slice(separator + 1);
      const listing = await supabaseAdmin.storage
        .from("booking-attachments")
        .list(candidate.storage_object_key.slice(0, separator), { search: objectName, limit: 1 });
      absentAfterRemove = !listing.error && !listing.data?.some((item) => item.name === objectName);
    }
    const { data: completed, error: completionError } = await bookingWorker.rpc(
      "complete_booking_attachment_cleanup_v3" as never,
      {
        p_attachment_id: candidate.attachment_id,
        p_generation: candidate.generation,
        p_environment: environment,
        p_lease_token: lease,
        p_fencing_token: candidate.deletion_fencing_token,
        p_object_removed: absentAfterRemove,
      } as never,
    );
    if (completionError) throw new Error("Unable to settle attachment cleanup");
    if (absentAfterRemove && completed === true) deleted++;
    else if (absentAfterRemove) throw new Error("Attachment cleanup was not settled");
  }
  return { claimed: candidates.length, deleted };
}
