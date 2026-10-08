import assert from "node:assert/strict";
import fs from "node:fs";
const sql = fs.readFileSync(
  "supabase/migrations/20260829093904_bucket1_audit_hardening.sql",
  "utf8",
);
const attachment = fs.readFileSync("src/lib/booking-attachments.functions.ts", "utf8");
const dbTest = fs.readFileSync("supabase/tests/bucket1-foundation.sql", "utf8");
for (const fragment of [
  "booking-attachments','booking-attachments',false",
  "can_read_clean_booking_attachment",
  "booking_attachment_security",
  "attachment scanner is not proven",
  "claim_booking_attachment_scan",
  "stale attachment scan fence",
  "data_retention_policies",
  "production_approved",
  "offboard_starter_leads",
  "purge_retained_leads",
  "lead_governance_events",
]) {
  assert.ok(sql.includes(fragment), `missing governance contract: ${fragment}`);
}
assert.doesNotMatch(sql, /create policy booking_attachments_.* for insert/i);
for (const currentAttachmentContract of [
  /enabled:\s*false/,
  /reason:\s*"scanner_not_configured"/,
  /reason:\s*"scanner_config_changed"/,
  /reason:\s*"scanner_not_proven"/,
  /reason:\s*"upload_disabled"/,
  /booking_attachment_scanner_ready/,
  /BOOKING_ATTACHMENT_ENVIRONMENT/,
  /scanner_unavailable/,
]) {
  assert.match(attachment, currentAttachmentContract);
}
for (const fragment of [
  "cross tenant transition allowed",
  "stale revision transition allowed",
  "provider lease fence",
  "unapproved retention purge allowed",
  "private attachment bucket",
]) {
  assert.ok(dbTest.includes(fragment), `missing database behavior: ${fragment}`);
}
console.log("verify-bucket1-governance: ok");
