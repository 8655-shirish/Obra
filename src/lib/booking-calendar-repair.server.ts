import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAdminSessionTokenHash } from "@/lib/auth/admin-session.server";

export type BookingCalendarRepairInput = {
  linkId?: string;
  expectedGeneration: number;
  reason: string;
  resolution?: {
    requestId: string;
    appointmentId: string;
    profileId: string;
    environment: "test" | "live";
    expectedVersion: number;
    destinationEpochId: string;
    destinationEpoch?: {
      connectionId: string;
      selectionId: string;
      revision: number;
      accountId: string;
      calendarId: string;
    };
    googleEventId: string;
    source:
      | { kind: "retained_outbox"; id: string }
      | {
          kind: "original_reservation_record";
          reference: string;
          sha256: string;
          recordedAt: string;
          appointmentId: string;
          accountId: string;
          calendarId: string;
        };
  };
};

export type BookingCalendarRepairContext = {
  appointmentId: string;
  profileId: string;
  environment: "test" | "live";
  reference: string;
  googleEventId: string;
  expectedVersion: number;
  expectedGeneration: number;
  appointmentState: string;
  calendarState: string;
  reviewState: string;
  linkId: string | null;
  reconcileStatus: string | null;
  cutoverEnabled: boolean;
  destinationEpochs: Array<{
    id: string;
    accountId: string;
    calendarId: string;
    revision: number;
    createdAt: string;
    retiredAt: string | null;
  }>;
};

export class BookingCalendarRepairError extends Error {
  constructor(
    readonly status: 400 | 401 | 409 | 500,
    message: string,
  ) {
    super(message);
  }
}

function repairFailure(error: { code?: string } | null): BookingCalendarRepairError {
  if (error?.code === "42501") return new BookingCalendarRepairError(401, "Unauthorized");
  if (error?.code === "22023") return new BookingCalendarRepairError(400, "Invalid repair request");
  if (error?.code && ["P0002", "40001", "23505"].includes(error.code)) {
    return new BookingCalendarRepairError(409, "Calendar repair state changed");
  }
  return new BookingCalendarRepairError(500, "Unable to requeue calendar repair");
}

/** Requeue only through the audited, service-role-only database authority. */
export async function requeueBookingCalendarManualRepair(
  request: Request,
  input: BookingCalendarRepairInput,
) {
  const actorTokenHash = await requireAdminSessionTokenHash(request).catch(() => {
    throw new BookingCalendarRepairError(401, "Unauthorized");
  });
  const { data, error } = await supabaseAdmin.rpc("requeue_booking_calendar_manual_repair", {
    p_link_id: input.linkId ?? null,
    p_expected_generation: input.expectedGeneration,
    p_actor_token_hash: actorTokenHash,
    p_reason: input.reason,
    ...(input.resolution ? { p_resolution: input.resolution } : {}),
  } as never);
  if (error) throw repairFailure(error);
  if (data !== true) throw repairFailure(null);
}

export async function getBookingCalendarRepairContext(request: Request, appointmentId: string) {
  const actorTokenHash = await requireAdminSessionTokenHash(request).catch(() => {
    throw new BookingCalendarRepairError(401, "Unauthorized");
  });
  const { data, error } = await supabaseAdmin.rpc(
    "get_booking_calendar_repair_context" as never,
    { p_appointment_id: appointmentId, p_actor_token_hash: actorTokenHash } as never,
  );
  if (error) throw repairFailure(error);
  if (!data) throw repairFailure({ code: "P0002" });
  return data as unknown as BookingCalendarRepairContext;
}
