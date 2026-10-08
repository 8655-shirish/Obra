/**
 * Signed webhook HMAC is over the exact wire body. h3 auto-parses
 * `application/json` POSTs and can re-serialize them, so these routes must
 * never enter h3 as JSON. The Worker entry reads the body once and rebuilds
 * the Request with a non-JSON content-type; handlers then `request.text()`.
 */

export const RAW_BODY_WEBHOOK_PATHS = new Set([
  "/api/stripe/webhook",
  "/api/stripe/connect-webhook",
  "/api/pipedream/webhook",
]);

export const UNPARSED_WEBHOOK_CONTENT_TYPE = "application/octet-stream";

export function isRawBodyWebhookPath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return RAW_BODY_WEBHOOK_PATHS.has(normalized);
}

export async function withUnparsedWebhookBody(request: Request): Promise<Request> {
  if (request.method !== "POST") return request;
  if (!isRawBodyWebhookPath(new URL(request.url).pathname)) return request;
  const rawBody = await request.text();
  const headers = new Headers(request.headers);
  headers.set("content-type", UNPARSED_WEBHOOK_CONTENT_TYPE);
  return new Request(request.url, {
    method: request.method,
    headers,
    body: rawBody,
  });
}
