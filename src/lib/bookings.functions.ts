import { createHash, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getImpersonationProfileId, isAdminSessionValid } from "@/lib/auth/admin-session.server";
import { withSemanticTypes } from "@/integrations/supabase/semantic-client";
import { getContractorAuthUserId } from "@/lib/auth/contractor-session.server";
import { findProfileByAuthUserId } from "@/lib/auth/profile.server";

async function context(allowReadOnlyImpersonation = false) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const impersonatedProfileId = await getImpersonationProfileId();
  if ((await isAdminSessionValid()) && impersonatedProfileId) {
    if (!allowReadOnlyImpersonation)
      throw new Error("Booking cancellation is unavailable while impersonating");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", impersonatedProfileId)
      .single();
    if (!profile) throw new Error("Forbidden");
    return { actor: null, profile, supabaseAdmin };
  }
  const actor = await getContractorAuthUserId();
  if (!actor) throw new Error("Unauthorized");
  const profile = await findProfileByAuthUserId(supabaseAdmin, actor);
  if (!profile) throw new Error("Forbidden");
  return { actor, profile, supabaseAdmin };
}
export const getBookingsPage = createServerFn({ method: "GET" })
  .validator((value: unknown) =>
    z
      .object({
        view: z.enum(["future", "past"]).default("future"),
        cursorStartAt: z.string().datetime().optional(),
        cursorId: z.string().uuid().optional(),
      })
      .refine((input) => Boolean(input.cursorStartAt) === Boolean(input.cursorId), {
        message: "Incomplete bookings cursor",
      })
      .parse(value ?? {}),
  )
  .handler(async ({ data }) => {
    const { profile, supabaseAdmin } = await context(true);
    const now = new Date().toISOString();
    let query = supabaseAdmin
      .from("appointments")
      .select(
        "id,website_id,public_reference,start_at,end_at,time_zone,customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,appointment_state,payment_state,refund_state,calendar_state,review_state,created_at,cancelled_at,booking_payments(amount_paid_minor,amount_refunded_minor,paid_at,refunded_at),websites(id)",
      )
      .eq("profile_id", profile.id)
      .eq("environment", profile.environment)
      .in("appointment_state", ["confirmed", "cancelled"])
      .order("start_at", { ascending: data.view === "future" })
      .order("id", { ascending: data.view === "future" })
      .limit(26);
    query = data.view === "future" ? query.gt("end_at", now) : query.lte("end_at", now);
    if (data.cursorStartAt && data.cursorId) {
      const operator = data.view === "future" ? "gt" : "lt";
      query = query.or(
        `start_at.${operator}.${data.cursorStartAt},and(start_at.eq.${data.cursorStartAt},id.${operator}.${data.cursorId})`,
      );
    }
    const { data: loadedRows, error } = await query;
    const rows = loadedRows?.slice(0, 25) ?? [];
    const cursorRow = loadedRows && loadedRows.length > 25 ? rows.at(-1) : null;
    if (error) throw new Error("Unable to load bookings");
    const { listCleanBookingAttachments } = await import("@/lib/booking-attachments.functions");
    const attachments = rows.length
      ? await listCleanBookingAttachments({ data: { appointmentIds: rows.map((row) => row.id) } })
      : [];
    const attachmentsByAppointment = new Map<string, typeof attachments>();
    for (const attachment of attachments) {
      const current = attachmentsByAppointment.get(attachment.appointment_id) ?? [];
      current.push(attachment);
      attachmentsByAppointment.set(attachment.appointment_id, current);
    }
    const rowsWithAttachments = rows.map((row) => ({
      ...row,
      booking_attachments: attachmentsByAppointment.get(row.id) ?? [],
    }));
    const { data: anyWebsite } = await supabaseAdmin
      .from("websites")
      .select("id")
      .eq("user_id", profile.id)
      .eq("environment", profile.environment)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    return {
      rows: rowsWithAttachments,
      view: data.view,
      nextCursor: cursorRow ? { startAt: cursorRow.start_at, id: cursorRow.id } : null,
      availabilityWebsiteId: rows[0]?.website_id ?? anyWebsite?.id ?? null,
      profileId: profile.id,
    };
  });
export const cancelBooking = createServerFn({ method: "POST" })
  .validator((value: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        requestId: z
          .string()
          .uuid()
          .default(() => randomUUID()),
      })
      .parse(value),
  )
  .handler(async ({ data }) => {
    const { actor, profile, supabaseAdmin } = await context();
    if (!actor) throw new Error("Unauthorized");
    const requestHash = createHash("sha256").update(data.appointmentId).digest("hex");
    const { data: appointment, error } = await withSemanticTypes(supabaseAdmin).rpc(
      "cancel_contractor_booking",
      {
        p_appointment_id: data.appointmentId,
        p_profile_id: profile.id,
        p_environment: profile.environment,
        p_actor_auth_user_id: actor,
        p_client_request_id: data.requestId,
        p_request_hash: requestHash,
      },
    );
    if (error || !appointment) throw new Error("Unable to cancel this booking");
    return appointment;
  });
