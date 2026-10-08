import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { publicAgentError } from "@/lib/agent/public-error";

const intentSchema = z.object({
  // versionId is required: a personalize turn has no version-discovery
  // tool, so omitting it would burn model rounds on an unactable turn.
  type: z.literal("personalize_template"),
  versionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const bodySchema = z.object({
  userId: z.string().uuid(),
  websiteId: z.string().uuid(),
  requestId: z.string().uuid().optional(),
  message: z.string().optional(),
  skipUserPersist: z.boolean().optional(),
  intent: intentSchema,
});

export const Route = createFileRoute("/api/agent/message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof bodySchema>;
        try {
          body = bodySchema.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        if (!body.userId || !body.websiteId) {
          return Response.json({ error: "userId and websiteId required" }, { status: 400 });
        }

        const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");

        let profileId: string;
        try {
          const access = await assertWebsiteWorkspaceAccess(body.websiteId);
          if (access.profileId !== body.userId) throw new Error("Forbidden");
          profileId = access.profileId;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return Response.json({ error: message }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const websiteId = body.websiteId;
        const requestId = body.requestId ?? crypto.randomUUID();

        // Personalize turns need a starting revision for patch CAS. Resolve it
        // server-side so callers never guess; drift after this point resolves
        // through the revision-conflict retry rule in the turn prompt.
        const { data: targetVersion } = await supabaseAdmin
          .from("website_versions")
          .select("revision")
          .eq("id", body.intent.versionId)
          .eq("website_id", websiteId)
          .maybeSingle();
        if (!targetVersion) {
          return Response.json({ error: "Template version not found" }, { status: 404 });
        }
        const personalizeRevision = targetVersion.revision;

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("license_number")
          .eq("id", profileId)
          .single();

        if (!profile) {
          return Response.json({ error: "Profile not found" }, { status: 404 });
        }

        const { runAgentTurn, encodeSseEvent } = await import("@/lib/agent/agent-run.server");
        const messageText = body.message?.trim() ?? "";
        const skipUserPersist = body.skipUserPersist === true;

        const streamAbort = new AbortController();
        const turnSignal = AbortSignal.any([request.signal, streamAbort.signal]);
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              // Response consumer already disconnected.
            }
            const ping = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
              } catch {
                clearInterval(ping);
              }
            }, 15_000);
            try {
              await runAgentTurn(
                supabaseAdmin,
                { profileId, websiteId, licenseNumber: profile.license_number },
                messageText,
                (event) => {
                  controller.enqueue(encoder.encode(encodeSseEvent(event)));
                },
                {
                  skipUserPersist,
                  intent: { ...body.intent, expectedRevision: personalizeRevision },
                  requestId,
                  signal: turnSignal,
                },
              );
            } catch (error) {
              const message = publicAgentError(error);
              try {
                controller.enqueue(encoder.encode(encodeSseEvent({ type: "error", message })));
              } catch {
                // Response consumer already disconnected.
              }
            } finally {
              clearInterval(ping);
              try {
                controller.close();
              } catch {
                // Response consumer already disconnected.
              }
            }
          },
          cancel() {
            streamAbort.abort();
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
