import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

import { withSemanticTypes } from "@/integrations/supabase/semantic-client";
import {
  billingEnvironment,
  constructStripeWebhookEvent,
  STRIPE_API_VERSION,
} from "@/lib/stripe.server";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
        if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });
        const signature = request.headers.get("stripe-signature");
        if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });
        const rawBody = await request.text();
        let event: Stripe.Event;
        try {
          event = await constructStripeWebhookEvent(rawBody, signature, secret);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "unknown";
          console.error("[stripe webhook] signature verification failed", detail);
          return Response.json({ error: "Invalid signature" }, { status: 400 });
        }
        if (event.api_version !== STRIPE_API_VERSION)
          return Response.json({ error: "Stripe API version mismatch" }, { status: 400 });
        if (event.account) {
          return Response.json({ error: "Connect event sent to SaaS webhook" }, { status: 400 });
        }
        const expectedLivemode = billingEnvironment() === "live";
        if (event.livemode !== expectedLivemode) {
          return Response.json({ error: "Stripe environment mismatch" }, { status: 400 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const payloadHash = createHash("sha256").update(rawBody).digest("hex");
          const signatureTimestamp = /\bt=(\d+)\b/.exec(signature)?.[1];
          const { error } = await withSemanticTypes(supabaseAdmin).rpc("ingest_provider_event", {
            p_provider: "stripe",
            p_event_family: "saas",
            p_event_id: event.id,
            p_account_context: typeof event.account === "string" ? event.account : "",
            p_destination: "obra-saas-webhook",
            p_api_version: event.api_version ?? "",
            p_livemode: event.livemode,
            p_environment: event.livemode ? "live" : "test",
            p_profile_id: null,
            p_event_type: event.type,
            p_payload_hash: payloadHash,
            p_payload: JSON.parse(rawBody),
            p_signature_timestamp: signatureTimestamp
              ? new Date(Number(signatureTimestamp) * 1000).toISOString()
              : null,
          });
          if (error) throw error;
          // Preserve the already-live SaaS billing lifecycle without relying on a scheduler.
          // The signed event is durable first; a failed projection returns non-2xx so Stripe retries,
          // while the inbox lease keeps duplicate deliveries idempotent.
          const { processSaasStripeInbox } = await import("@/lib/stripe-inbox-worker.server");
          const result = await processSaasStripeInbox(1, event.id);
          if (result.outcome === "active_lease") {
            return Response.json({ error: "Event processing is already active" }, { status: 409 });
          }
          if (result.outcome === "missing") {
            return Response.json({ error: "Durable event was not found" }, { status: 500 });
          }
          // Only an application committed by this delivery or an already-completed idempotent
          // duplicate is acknowledged. Zero unprocessed targeted events are never acknowledged.
          return Response.json({ received: true, outcome: result.outcome });
        } catch (error) {
          console.error("[stripe webhook] durable ingress", event.type, error);
          return Response.json({ error: "Durable ingress failed" }, { status: 500 });
        }
      },
    },
  },
});
