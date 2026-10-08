export type PipedreamTriggerDefinition = {
  // Optional extra evidence only; the Connect contract promises key/version, not id.
  // https://pipedream.com/docs/connect/api-reference/retrieve-trigger
  id?: string;
  key: string;
  name: string;
  version: string;
  configurableProps: unknown[];
};

export type PipedreamDeployedTrigger = {
  id: string;
  componentId: string;
  componentKey: string | null;
  configuredProps: Record<string, unknown>;
  active: boolean;
  webhookSigningKey: string | null;
};

export function parsePipedreamTriggerDefinition(value: unknown): PipedreamTriggerDefinition {
  if (!value || typeof value !== "object") throw new Error("Pipedream returned an invalid trigger");
  const row = value as Record<string, unknown>;
  if (
    (row.id !== undefined && (typeof row.id !== "string" || !/^sc_[A-Za-z0-9]+$/.test(row.id))) ||
    typeof row.key !== "string" ||
    !row.key.trim() ||
    typeof row.name !== "string" ||
    typeof row.version !== "string" ||
    !row.version.trim() ||
    !Array.isArray(row.configurable_props)
  )
    throw new Error("Pipedream returned an invalid trigger");
  return {
    ...(typeof row.id === "string" ? { id: row.id } : {}),
    key: row.key,
    name: row.name,
    version: row.version,
    configurableProps: row.configurable_props,
  };
}

export function parsePipedreamDeployedTrigger(value: unknown): PipedreamDeployedTrigger {
  if (!value || typeof value !== "object")
    throw new Error("Pipedream returned an invalid deployed trigger");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !row.id.trim() ||
    typeof row.component_id !== "string" ||
    !row.component_id.trim() ||
    (row.component_key != null &&
      (typeof row.component_key !== "string" || !row.component_key.trim())) ||
    typeof row.active !== "boolean" ||
    !row.configured_props ||
    typeof row.configured_props !== "object" ||
    Array.isArray(row.configured_props)
  )
    throw new Error("Pipedream returned an invalid deployed trigger");
  return {
    id: row.id,
    componentId: row.component_id,
    componentKey: typeof row.component_key === "string" ? row.component_key : null,
    configuredProps: row.configured_props as Record<string, unknown>,
    active: row.active,
    webhookSigningKey: typeof row.webhook_signing_key === "string" ? row.webhook_signing_key : null,
  };
}

export function parseConfiguredPipedreamWebhook(value: unknown, expectedUrl: string) {
  if (!value || typeof value !== "object")
    throw new Error("Pipedream returned no trigger webhooks");
  const response = value as { webhook_urls?: unknown; webhooks?: unknown };
  if (!Array.isArray(response.webhook_urls) || !Array.isArray(response.webhooks))
    throw new Error("Pipedream returned no trigger webhooks");
  const webhook = response.webhooks.find(
    (item) => item && typeof item === "object" && (item as { url?: unknown }).url === expectedUrl,
  ) as Record<string, unknown> | undefined;
  if (!webhook || typeof webhook.id !== "string" || typeof webhook.signing_key !== "string")
    throw new Error("Pipedream returned no webhook signing key");
  return { id: webhook.id, signingKey: webhook.signing_key };
}
