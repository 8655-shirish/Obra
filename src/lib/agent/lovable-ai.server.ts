import { createAbortError } from "./abort.server.ts";

const DEFAULT_API_BASE_URL = "https://consilium.workday.lovable.app/api/public/v1";
const DEFAULT_MODEL = "openai/gpt-5.6-sol";

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  tools?: OpenAiTool[];
  signal?: AbortSignal;
  onToken: (text: string) => void;
  onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
}

function getAiProviderConfig(): { apiKey: string; endpoint: string; model: string } {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error("AI_API_KEY is not configured");
  }

  const baseUrl =
    process.env.AI_BASE_URL ?? process.env.LOVABLE_AI_GATEWAY_URL ?? DEFAULT_API_BASE_URL;
  return {
    apiKey,
    endpoint: chatCompletionsUrl(baseUrl),
    model: process.env.AI_MODEL ?? process.env.LOVABLE_AI_MODEL ?? DEFAULT_MODEL,
  };
}

export async function streamChatCompletion(options: StreamChatOptions): Promise<{
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}> {
  const { apiKey, endpoint, model } = getAiProviderConfig();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: options.signal,
    body: JSON.stringify({
      model,
      messages: options.messages,
      tools: options.tools?.length ? options.tools : undefined,
      // GPT-5.6 on /v1/chat/completions rejects tool calls unless reasoning is off.
      // The generator (and other no-tool calls) must keep reasoning — identical
      // pages were partly this flag leaking onto generate.
      ...(model.startsWith("openai/gpt-5.6") && options.tools?.length
        ? { reasoning_effort: "none" }
        : {}),
      stream: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI gateway error (${response.status}): ${body.slice(0, 300)}`);
  }

  if (!response.body) {
    throw new Error("AI gateway returned empty body");
  }

  let content = "";
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  const toolBuffers = new Map<number, { id: string; name: string; arguments: string }>();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalMarkerReceived = false;

  while (true) {
    if (options.signal?.aborted) {
      await reader.cancel();
      throw createAbortError();
    }

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        terminalMarkerReceived = true;
        continue;
      }

      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };

        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          options.onToken(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolBuffers.get(tc.index) ?? {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: "",
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            toolBuffers.set(tc.index, existing);
          }
        }
      } catch {
        // skip malformed SSE chunks
      }
    }
  }

  if (!terminalMarkerReceived) {
    throw new Error("AI gateway stream ended before completion");
  }

  for (const tc of toolBuffers.values()) {
    if (tc.id && tc.name) {
      toolCalls.push(tc);
      options.onToolCall?.(tc);
    }
  }

  return { content, toolCalls };
}
