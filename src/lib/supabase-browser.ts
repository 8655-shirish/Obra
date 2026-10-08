import { createClient } from "@supabase/supabase-js";

import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import type { Database } from "@/integrations/supabase/types";

// These are public browser credentials, not secrets. The explicit fallbacks keep
// production auth available if the hosting build omits its generated VITE_* values.
const CLOUD_URL = "https://bccoopjayvqraywtvmrh.supabase.co";
const CLOUD_PUBLISHABLE_KEY = "sb_publishable_YFytWzjZ5n7akkpuVUXObQ_86fWDSPd";

const url = import.meta.env.VITE_SUPABASE_URL || CLOUD_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || CLOUD_PUBLISHABLE_KEY;

function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (headers.get("Authorization") === `Bearer ${apiKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}

export const supabaseBrowser = createClient<Database>(url, publishableKey, {
  global: { fetch: createSupabaseFetch(publishableKey) },
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});