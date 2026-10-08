import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { requireAdminMiddleware } from "@/lib/auth/admin-middleware.server";
import { getAuthenticatedAdminActorId } from "@/lib/auth/admin-session.server";

const listTracesSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["running", "completed", "error"]).optional(),
  intentType: z.string().max(50).optional(),
});

const traceDetailSchema = z.object({ traceId: z.string().uuid() });
const recoverTraceSchema = z.object({
  traceId: z.string().uuid(),
  expectedOwnerToken: z.string().uuid().nullable(),
  status: z.enum(["error", "cancelled"]),
  reason: z.string().trim().min(1).max(500),
});
const abandonExternalOperationSchema = z.object({
  operationKey: z.string().trim().min(1).max(500),
  expectedTraceId: z.string().uuid(),
  expectedOwnerToken: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const recoverAgentTrace = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => recoverTraceSchema.parse(data))
  .handler(async ({ data }) => {
    const adminActorId = await getAuthenticatedAdminActorId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: recovered, error } = await supabaseAdmin.rpc("admin_recover_agent_turn", {
      p_trace_id: data.traceId,
      p_expected_owner_token: data.expectedOwnerToken as unknown as string,
      p_admin_actor_id: adminActorId,
      p_status: data.status,
      p_reason: data.reason,
    });
    if (error) throw new Error("Unable to recover agent trace");
    return { recovered: recovered === true };
  });

export const abandonAgentExternalOperation = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => abandonExternalOperationSchema.parse(data))
  .handler(async ({ data }) => {
    const adminActorId = await getAuthenticatedAdminActorId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: abandoned, error } = await supabaseAdmin.rpc(
      "admin_abandon_agent_external_operation",
      {
        p_operation_key: data.operationKey,
        p_expected_trace_id: data.expectedTraceId,
        p_expected_owner_token: data.expectedOwnerToken,
        p_admin_actor_id: adminActorId,
        p_reason: data.reason,
      },
    );
    if (error) throw new Error("Unable to abandon agent external operation");
    return { abandoned: abandoned === true };
  });

interface ToolCallDetail {
  id: string;
  name: string;
  arguments: string;
  result: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

interface TraceMessageDetail {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  toolCalls: ToolCallDetail[];
}

export const listAgentTraces = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => listTracesSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // profiles is joined with !inner specifically so the .or() filter below can restrict
    // top-level agent_traces rows — PostgREST's default left-join embed only filters what's
    // *inside* the embedded object, not which parent rows are returned (confirmed against
    // PostgREST's own resource-embedding docs). profile_id is a not-null FK with cascade
    // delete, so every trace always has a resolvable profile — !inner never drops a row
    // that would otherwise have been included. Modifier order matters: PostgREST requires
    // the foreign-key hint before !inner (`relation!fkey!inner`), not the reverse.
    let query = supabaseAdmin
      .from("agent_traces")
      .select(
        "id, website_id, profile_id, intent_type, trigger_message, status, error_message, tool_call_count, round_count, started_at, completed_at, profiles!agent_traces_profile_id_fkey!inner(business_name, license_number)",
        { count: "exact" },
      )
      .order("started_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.intentType) query = query.eq("intent_type", data.intentType);
    if (data.search) {
      const escaped = data.search.replace(/[%,()]/g, "");
      query = query.or(`business_name.ilike.%${escaped}%,license_number.ilike.%${escaped}%`, {
        referencedTable: "profiles",
      });
    }

    const { data: rows, error, count } = await query;
    if (error) {
      console.error("[listAgentTraces]", error);
      throw new Error("Unable to load traces");
    }

    const traces = rows ?? [];
    const websiteIds = [...new Set(traces.map((t) => t.website_id))];
    const traceIds = traces.map((t) => t.id);

    const [versionsResult, revisionsResult, firecrawlResult] = await Promise.all([
      websiteIds.length
        ? supabaseAdmin.from("website_versions").select("website_id").in("website_id", websiteIds)
        : Promise.resolve({ data: [] as Array<{ website_id: string }> }),
      websiteIds.length
        ? supabaseAdmin
            .from("website_edit_events")
            .select("website_id")
            .in("website_id", websiteIds)
        : Promise.resolve({ data: [] as Array<{ website_id: string }> }),
      traceIds.length
        ? supabaseAdmin
            .from("messages")
            .select("trace_id")
            .eq("role", "tool")
            .filter("tool_calls->>name", "eq", "firecrawl_scrape")
            .in("trace_id", traceIds)
        : Promise.resolve({ data: [] as Array<{ trace_id: string | null }> }),
    ]);

    const versionCounts = new Map<string, number>();
    for (const row of versionsResult.data ?? []) {
      versionCounts.set(row.website_id, (versionCounts.get(row.website_id) ?? 0) + 1);
    }
    const revisionCounts = new Map<string, number>();
    for (const row of revisionsResult.data ?? []) {
      revisionCounts.set(row.website_id, (revisionCounts.get(row.website_id) ?? 0) + 1);
    }
    const firecrawlTraceIds = new Set(
      (firecrawlResult.data ?? [])
        .map((row) => row.trace_id)
        .filter((id): id is string => Boolean(id)),
    );

    const firecrawlWebsiteIds = [
      ...new Set(traces.filter((t) => firecrawlTraceIds.has(t.id)).map((t) => t.website_id)),
    ];

    const { data: contractorRows } = firecrawlWebsiteIds.length
      ? await supabaseAdmin
          .from("contractor_profiles")
          .select("website_id, enrichment_json, research_status")
          .in("website_id", firecrawlWebsiteIds)
      : {
          data: [] as Array<{
            website_id: string;
            enrichment_json: Json;
            research_status: string | null;
          }>,
        };

    const enrichmentByWebsite = new Map<
      string,
      { enrichment: Record<string, unknown>; researchStatus: string | null }
    >();
    for (const row of contractorRows ?? []) {
      enrichmentByWebsite.set(row.website_id, {
        enrichment: (row.enrichment_json as Record<string, unknown>) ?? {},
        researchStatus: row.research_status ?? null,
      });
    }

    const { formatEnrichmentTraceText } =
      await import("@/lib/admin/format-enrichment-trace.server");

    const enriched = traces.map((t) => {
      const profile = t.profiles as { business_name: string | null; license_number: string } | null;
      const crawled = firecrawlTraceIds.has(t.id);
      const stored = enrichmentByWebsite.get(t.website_id);
      const firecrawlInfo = crawled
        ? formatEnrichmentTraceText(stored?.enrichment ?? {}, {
            businessName: profile?.business_name,
            licenseNumber: profile?.license_number,
            researchStatus: stored?.researchStatus,
          })
        : null;
      return {
        id: t.id,
        websiteId: t.website_id,
        profileId: t.profile_id,
        businessName: profile?.business_name ?? null,
        licenseNumber: profile?.license_number ?? null,
        intentType: t.intent_type,
        triggerMessage: t.trigger_message,
        status: t.status,
        errorMessage: t.error_message,
        toolCallCount: t.tool_call_count,
        roundCount: t.round_count,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        versionCount: versionCounts.get(t.website_id) ?? 0,
        revisionCount: revisionCounts.get(t.website_id) ?? 0,
        firecrawlRan: crawled,
        firecrawlInfo,
      };
    });

    return { rows: enriched, total: count ?? 0 };
  });

export const getAgentTraceDetail = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => traceDetailSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: trace, error: traceError } = await supabaseAdmin
      .from("agent_traces")
      .select("*")
      .eq("id", data.traceId)
      .single();

    if (traceError || !trace) {
      throw new Error("Trace not found");
    }

    const [
      { data: profile },
      { data: website },
      { data: contractor },
      { data: messageRows },
      { data: externalOperationRows, error: externalOperationsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, business_name, license_number, trade, city")
        .eq("id", trace.profile_id)
        .maybeSingle(),
      supabaseAdmin
        .from("websites")
        .select("id, status, active_version_id")
        .eq("id", trace.website_id)
        .maybeSingle(),
      supabaseAdmin
        .from("contractor_profiles")
        .select("enrichment_json, research_status")
        .eq("website_id", trace.website_id)
        .maybeSingle(),
      supabaseAdmin
        .from("messages")
        .select("id, role, content, tool_calls, created_at, sequence_id")
        .eq("trace_id", data.traceId)
        .order("sequence_id", { ascending: true }),
      supabaseAdmin
        .from("agent_external_operations")
        .select(
          "operation_key, status, operation_type, owner_token, started_at, terminal_at, abandoned_by, abandon_reason",
        )
        .eq("trace_id", data.traceId)
        .order("started_at", { ascending: false }),
    ]);

    if (externalOperationsError) {
      console.error("[getAgentTraceDetail] external operations", externalOperationsError);
      throw new Error("Unable to load trace recovery state");
    }

    const rawMessages = messageRows ?? [];

    const toolResultsById = new Map<string, { content: string; created_at: string }>();
    for (const row of rawMessages) {
      if (row.role !== "tool") continue;
      const meta =
        row.tool_calls && typeof row.tool_calls === "object" && !Array.isArray(row.tool_calls)
          ? (row.tool_calls as { id?: string })
          : {};
      if (meta.id) {
        toolResultsById.set(meta.id, { content: row.content, created_at: row.created_at });
      }
    }

    const messages: TraceMessageDetail[] = rawMessages
      .filter((row) => row.role !== "tool")
      .map((row) => {
        const toolCallsRaw = Array.isArray(row.tool_calls)
          ? (row.tool_calls as Array<{
              id: string;
              function?: { name: string; arguments: string };
            }>)
          : [];

        const toolCalls: ToolCallDetail[] = toolCallsRaw.map((tc) => {
          const paired = toolResultsById.get(tc.id);
          const startedAt = row.created_at;
          const completedAt = paired?.created_at ?? null;
          const durationMs =
            completedAt != null
              ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
              : null;
          return {
            id: tc.id,
            name: tc.function?.name ?? "unknown",
            arguments: tc.function?.arguments ?? "",
            result: paired?.content ?? null,
            startedAt,
            completedAt,
            durationMs,
          };
        });

        return {
          id: row.id,
          role: row.role,
          content: row.content,
          createdAt: row.created_at,
          toolCalls,
        };
      });

    const chainIds = new Set<string>();
    for (const result of toolResultsById.values()) {
      try {
        const parsed = JSON.parse(result.content) as { chainId?: string };
        if (parsed.chainId) chainIds.add(parsed.chainId);
      } catch {
        // non-JSON tool result — not every tool returns a chainId
      }
    }

    const { data: jobRows } = chainIds.size
      ? await supabaseAdmin
          .from("background_jobs")
          .select(
            "id, chain_id, job_type, platform, status, progress_pct, status_message, error_message, sequence_index, created_at, started_at, completed_at",
          )
          .in("chain_id", [...chainIds])
          .order("sequence_index", { ascending: true })
      : { data: [] as never[] };

    const baseUrl = process.env.PUBLIC_APP_URL ?? "https://obra-tech.lovable.app";
    const liveUrl =
      website?.status === "live" && website?.active_version_id
        ? `${baseUrl}/lp/${trace.website_id}`
        : null;

    const [{ data: versions }, { data: revisions }] = await Promise.all([
      supabaseAdmin
        .from("website_versions")
        .select("id, version_number, variant_key, status, config_json, created_at")
        .eq("website_id", trace.website_id)
        .order("version_number", { ascending: false }),
      supabaseAdmin
        .from("website_edit_events")
        .select("id, version_id, category, patch_json, created_at")
        .eq("website_id", trace.website_id)
        .order("created_at", { ascending: false }),
    ]);

    const enrichment = (contractor?.enrichment_json as Record<string, Json>) ?? {};
    const platforms: Record<string, Json> =
      enrichment.platforms && typeof enrichment.platforms === "object"
        ? (enrichment.platforms as Record<string, Json>)
        : {};
    const images: Json[] = Array.isArray(enrichment.images) ? (enrichment.images as Json[]) : [];

    const firecrawlRanInTrace = rawMessages.some((row) => {
      if (row.role !== "tool") return false;
      const meta =
        row.tool_calls && typeof row.tool_calls === "object" && !Array.isArray(row.tool_calls)
          ? (row.tool_calls as { name?: string })
          : {};
      return meta.name === "firecrawl_scrape";
    });

    return {
      trace: {
        id: trace.id,
        intentType: trace.intent_type,
        triggerMessage: trace.trigger_message,
        status: trace.status,
        errorMessage: trace.error_message,
        toolCallCount: trace.tool_call_count,
        roundCount: trace.round_count,
        startedAt: trace.started_at,
        completedAt: trace.completed_at,
        ownerToken: trace.owner_token,
        heartbeatAt: trace.heartbeat_at,
        leaseExpiresAt: trace.lease_expires_at,
        recoveredAt: trace.recovered_at,
        recoveredBy: trace.recovered_by,
        recoveryReason: trace.recovery_reason,
      },
      externalOperations: (externalOperationRows ?? []).map((operation) => ({
        operationKey: operation.operation_key,
        status: operation.status,
        operationType: operation.operation_type,
        ownerToken: operation.owner_token,
        startedAt: operation.started_at,
        terminalAt: operation.terminal_at,
        abandonedBy: operation.abandoned_by,
        abandonReason: operation.abandon_reason,
      })),
      profile: profile
        ? {
            id: profile.id,
            businessName: profile.business_name,
            licenseNumber: profile.license_number,
            trade: profile.trade,
            city: profile.city,
          }
        : null,
      website: {
        id: trace.website_id,
        status: website?.status ?? "draft",
        liveUrl,
      },
      messages,
      jobs: jobRows ?? [],
      enrichment: firecrawlRanInTrace
        ? {
            researchStatus: contractor?.research_status ?? null,
            platforms,
            images,
            ranInTrace: true as const,
          }
        : {
            researchStatus: null,
            platforms: {} as Record<string, Json>,
            images: [] as Json[],
            ranInTrace: false as const,
          },
      versions: versions ?? [],
      revisions: revisions ?? [],
    };
  });
