/** Shared Realtime broadcast channel for workspace job progress (admin + contractor). */
export function jobProgressChannelName(websiteId: string): string {
  return `obra-jobs:${websiteId}`;
}
