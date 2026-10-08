import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const eventSchema = z.object({
  type: z.enum([
    "email.delivered",
    "email.delivery_delayed",
    "email.bounced",
    "email.complained",
    "email.failed",
  ]),
  created_at: z.string().datetime(),
  data: z.object({ email_id: z.string().min(8).max(200) }),
});

function signed(secret: string, id: string, timestamp: string, body: string, signature: string) {
  const encodedKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(encodedKey, "base64");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", key)
    .update(id + "." + timestamp + "." + body)
    .digest("base64");
  return signature.split(" ").some((candidate) => {
    const supplied = candidate.replace(/^v1,/, "").trim();
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export const Route = createFileRoute("/api/resend/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["RESEND_WEBHOOK_SECRET"]?.trim();
        const eventId = request.headers.get("svix-id")?.trim() ?? "";
        const timestamp = request.headers.get("svix-timestamp")?.trim() ?? "";
        const signature = request.headers.get("svix-signature")?.trim() ?? "";
        if (!secret || !eventId || !timestamp || !signature)
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        const seconds = Number(timestamp);
        if (!Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300)
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        const body = await request.text();
        if (body.length > 64 * 1024 || !signed(secret, eventId, timestamp, body, signature))
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        let payload: unknown;
        try {
          payload = JSON.parse(body) as unknown;
        } catch {
          return Response.json({ error: "Invalid payload" }, { status: 400 });
        }
        const parsed = eventSchema.safeParse(payload);
        if (!parsed.success) return Response.json({ error: "Unsupported event" }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc(
          "ingest_booking_notification_delivery" as never,
          {
            p_provider_event_id: eventId,
            p_provider_message_id: parsed.data.data.email_id,
            p_event_type: parsed.data.type,
            p_occurred_at: parsed.data.created_at,
          } as never,
        );
        if (error) return Response.json({ error: "Ingestion failed" }, { status: 500 });
        return Response.json({ received: true, matched: Boolean(data) });
      },
    },
  },
});
