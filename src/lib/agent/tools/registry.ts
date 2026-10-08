import type { ToolDefinition } from "./schemas";
import { toolInputSchemas, toolOutputSchemas, type ToolName } from "./schemas";

export const AGENT_TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: "getEnrichmentSummary",
    type: "read",
    description:
      "Return grounded summary from contractor_profiles.enrichment_json only, including listed-website classification",
    serverOnly: true,
  },
  {
    name: "publishToLp",
    type: "write",
    description: "Publish approved version to live /lp/$websiteId",
    serverOnly: true,
  },
  {
    name: "suggestCopy",
    type: "read",
    description: "AI copy suggestion citing enrichment source fields only",
    serverOnly: true,
  },
  {
    name: "applyTemplatePatch",
    type: "write",
    description:
      "Write text/media/reviews/blogs/contact/identity keys into a template-kind version overlay. Mold, layout, and hero motion are unreachable; unknown keys are rejected.",
    serverOnly: true,
  },
];

export function getToolDefinition(name: ToolName): ToolDefinition | undefined {
  return AGENT_TOOL_REGISTRY.find((t) => t.name === name);
}

export function parseToolInput<T extends ToolName>(
  name: T,
  payload: unknown,
): ReturnType<(typeof toolInputSchemas)[T]["parse"]> {
  return toolInputSchemas[name].parse(payload) as ReturnType<(typeof toolInputSchemas)[T]["parse"]>;
}

export function parseToolOutput<T extends ToolName>(
  name: T,
  payload: unknown,
): ReturnType<(typeof toolOutputSchemas)[T]["parse"]> {
  return toolOutputSchemas[name].parse(payload) as ReturnType<
    (typeof toolOutputSchemas)[T]["parse"]
  >;
}

export function getToolUsePromptLines(options?: { exclude?: string[] }): string {
  const excluded = new Set(options?.exclude ?? []);
  return AGENT_TOOL_REGISTRY.filter((tool) => !excluded.has(tool.name))
    .map((t) => `- ${t.name} (${t.type}): ${t.description}`)
    .join("\n");
}
