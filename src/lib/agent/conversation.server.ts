import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { Json } from "@/integrations/supabase/types";

type SupabaseAdmin = SupabaseClient<Database>;

export interface ConversationRow {
  id: string;
  user_id: string;
  website_id: string;
  phase: string;
  summary: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: unknown;
  attachments: unknown;
  created_at: string;
  trace_id: string | null;
  sequence_id: number;
}

export async function ensureConversation(
  supabase: SupabaseAdmin,
  profileId: string,
  websiteId: string,
): Promise<ConversationRow> {
  const { data, error } = await supabase.rpc("ensure_agent_conversation", {
    p_profile_id: profileId,
    p_website_id: websiteId,
  });
  if (error || !data) {
    console.error("[ensureConversation]", error);
    throw new Error("Unable to ensure canonical conversation");
  }
  return data as ConversationRow;
}

export async function listConversationMessages(
  supabase: SupabaseAdmin,
  conversationId: string,
  limit = 200,
): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, role, content, tool_calls, attachments, created_at, trace_id, sequence_id",
    )
    .eq("conversation_id", conversationId)
    .order("sequence_id", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Unable to load messages");
  const chronological = (data ?? []).reverse();
  const firstNonTool = chronological.findIndex((message) => message.role !== "tool");
  return firstNonTool < 0 ? [] : chronological.slice(firstNonTool);
}

export async function insertMessage(
  supabase: SupabaseAdmin,
  conversationId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  lease: AgentTurnLease,
  extras?: { tool_calls?: unknown; attachments?: unknown },
): Promise<MessageRow> {
  const { data: messageId, error } = await supabase.rpc("insert_agent_message_owned", {
    p_trace_id: lease.traceId,
    p_owner_token: lease.ownerToken,
    p_conversation_id: conversationId,
    p_role: role,
    p_content: content,
    p_tool_calls: (extras?.tool_calls ?? null) as Json,
    p_attachments: (extras?.attachments ?? null) as Json,
  });
  if (error || typeof messageId !== "string") {
    console.error("[insertMessage]", error);
    throw new Error("Agent turn ownership lost");
  }

  const { data, error: readError } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, role, content, tool_calls, attachments, created_at, trace_id, sequence_id",
    )
    .eq("id", messageId)
    .single();
  if (readError || !data) throw new Error("Unable to load saved message");
  return data;
}

export interface AgentTraceRow {
  id: string;
  website_id: string;
  profile_id: string;
  conversation_id: string;
  intent_type: string | null;
  trigger_message: string | null;
  status: string;
  error_message: string | null;
  tool_call_count: number;
  round_count: number;
  started_at: string;
  completed_at: string | null;
}

const AGENT_TURN_LEASE_SECONDS = 180;
const AGENT_TURN_HEARTBEAT_MS = 20_000;

export class AgentTurnBusyError extends Error {
  constructor() {
    super("Agent is busy — try again in a moment");
    this.name = "AgentTurnBusyError";
  }
}

export function isAgentTurnBusyError(error: unknown): boolean {
  return error instanceof Error && error.name === "AgentTurnBusyError";
}

export type AgentTurnClaim =
  | { disposition: "new"; traceId: string; conversationId: string; ownerToken: string }
  | {
      disposition: "running" | "completed" | "error" | "cancelled";
      traceId: string;
      conversationId: string;
      assistantMessageId: string | null;
      error: string | null;
    };
export type AgentTurnLease = Extract<AgentTurnClaim, { disposition: "new" }>;

/** Atomically select/create the canonical conversation and claim or replay a turn. */
export async function claimAgentTurn(
  supabase: SupabaseAdmin,
  input: {
    websiteId: string;
    profileId: string;
    intentType: string;
    triggerMessage: string | null;
    requestId: string;
    requestPayloadHash: string;
    sourceVersionId: string | null;
    sourceRevision: number | null;
  },
): Promise<AgentTurnClaim> {
  const ownerToken = crypto.randomUUID();
  const { data, error } = await supabase.rpc("claim_agent_turn", {
    p_website_id: input.websiteId,
    p_profile_id: input.profileId,
    p_intent_type: input.intentType,
    p_trigger_message: input.triggerMessage as unknown as string,
    p_request_id: input.requestId,
    p_request_payload_hash: input.requestPayloadHash,
    p_source_version_id: input.sourceVersionId as unknown as string,
    p_source_revision: input.sourceRevision as unknown as number,
    p_owner_token: ownerToken,
    p_lease_seconds: AGENT_TURN_LEASE_SECONDS,
  });
  if (error) {
    console.error("[claimAgentTurn]", error);
    throw new Error(
      error.message.includes("Request identity payload conflict")
        ? "Request identity does not match its original source version/revision"
        : error.message.includes("Agent turn source snapshot does not match")
          ? "The selected preview changed; refresh before regenerating"
          : error.message.includes("Agent turn runtime is disabled")
            ? "Agent updates are temporarily paused during a safe deployment"
            : "Unable to start agent turn",
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Invalid agent turn claim result");
  const row = data as Record<string, unknown>;
  if (
    typeof row.traceId !== "string" ||
    typeof row.conversationId !== "string" ||
    typeof row.disposition !== "string"
  ) {
    throw new Error("Invalid agent turn claim result");
  }
  if (row.disposition === "new")
    return {
      disposition: "new",
      traceId: row.traceId,
      conversationId: row.conversationId,
      ownerToken,
    };
  if (["running", "completed", "error", "cancelled"].includes(row.disposition))
    return {
      disposition: row.disposition as "running" | "completed" | "error" | "cancelled",
      traceId: row.traceId,
      conversationId: row.conversationId,
      assistantMessageId:
        typeof row.assistantMessageId === "string" ? row.assistantMessageId : null,
      error: typeof row.error === "string" ? row.error : null,
    };
  throw new Error("Unknown agent turn claim disposition");
}

export async function assertAgentTurnOwned(
  supabase: SupabaseAdmin,
  websiteId: string,
  lease: Pick<AgentTurnLease, "traceId" | "ownerToken">,
): Promise<void> {
  const { error } = await supabase.rpc("assert_agent_turn_owned", {
    p_website_id: websiteId,
    p_trace_id: lease.traceId,
    p_owner_token: lease.ownerToken,
  });
  if (error) throw new Error("Agent turn ownership lost");
}

export async function beginAgentExternalOperation(
  supabase: SupabaseAdmin,
  websiteId: string,
  lease: Pick<AgentTurnLease, "traceId" | "ownerToken">,
  operationKey: string,
  operationType: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("begin_agent_external_operation", {
    p_operation_key: operationKey,
    p_website_id: websiteId,
    p_trace_id: lease.traceId,
    p_owner_token: lease.ownerToken,
    p_operation_type: operationType,
  });
  if (error || data !== true) throw new Error("Unable to fence external operation");
}

export async function finishAgentExternalOperation(
  supabase: SupabaseAdmin,
  lease: Pick<AgentTurnLease, "traceId" | "ownerToken">,
  operationKey: string,
  status: "completed" | "failed",
): Promise<void> {
  const { data, error } = await supabase.rpc("finish_agent_external_operation", {
    p_operation_key: operationKey,
    p_trace_id: lease.traceId,
    p_owner_token: lease.ownerToken,
    p_status: status,
  });
  if (error || data !== true) throw new Error("Unable to terminalize external operation");
}

export type AgentTurnRenewal = "renewed" | "lost" | "unavailable";
export async function renewAgentTurn(
  supabase: SupabaseAdmin,
  lease: AgentTurnLease,
): Promise<AgentTurnRenewal> {
  const { data, error } = await supabase.rpc("renew_agent_turn", {
    p_trace_id: lease.traceId,
    p_owner_token: lease.ownerToken,
    p_lease_seconds: AGENT_TURN_LEASE_SECONDS,
  });
  if (error) {
    console.error("[renewAgentTurn]", error);
    return "unavailable";
  }
  return data === true ? "renewed" : "lost";
}

export function startAgentTurnHeartbeat(
  supabase: SupabaseAdmin,
  lease: AgentTurnLease,
  onOwnershipLost: () => void,
): () => void {
  let stopped = false;
  let renewing = false;
  const timer = setInterval(() => {
    if (stopped || renewing) return;
    renewing = true;
    void renewAgentTurn(supabase, lease)
      .then((result) => {
        // Only a definitive database fence rejection proves ownership loss. A transient
        // network/RPC error is retried on the next heartbeat; owned mutations still fence.
        if (result === "lost" && !stopped) onOwnershipLost();
      })
      .finally(() => {
        renewing = false;
      });
  }, AGENT_TURN_HEARTBEAT_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export type AgentTurnCompletion = "completed" | "lost" | "unavailable";

export async function completeAgentTrace(
  supabase: SupabaseAdmin,
  lease: AgentTurnLease,
  result: {
    status: "completed" | "error" | "cancelled";
    toolCallCount: number;
    roundCount: number;
    errorMessage?: string;
  },
): Promise<AgentTurnCompletion> {
  const { data, error } = await supabase.rpc("complete_agent_turn", {
    p_trace_id: lease.traceId,
    p_owner_token: lease.ownerToken,
    p_status: result.status,
    p_tool_call_count: result.toolCallCount,
    p_round_count: result.roundCount,
    p_error_message: result.errorMessage ?? undefined,
  });
  if (error) {
    console.error("[completeAgentTrace]", error);
    return "unavailable";
  }
  return data === true ? "completed" : "lost";
}

export async function countConversationMessages(
  supabase: SupabaseAdmin,
  conversationId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId);

  if (error) {
    console.error("[countConversationMessages]", error);
    return 0;
  }

  return count ?? 0;
}

/** PRD: journal checkpoint every 10 user + assistant messages (excludes tool rows). */
export async function countUserAssistantMessages(
  supabase: SupabaseAdmin,
  conversationId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"]);

  if (error) {
    console.error("[countUserAssistantMessages]", error);
    return 0;
  }

  return count ?? 0;
}

export function toChatMessages(messages: MessageRow[]): Array<{
  role: "user" | "assistant" | "system";
  content: string;
}> {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));
}

/** Full model history including tool results for multi-turn agent turns. */
export function toModelMessages(messages: MessageRow[]): Array<{
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}> {
  const result: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    tool_call_id?: string;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  }> = [];

  for (const m of messages) {
    if (m.role === "user" || m.role === "assistant" || m.role === "system") {
      const entry: {
        role: "user" | "assistant" | "system";
        content: string;
        tool_call_id?: string;
        name?: string;
        tool_calls?: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }>;
      } = {
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      };

      if (
        m.role === "assistant" &&
        m.tool_calls &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.length > 0
      ) {
        entry.tool_calls = m.tool_calls as Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }>;
      }

      result.push(entry);
      continue;
    }

    if (m.role === "tool") {
      const toolMeta =
        m.tool_calls && typeof m.tool_calls === "object" && !Array.isArray(m.tool_calls)
          ? (m.tool_calls as { id?: string; name?: string })
          : {};
      result.push({
        role: "tool",
        content: m.content,
        tool_call_id: toolMeta.id ?? "",
        name: toolMeta.name,
      });
    }
  }

  return result;
}
