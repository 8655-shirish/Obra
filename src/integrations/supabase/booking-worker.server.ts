import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { workerSupabaseFetch } from "@/lib/worker-deadline.server";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Booking worker authority is unavailable");
  return value;
}

export const bookingWorker = createClient<Database>(
  required("VITE_SUPABASE_URL"),
  required("VITE_SUPABASE_PUBLISHABLE_KEY"),
  {
    global: { fetch: workerSupabaseFetch },
    accessToken: async () => required("SUPABASE_BOOKING_WORKER_KEY"),
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
