import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

import {
  billingEnvironment,
  constructStripeWebhookEvent,
  STRIPE_API_VERSION,
} from "@/lib/stripe.server";

export const Route = createFileRoute("/api/stripe/connect-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
        if (!secret)
          return Response.json({ error: "Connect webhook not configured" }, { status: 503 });
        const signature = request.headers.get("stripe-signature");
        if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });
        const rawBody = await request.text();
        let event: Stripe.Event;
        try {
          event = await constructStripeWebhookEvent(rawBody, signature, secret);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "unknown";
          console.error("[stripe connect webhook] signature verification failed", detail);
          return Response.json({ error: "Invalid signature" }, { status: 400 });
        }
        if (!event.account)
          return Response.json({ error: "Connected account context required" }, { status: 400 });
        const bookingTypes = new Set([
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
          "checkout.session.async_payment_failed",
          "checkout.session.expired",
          "charge.refunded",
          "refund.updated",
          "charge.dispute.created",
          "charge.dispute.updated",
          "charge.dispute.closed",
        ]);
        if (event.type !== "account.updated" && !bookingTypes.has(event.type))
          return Response.json({ received: true, ignored: true });
        const object = event.data.object as {
          object?: string;
          id?: string;
          metadata?: Record<string, string>;
        };
        if (
          event.type === "account.updated" &&
          (object.object !== "account" || object.id !== event.account)
        )
          return Response.json({ error: "Connect account identity mismatch" }, { status: 400 });
        if (event.type !== "account.updated") {
          if (!object.id)
            return Response.json({ error: "Booking object identity missing" }, { status: 400 });
          const requiresDirectMetadata = event.type.startsWith("checkout.session");
          if (requiresDirectMetadata && object.metadata?.kind !== "booking")
            return Response.json({ error: "Booking correlation missing" }, { status: 400 });
        }
        if (event.api_version !== STRIPE_API_VERSION)
          return Response.json({ error: "Stripe API version mismatch" }, { status: 400 });
        const environment = event.livemode ? "live" : "test";
        if (billingEnvironment() !== environment)
          return Response.json({ error: "Stripe environment mismatch" }, { status: 400 });
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: identities, error: identityError } = await supabaseAdmin.rpc(
            "resolve_stripe_connect_account",
            { p_stripe_account_id: event.account, p_environment: environment },
          );
          if (identityError) throw identityError;
          if (!identities || identities.length !== 1)
            return Response.json({ error: "Unknown connected account" }, { status: 400 });
          const signatureTimestamp = /\bt=(\d+)\b/.exec(signature)?.[1];
          const { error } = await supabaseAdmin.rpc("ingest_provider_event", {
            p_provider: "stripe",
            p_event_family: event.type === "account.updated" ? "connect" : "booking",
            p_event_id: event.id,
            p_account_context: event.account,
            p_destination: "obra-connect-webhook",
            p_api_version: event.api_version ?? "",
            p_livemode: event.livemode,
            p_environment: environment,
            p_profile_id: identities[0].profile_id,
            p_event_type: event.type,
            p_payload_hash: createHash("sha256").update(rawBody).digest("hex"),
            p_payload: JSON.parse(rawBody),
            p_signature_timestamp: signatureTimestamp
              ? new Date(Number(signatureTimestamp) * 1000).toISOString()
              : undefined,
          });
          if (error) throw error;
        } catch (error) {
          console.error("[stripe connect webhook] durable ingress", event.id, error);
          return Response.json({ error: "Durable ingress failed" }, { status: 500 });
        }
        return Response.json({ received: true });
      },
    },
  },
});
