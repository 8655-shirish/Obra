import { getRequest } from "@tanstack/react-start/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_SENDS = 5;

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/** Returns auth.users id from Bearer token, or null if missing/invalid. */
export async function getContractorAuthUserId(): Promise<string | null> {
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

  const request = getRequest();
  const authHeader = request?.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "");
  if (!token || token.split(".").length !== 3) return null;

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}

export async function assertOtpRateLimit(
  supabaseAdmin: SupabaseClient<Database>,
  email: string,
  purpose: "login" | "checkout",
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const { error } = await supabaseAdmin.rpc("reserve_otp_send", {
    p_email: normalized,
    p_purpose: purpose,
    p_max_sends: OTP_MAX_SENDS,
    p_window_seconds: Math.floor(OTP_WINDOW_MS / 1000),
  });
  if (error?.message.includes("rate limit")) {
    throw new Error("Too many verification codes requested. Please wait and try again.");
  }
  if (error) {
    console.error("[assertOtpRateLimit]", error);
    throw new Error("Unable to reserve verification delivery");
  }
}
