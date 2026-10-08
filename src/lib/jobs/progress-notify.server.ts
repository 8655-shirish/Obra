import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import { jobProgressChannelName } from "./progress-channel";

type SupabaseAdmin = SupabaseClient<Database>;

const NOTIFY_TIMEOUT_MS = 2500;
const NOTIFY_DEBOUNCE_MS = 400;

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Realtime broadcast so workspace clients (contractor + impersonating admin) refresh
 * job progress without relying on RLS-gated postgres_changes for admin sessions.
 */
export async function notifyJobProgressUpdate(
  supabase: SupabaseAdmin,
  websiteId: string,
): Promise<void> {
  const channelName = jobProgressChannelName(websiteId);
  const channel = supabase.channel(channelName);

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      void supabase.removeChannel(channel);
      resolve();
    };

    const timeout = setTimeout(finish, NOTIFY_TIMEOUT_MS);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel
          .send({
            type: "broadcast",
            event: "progress",
            payload: { websiteId },
          })
          .finally(() => {
            clearTimeout(timeout);
            finish();
          });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        finish();
      }
    });
  });
}

/** Coalesce rapid job row updates into one broadcast per website. */
export function scheduleJobProgressNotify(
  supabase: SupabaseAdmin,
  websiteId: string,
): void {
  const existing = debounceTimers.get(websiteId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(websiteId);
    void notifyJobProgressUpdate(supabase, websiteId).catch((err) => {
      console.error("[scheduleJobProgressNotify]", err);
    });
  }, NOTIFY_DEBOUNCE_MS);

  debounceTimers.set(websiteId, timer);
}
