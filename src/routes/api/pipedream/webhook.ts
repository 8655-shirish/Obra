import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

import { parsePipedreamTriggerEvent } from "@/lib/pipedream-trigger-event";
import { verifyPipedreamSignature } from "@/lib/pipedream-webhook-signature.server";

export const Route = createFileRoute("/api/pipedream/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signatureHeader = request.headers.get("x-pd-signature")?.trim() ?? "";
        const url = new URL(request.url);
        const environment = url.searchParams.get("environment") ?? "";
        const bindingId = url.searchParams.get("binding_id") ?? "";
        const accountId = url.searchParams.get("account_id") ?? "";
        const triggerId = url.searchParams.get("trigger_id") ?? "";
        const correlationId = url.searchParams.get("correlation_id") ?? "";
        if (environment !== "test" && environment !== "live")
          return Response.json({ error: "Invalid environment" }, { status: 400 });
        if (![bindingId, accountId, triggerId, correlationId].every((value) => value.trim()))
          return Response.json({ error: "Missing trigger identity" }, { status: 400 });
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: secret, error: secretError } = await supabaseAdmin.rpc(
            "resolve_pipedream_trigger_signing_key",
            {
              p_environment: environment,
              p_binding_id: bindingId,
              p_trigger_id: triggerId,
              p_account_id: accountId,
              p_correlation_id: correlationId,
            },
          );
          if (secretError) {
            console.error("[pipedream webhook] signing-key lookup failed");
            return Response.json({ error: "Signing-key lookup unavailable" }, { status: 503 });
          }
          if (!secret) return Response.json({ error: "Unknown trigger binding" }, { status: 400 });
          const verified = verifyPipedreamSignature({ header: signatureHeader, rawBody, secret });
          if (!verified) return Response.json({ error: "Invalid signature" }, { status: 400 });
          let body: unknown;
          try {
            body = JSON.parse(rawBody);
          } catch {
            return Response.json({ error: "Invalid JSON" }, { status: 400 });
          }
          let event;
          try {
            event = parsePipedreamTriggerEvent(body);
          } catch {
            return Response.json({ error: "Invalid event" }, { status: 400 });
          }
          const normalized = {
            id: event.id,
            type: event.type,
            occurred_at: event.occurredAt,
            environment,
            binding_id: bindingId,
            account_id: accountId,
            trigger_id: triggerId,
            correlation_id: correlationId,
            payload_redacted: true,
          };
          const { error } = await supabaseAdmin.rpc("ingest_pipedream_calendar_event", {
            p_event_id: event.id,
            p_environment: environment,
            p_binding_id: bindingId,
            p_account_id: accountId,
            p_trigger_id: triggerId,
            p_correlation_id: correlationId,
            p_event_type: event.type,
            p_payload_hash: createHash("sha256").update(rawBody).digest("hex"),
            p_payload: normalized as import("@/integrations/supabase/types").Json,
            p_signature_timestamp: new Date(verified.timestamp * 1000).toISOString(),
          });
          if (error) throw error;
        } catch (error) {
          console.error("[pipedream webhook] durable ingress", error);
          return Response.json({ error: "Durable ingress failed" }, { status: 500 });
        }
        return Response.json({ received: true });
      },
    },
  },
});
