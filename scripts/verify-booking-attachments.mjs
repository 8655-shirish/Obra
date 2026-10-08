import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const requireText = (path, values) => {
  const text = read(path);
  for (const value of values)
    if (!text.includes(value)) throw new Error(path + " missing " + value);
};
const migration = "supabase/migrations/20260829093923_booking_customer_lifecycle_closure.sql";
const matching = readdirSync("supabase/migrations").filter((name) =>
  name.startsWith("20260829093923"),
);
if (
  matching.length !== 1 ||
  matching[0] !== "20260829093923_booking_customer_lifecycle_closure.sql"
)
  throw new Error("expected exactly one 20260829093923 lifecycle closure migration");

requireText(migration, [
  "clean_proven_at",
  "eicar_proven_at",
  "proof_expires_at",
  "record_booking_attachment_scanner_proof_v3",
  "not p_clean_was_clean or not p_eicar_was_rejected",
  "booking_attachment_scanner_ready_v3",
  "proof_expires_at>pg_catalog.clock_timestamp()",
  "complete_booking_attachment_scan_v3",
  "attachment scan digest mismatch",
  "p_scanned_checksum",
  "list_clean_contractor_booking_attachments_v3",
  "o.object_state='clean'",
  "authorize_booking_attachment_download_v3",
  "booking_attachment_audit_events",
  "legal_hold_at",
  "claim_booking_attachment_cleanup_v3",
  "authorize_booking_attachment_cleanup_v3",
  "deletion_authorized_at",
  "attachment scanner is not ready",
  "from public,anon,authenticated,service_role,booking_worker",
  "p_limit integer default 10",
  "production_approved",
  "deletion_mode='automatic'",
  "complete_booking_attachment_cleanup_v3",
  "p_object_removed",
]);

requireText("src/lib/booking-attachments.functions.ts", [
  "BOOKING_SCANNER_ALLOWED_ORIGIN",
  "BOOKING_SCANNER_CREDENTIAL_VERSION",
  "parsed.origin !== allowed.origin",
  'redirect: "manual"',
  "AbortSignal.timeout(30_000)",
  "raw.length > 16_384",
  "sha256 !== expectedSha256",
  "BOOKING_SCANNER_PROOF_SECRET",
  "clean.clean || eicar.clean",
  "record_booking_attachment_scanner_proof",
  "complete_booking_attachment_scan_v3",
  "digest !== attachment.checksum",
  "list_clean_contractor_booking_attachments_v3",
  "createSignedUrl(typed.storage_object_key, 60",
  "BOOKING_ATTACHMENT_DOWNLOAD_SECRET",
  "timingSafeEqual(actual, expected)",
  "claim_booking_attachment_cleanup_v3",
  "authorize_booking_attachment_cleanup_v3",
  "Unable to authorize attachment cleanup",
  "Math.max(1, Math.min(options.limit ?? 5, 10))",
]);

requireText("src/lib/booking-live.functions.ts", [
  "Optional file bytes never participate in booking idempotency or payment admission.",
  "const { attachments: _attachments, ...booking } = data",
  "await uploadOptionalBookingAttachments(appointmentId, data.attachments, {",
  'throw new Error("Booking attachments are temporarily unavailable")',
  "uploadPreparedBookingAttachments",
]);
requireText("src/lib/bookings.functions.ts", [
  "listCleanBookingAttachments",
  "booking_attachments: attachmentsByAppointment.get(row.id) ?? []",
]);
requireText("src/routes/bookings.tsx", ["Customer images:", "issueBookingAttachmentDownload"]);
requireText("src/routes/api/booking/attachments/proof.ts", ["proveBookingAttachmentScanner"]);
requireText("src/routes/api/booking/attachments/$attachmentId/download.ts", [
  "resolveBookingAttachmentDownloadToken",
  "Response.redirect(download.url, 302)",
]);
requireText("src/routes/api/cron/booking.ts", [
  "cleanupBookingAttachments",
  '"attachment_cleanup"',
]);

console.log("booking attachment lifecycle verifier passed");
