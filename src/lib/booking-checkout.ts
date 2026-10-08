import { z } from "zod";
import {
  BOOKING_CONSENT_DIGEST,
  BOOKING_CONSENT_DOCUMENT_ID,
  BOOKING_CONSENT_VERSION,
} from "@/lib/booking-consent";

export const checkoutSchema = z.object({
  websiteId: z.string().uuid(),
  startAt: z.string().datetime(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localStart: z.string().regex(/^\d{2}:\d{2}$/),
  timeZone: z.string().min(1).max(100),
  observedAt: z.string().datetime(),
  availabilityGeneration: z.number().int().nonnegative(),
  calendarSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
  consent: z.object({
    accepted: z.literal(true),
    documentId: z.literal(BOOKING_CONSENT_DOCUMENT_ID),
    version: z.literal(BOOKING_CONSENT_VERSION),
    digest: z.literal(BOOKING_CONSENT_DIGEST),
  }),
  customer: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(7).max(40),
    address: z.object({
      line1: z.string().trim().min(2).max(160),
      line2: z.string().trim().max(160).optional(),
      city: z.string().trim().min(2).max(100),
      region: z.string().trim().min(2).max(100),
      postalCode: z.string().trim().min(2).max(24),
    }),
    notes: z.string().trim().max(2000).optional(),
  }),
  // Optional payloads are validated independently after the reservation succeeds.
  attachments: z.unknown().optional(),
});

export const checkoutResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("checkout_ready"),
      checkoutUrl: z.string().url(),
      expiresAt: z.string().datetime(),
    })
    .strict(),
  // This invocation did not call reservation. An earlier lost request may still do so.
  z
    .object({
      status: z.literal("not_attempted"),
      code: z.enum(["slot_unavailable", "booking_unavailable"]),
    })
    .strict(),
]);

export type BookingCheckoutRequest = z.infer<typeof checkoutSchema>;
export type BookingCheckoutResult = z.infer<typeof checkoutResultSchema>;
