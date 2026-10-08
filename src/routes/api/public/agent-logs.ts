import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Deep agent log export.
 *
 * Auth: `Authorization: Bearer <AGENT_LOGS_TOKEN>` (or `?token=` for quick curl use).
 *
 * GET /api/public/agent-logs
 *   ?traceId=<uuid>        full deep dump for one trace (everything below)
 *   ?websiteId=<uuid>      filter list / deep dump scope
 *   ?license=<number>      filter by contractor license number
 *   ?status=running|completed|error|cancelled
 *   ?intentType=<string>
 *   ?since=<ISO date>
 *   ?limit=1..100 (default 25)  ?offset=0
 *   ?deep=1                deep dump every trace in the list (limit capped to 10)
 */

const querySchema = z.object({
  traceId: z.string().uuid().optional(),
  websiteId: z.string().uuid().optional(),
  license: z.string().trim().max(50).optional(),
  status: z.string().trim().max(30).optional(),
  intentType: z.string().trim().max(50).optional(),
  since: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  deep: z.coerce.boolean().default(false),
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function deepDumpTrace(supabaseAdmin: Admin, traceId: string) {
  const { data: trace } = await supabaseAdmin
    .from("agent_traces")
    .select("*")
    .eq("id", traceId)
    .maybeSingle();

  if (!trace) return null;

  const [
    { data: profile },
    { data: website },
    { data: contractor },
    { data: rawMessages },
    { data: conversations },
  ] = await Promise.all([
    supabaseAdmin.from("profiles").select("*").eq("id", trace.profile_id).maybeSingle(),
    supabaseAdmin.from("websites").select("*").eq("id", trace.website_id).maybeSingle(),
    supabaseAdmin
      .from("contractor_profiles")
      .select("*")
      .eq("website_id", trace.website_id)
      .maybeSingle(),
    supabaseAdmin
      .from("messages")
      .select("*")
      .eq("trace_id", traceId)
      .order("sequence_id", { ascending: true }),
    supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("website_id", trace.website_id)
      .order("created_at", { ascending: false }),
  ]);

  const messages = rawMessages ?? [];

  // Pair assistant tool_calls with their tool-result messages, keeping full payloads.
  const resultsByCallId = new Map<string, (typeof messages)[number]>();
  for (const row of messages) {
    if (row.role !== "tool") continue;
    const meta =
      row.tool_calls && typeof row.tool_calls === "object" && !Array.isArray(row.tool_calls)
        ? (row.tool_calls as { id?: string })
        : {};
    if (meta.id) resultsByCallId.set(meta.id, row);
  }

  const toolCalls = messages
    .filter((row) => Array.isArray(row.tool_calls))
    .flatMap((row) => {
      const calls = row.tool_calls as Array<{
        id: string;
        function?: { name: string; arguments: string };
      }>;
      return calls.map((tc) => {
        const paired = resultsByCallId.get(tc.id);
        const startedAt = row.created_at;
        const completedAt = paired?.created_at ?? null;
        return {
          id: tc.id,
          name: tc.function?.name ?? "unknown",
          messageId: row.id,
          startedAt,
          completedAt,
          durationMs: completedAt
            ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
            : null,
          argumentsRaw: tc.function?.arguments ?? "",
          argumentsParsed: safeJsonParse(tc.function?.arguments ?? ""),
          resultRaw: paired?.content ?? null,
          resultParsed: paired ? safeJsonParse(paired.content) : null,
        };
      });
    });

  const chainIds = [
    ...new Set(
      toolCalls
        .map((tc) => (tc.resultParsed as { chainId?: string } | null)?.chainId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [{ data: chainJobs }, { data: websiteJobs }, { data: versions }, { data: edits }] =
    await Promise.all([
      chainIds.length
        ? supabaseAdmin
            .from("background_jobs")
            .select("*")
            .in("chain_id", chainIds)
            .order("sequence_index", { ascending: true })
        : Promise.resolve({ data: [] as unknown[] }),
      supabaseAdmin
        .from("background_jobs")
        .select("*")
        .eq("website_id", trace.website_id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("website_versions")
        .select("*")
        .eq("website_id", trace.website_id)
        .order("version_number", { ascending: false }),
      supabaseAdmin
        .from("website_edit_events")
        .select("*")
        .eq("website_id", trace.website_id)
        .order("created_at", { ascending: false }),
    ]);

  const versionIds = (versions ?? []).map((v: { id: string }) => v.id);

  const [{ data: versionMediaSlots }, { data: generationMediaSlots }] = await Promise.all([
    versionIds.length
      ? supabaseAdmin.from("website_version_media_slots").select("*").in("version_id", versionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin
      .from("site_generation_media_slots")
      .select("*")
      .eq("website_id", trace.website_id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const baseUrl = process.env.PUBLIC_APP_URL ?? "https://obra-tech.lovable.app";

  return {
    trace,
    profile,
    website: website
      ? {
          ...website,
          liveUrl:
            website.status === "live" && website.active_version_id
              ? `${baseUrl}/lp/${website.id}`
              : null,
        }
      : null,
    contractorProfile: contractor,
    conversations: conversations ?? [],
    counts: {
      messages: messages.length,
      toolCalls: toolCalls.length,
      versions: versions?.length ?? 0,
      edits: edits?.length ?? 0,
      chainJobs: chainJobs?.length ?? 0,
    },
    messages,
    toolCalls,
    jobs: { chainIds, chain: chainJobs ?? [], website: websiteJobs ?? [] },
    versions: versions ?? [],
    edits: edits ?? [],
    media: {
      versionSlots: versionMediaSlots ?? [],
      generationSlots: generationMediaSlots ?? [],
    },
  };
}

export const Route = createFileRoute("/api/public/agent-logs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.AGENT_LOGS_TOKEN;
        if (!expected) {
          return Response.json({ error: "AGENT_LOGS_TOKEN is not configured" }, { status: 503 });
        }

        const url = new URL(request.url);
        const header = request.headers.get("authorization") ?? "";
        const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        const provided = bearer || (url.searchParams.get("token") ?? "");
        if (!provided || !timingSafeEqual(provided, expected)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let params: z.infer<typeof querySchema>;
        try {
          params = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
        } catch {
          return Response.json({ error: "Invalid query parameters" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (params.traceId) {
          const dump = await deepDumpTrace(supabaseAdmin, params.traceId);
          if (!dump) return Response.json({ error: "Trace not found" }, { status: 404 });
          return Response.json({ mode: "trace", ...dump });
        }

        let profileIds: string[] | null = null;
        if (params.license) {
          const { data: matches } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("license_number", params.license);
          profileIds = (matches ?? []).map((p) => p.id);
          if (profileIds.length === 0) {
            return Response.json({ mode: "list", total: 0, traces: [] });
          }
        }

        const limit = params.deep ? Math.min(params.limit, 10) : params.limit;

        let query = supabaseAdmin
          .from("agent_traces")
          .select(
            "*, profiles!agent_traces_profile_id_fkey!inner(business_name, license_number, trade, city)",
            { count: "exact" },
          )
          .order("started_at", { ascending: false })
          .range(params.offset, params.offset + limit - 1);

        if (params.websiteId) query = query.eq("website_id", params.websiteId);
        if (params.status) query = query.eq("status", params.status);
        if (params.intentType) query = query.eq("intent_type", params.intentType);
        if (params.since) query = query.gte("started_at", params.since);
        if (profileIds) query = query.in("profile_id", profileIds);

        const { data: rows, error, count } = await query;
        if (error) {
          console.error("[agent-logs]", error);
          return Response.json({ error: "Unable to load traces" }, { status: 500 });
        }

        if (params.deep) {
          const dumps = await Promise.all(
            (rows ?? []).map((row) => deepDumpTrace(supabaseAdmin, row.id)),
          );
          return Response.json({
            mode: "list-deep",
            total: count ?? 0,
            limit,
            offset: params.offset,
            traces: dumps.filter(Boolean),
          });
        }

        return Response.json({
          mode: "list",
          total: count ?? 0,
          limit,
          offset: params.offset,
          traces: rows ?? [],
        });
      },
    },
  },
});
