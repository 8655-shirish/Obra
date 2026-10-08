import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { assertNotAborted, isAbortError, isTurnCancelled } from "./abort.server";
import { buildIntentPrompt, buildSystemPrompt } from "./prompts";
import {
  claimAgentTurn,
  completeAgentTrace,
  countUserAssistantMessages,
  insertMessage,
  isAgentTurnBusyError,
  listConversationMessages,
  startAgentTurnHeartbeat,
  toModelMessages,
  type AgentTurnLease,
} from "./conversation.server";
import { loadJournalMarkdown, maybeAppendJournalAfterMessages } from "./journal.server";
import { streamChatCompletion, type ChatMessage } from "./lovable-ai.server";
import { OPENAI_AGENT_TOOLS } from "./openai-tools.server";
import { publicAgentError } from "./public-error";
import { executeAgentTool } from "./tools/handlers.server";

type SupabaseAdmin = SupabaseClient<Database>;

export interface AgentStreamContext {
  profileId: string;
  websiteId: string;
  licenseNumber: string;
}

export type AgentTurnIntent = {
  type: "personalize_template";
  versionId?: string;
  expectedRevision?: number;
};

export type AgentSseEvent =
  | { type: "token"; text: string }
  | { type: "busy"; message: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; ok: boolean }
  | { type: "done"; assistantMessageId: string }
  | { type: "cancelled" }
  | { type: "error"; message: string };

const MAX_TOOL_ROUNDS = 10;

async function requestIdentity(
  ctx: AgentStreamContext,
  userText: string,
  skipUserPersist: boolean,
  requestId: string,
  intent: AgentTurnIntent,
) {
  const payload = JSON.stringify({
    version: 1,
    websiteId: ctx.websiteId,
    profileId: ctx.profileId,
    message: userText.trim(),
    skipUserPersist,
    intent,
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
  );
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    requestId,
    payloadHash: hex,
  };
}

export async function runAgentTurn(
  supabase: SupabaseAdmin,
  ctx: AgentStreamContext,
  userText: string,
  emit: (event: AgentSseEvent) => void,
  options: {
    skipUserPersist?: boolean;
    intent: AgentTurnIntent;
    requestId?: string;
    signal?: AbortSignal;
  },
): Promise<void> {
  const skipUserPersist = options.skipUserPersist === true;
  const signal = options.signal;
  const resolvedIntent = options.intent;
  const baseRequestId = options.requestId ?? crypto.randomUUID();

  let lease: AgentTurnLease | null = null;
  let stopHeartbeat: (() => void) | null = null;
  const ownershipController = new AbortController();
  const turnSignal = signal
    ? AbortSignal.any([signal, ownershipController.signal])
    : ownershipController.signal;
  let toolCallCount = 0;
  let roundCount = 0;
  let traceSettled = false;

  const settleTrace = async (result: {
    status: "completed" | "error" | "cancelled";
    errorMessage?: string;
  }) => {
    if (!lease || traceSettled) return;
    const completion = await completeAgentTrace(supabase, lease, {
      status: result.status,
      toolCallCount,
      roundCount,
      errorMessage: result.errorMessage,
    });
    if (completion === "completed") {
      traceSettled = true;
      stopHeartbeat?.();
      stopHeartbeat = null;
      return;
    }
    if (completion === "lost") {
      ownershipController.abort();
      throw new Error("Agent turn ownership lost");
    }
    throw new Error("Unable to settle agent turn");
  };

  try {
    assertNotAborted(turnSignal);
    const identity = await requestIdentity(
      ctx,
      userText,
      skipUserPersist,
      baseRequestId,
      resolvedIntent,
    );
    const claim = await claimAgentTurn(supabase, {
      websiteId: ctx.websiteId,
      profileId: ctx.profileId,
      intentType: resolvedIntent.type,
      triggerMessage: userText.trim() ? userText : null,
      requestId: identity.requestId,
      requestPayloadHash: identity.payloadHash,
      sourceVersionId: resolvedIntent.versionId ?? null,
      sourceRevision: resolvedIntent.expectedRevision ?? null,
    });
    const conversation = { id: claim.conversationId };
    if (claim.disposition === "running") {
      emit({ type: "busy", message: "Agent request is still running" });
      return;
    }
    if (claim.disposition === "completed") {
      if (!claim.assistantMessageId)
        emit({ type: "error", message: "Completed request has no durable assistant response" });
      else emit({ type: "done", assistantMessageId: claim.assistantMessageId });
      return;
    }
    if (claim.disposition === "cancelled") {
      emit({ type: "cancelled" });
      return;
    }
    if (claim.disposition === "error") {
      emit({ type: "error", message: publicAgentError(claim.error ?? "Previous request failed") });
      return;
    }
    if (claim.disposition !== "new") return;
    lease = claim;
    const ownedLease: AgentTurnLease = claim;
    stopHeartbeat = startAgentTurnHeartbeat(supabase, ownedLease, () =>
      ownershipController.abort(),
    );

    assertNotAborted(turnSignal);

    if (!skipUserPersist && userText.trim()) {
      await insertMessage(supabase, conversation.id, "user", userText, ownedLease);
    }

    const journal = await loadJournalMarkdown(supabase, ctx.licenseNumber, ctx.websiteId);
    const intentPrompt = buildIntentPrompt(resolvedIntent);
    const systemPrompt = buildSystemPrompt({ intentPrompt });
    const journalBlock = journal ? `\n\n## Journal (license ${ctx.licenseNumber})\n${journal}` : "";

    const history = await listConversationMessages(supabase, conversation.id);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt + journalBlock },
      ...toModelMessages(history),
    ];

    let lastAssistantMessageId: string | null = null;
    let completedWithResponse = false;

    while (roundCount < MAX_TOOL_ROUNDS) {
      assertNotAborted(turnSignal);
      roundCount += 1;
      let roundContent = "";

      const { content, toolCalls } = await streamChatCompletion({
        messages,
        tools: OPENAI_AGENT_TOOLS,
        signal: turnSignal,
        onToken: (text) => {
          roundContent += text;
          emit({ type: "token", text });
        },
      });

      assertNotAborted(turnSignal);

      const roundText = (content || roundContent).trim();

      if (toolCalls.length === 0) {
        if (!roundText) {
          throw new Error("Agent returned no durable assistant response");
        }
        const assistantMessage = await insertMessage(
          supabase,
          conversation.id,
          "assistant",
          roundText,
          ownedLease,
        );
        lastAssistantMessageId = assistantMessage.id;
        completedWithResponse = true;
        break;
      }

      messages.push({
        role: "assistant",
        content: roundText || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      const toolResults: Array<{ id: string; name: string; content: string }> = [];

      for (const toolCall of toolCalls) {
        assertNotAborted(turnSignal);
        toolCallCount += 1;
        emit({ type: "tool_start", name: toolCall.name });
        let ok = true;
        let result: unknown;

        try {
          const args = JSON.parse(toolCall.arguments || "{}") as Record<string, unknown>;
          args.websiteId = ctx.websiteId;
          result = await executeAgentTool(toolCall.name, args, {
            signal: turnSignal,
            requestId: identity.requestId,
            turnLease: ownedLease,
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          ok = false;
          result = {
            error: error instanceof Error ? error.message : "Tool execution failed",
          };
        }

        assertNotAborted(turnSignal);
        emit({
          type: "tool_end",
          name: toolCall.name,
          ok,
        });

        const toolContent = JSON.stringify(result);
        messages.push({
          role: "tool",
          content: toolContent,
          tool_call_id: toolCall.id,
          name: toolCall.name,
        });
        toolResults.push({ id: toolCall.id, name: toolCall.name, content: toolContent });
      }

      const assistantWithTools = await insertMessage(
        supabase,
        conversation.id,
        "assistant",
        roundText,
        ownedLease,
        {
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        },
      );
      lastAssistantMessageId = assistantWithTools.id;

      for (const toolResult of toolResults) {
        await insertMessage(supabase, conversation.id, "tool", toolResult.content, ownedLease, {
          tool_calls: { id: toolResult.id, name: toolResult.name },
        });
      }
    }

    if (!completedWithResponse || !lastAssistantMessageId) {
      throw new Error("Agent reached the maximum tool rounds without a durable assistant response");
    }

    const total = await countUserAssistantMessages(supabase, conversation.id);
    const allMessages = await listConversationMessages(supabase, conversation.id);
    await maybeAppendJournalAfterMessages(
      supabase,
      ctx.licenseNumber,
      ctx.websiteId,
      conversation.id,
      total,
      allMessages,
      ownedLease,
    );

    await settleTrace({ status: "completed" });

    emit({
      type: "done",
      assistantMessageId: lastAssistantMessageId,
    });
  } catch (error) {
    if (ownershipController.signal.aborted && !signal?.aborted) {
      try {
        emit({ type: "error", message: "Agent turn ownership was lost; please retry" });
      } catch {
        // Client already gone.
      }
      return;
    }

    if (isTurnCancelled(signal, error)) {
      if (!traceSettled) {
        await settleTrace({ status: "cancelled" });
      }
      try {
        emit({ type: "cancelled" });
      } catch {
        // Client already gone.
      }
      return;
    }

    if (isAgentTurnBusyError(error)) {
      emit({
        type: "error",
        message: error instanceof Error ? error.message : "Agent is busy — try again in a moment",
      });
      return;
    }

    await settleTrace({
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Agent turn failed",
    });
    throw error;
  } finally {
    stopHeartbeat?.();
    if (!ownershipController.signal.aborted) {
      await settleTrace({
        status: "error",
        errorMessage: "turn ended without completion",
      });
    }
  }
}

export function encodeSseEvent(event: AgentSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
