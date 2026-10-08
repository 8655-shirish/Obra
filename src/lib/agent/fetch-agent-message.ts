import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Browser POST to `/api/agent/message`. The route authenticates through
 * `getContractorAuthUserId` (Bearer only). Server functions get that header
 * from `attachSupabaseAuth`; raw fetch does not. Every browser caller uses
 * this so the session cannot be omitted.
 */
export async function fetchAgentMessage(
  body: unknown,
  init?: { signal?: AbortSignal },
): Promise<Response> {
  const { data } = await supabaseBrowser.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return fetch("/api/agent/message", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
    signal: init?.signal,
    body: JSON.stringify(body),
  });
}
