import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const repairSchema = z
  .object({
    linkId: z.string().uuid().optional(),
    expectedGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    reason: z.string().trim().min(3).max(500),
    resolution: z
      .object({
        requestId: z.string().uuid(),
        appointmentId: z.string().uuid(),
        profileId: z.string().uuid(),
        environment: z.enum(["test", "live"]),
        expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        destinationEpochId: z.string().uuid(),
        destinationEpoch: z
          .object({
            connectionId: z.string().uuid(),
            selectionId: z.string().uuid(),
            revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            accountId: z.string().regex(/^apn_[A-Za-z0-9_-]+$/),
            calendarId: z.string().min(1).max(1024),
          })
          .strict()
          .optional(),
        googleEventId: z.string().regex(/^[0-9a-v]{5,1024}$/),
        source: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("retained_outbox"), id: z.string().uuid() }).strict(),
          z
            .object({
              kind: z.literal("original_reservation_record"),
              reference: z.string().trim().min(3).max(500),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              recordedAt: z.string().datetime({ offset: true }),
              appointmentId: z.string().uuid(),
              accountId: z.string().regex(/^apn_[A-Za-z0-9_-]+$/),
              calendarId: z.string().min(1).max(1024),
            })
            .strict(),
        ]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.linkId) !== Boolean(value.resolution));

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/admin/calendar-repair")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const appointmentId = z
          .string()
          .uuid()
          .safeParse(new URL(request.url).searchParams.get("appointmentId"));
        if (!appointmentId.success) return json({ error: "Invalid appointment" }, 400);
        const { getBookingCalendarRepairContext, BookingCalendarRepairError } =
          await import("@/lib/booking-calendar-repair.server");
        try {
          return json(await getBookingCalendarRepairContext(request, appointmentId.data), 200);
        } catch (error) {
          return error instanceof BookingCalendarRepairError
            ? json({ error: error.message }, error.status)
            : json({ error: "Unable to load calendar repair" }, 500);
        }
      },
      POST: async ({ request }) => {
        const { assertAdminSameOriginMutation } = await import("@/lib/auth/admin-session.server");
        try {
          assertAdminSameOriginMutation(request);
        } catch {
          return json({ error: "Forbidden" }, 403);
        }

        let input: z.infer<typeof repairSchema>;
        try {
          input = repairSchema.parse(await request.json());
        } catch {
          return json({ error: "Invalid repair request" }, 400);
        }

        try {
          const { requeueBookingCalendarManualRepair } =
            await import("@/lib/booking-calendar-repair.server");
          await requeueBookingCalendarManualRepair(request, input);
          return json({ requeued: true }, 200);
        } catch (error) {
          const { BookingCalendarRepairError } =
            await import("@/lib/booking-calendar-repair.server");
          if (error instanceof BookingCalendarRepairError) {
            return json({ error: error.message }, error.status);
          }
          return json({ error: "Unable to requeue calendar repair" }, 500);
        }
      },
    },
  },
});
