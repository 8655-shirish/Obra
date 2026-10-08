import type { OpenAiTool } from "./lovable-ai.server";
import { AGENT_TOOL_REGISTRY } from "./tools/registry";

const TOOL_PARAMETERS: Record<string, Record<string, unknown>> = {
  getEnrichmentSummary: {
    type: "object",
    properties: {},
  },
  publishToLp: {
    type: "object",
    properties: {
      versionId: { type: "string" },
      expectedRevision: { type: "number" },
    },
    required: ["versionId", "expectedRevision"],
  },
  suggestCopy: {
    type: "object",
    properties: {
      sectionId: { type: "string" },
      enrichmentFieldRefs: { type: "array", items: { type: "string" } },
    },
    required: ["sectionId", "enrichmentFieldRefs"],
  },
  applyTemplatePatch: {
    type: "object",
    properties: {
      versionId: { type: "string" },
      expectedRevision: { type: "number" },
      patch: {
        type: "object",
        properties: {
          text: { type: "object" },
          media: { type: "object" },
          reviews: { type: "array" },
          blogs: { type: "array" },
          contact: { type: "object" },
          identity: { type: "object" },
        },
      },
    },
    required: ["versionId", "expectedRevision", "patch"],
  },
};

/** OpenAI-compatible tool definitions for the Lovable AI gateway. */
export const OPENAI_AGENT_TOOLS: OpenAiTool[] = AGENT_TOOL_REGISTRY.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: TOOL_PARAMETERS[tool.name] ?? { type: "object", properties: {} },
  },
}));

export function getRegisteredToolNames(): string[] {
  return AGENT_TOOL_REGISTRY.map((t) => t.name);
}
