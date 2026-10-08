import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import type { MessageRow } from "./conversation.server";

type SupabaseAdmin = SupabaseClient<Database>;

const JOURNAL_BUCKET = "journals";

export function journalStoragePath(licenseNumber: string): string {
  const normalized = licenseNumber
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-");
  return `journal-${normalized}.md`;
}

export async function loadJournalMarkdown(
  supabase: SupabaseAdmin,
  licenseNumber: string,
  websiteId: string,
): Promise<string | null> {
  const path = journalStoragePath(licenseNumber);
  const [storedJournal, checkpoints] = await Promise.all([
    supabase.storage.from(JOURNAL_BUCKET).download(path),
    supabase
      .from("agent_journal_checkpoints")
      .select("section_title, section_body")
      .eq("website_id", websiteId)
      .order("created_at", { ascending: true })
      .order("trace_id", { ascending: true }),
  ]);

  let legacyMarkdown: string | null = null;
  if (!storedJournal.error) {
    legacyMarkdown = await storedJournal.data.text();
  } else if (
    !storedJournal.error.message?.includes("not found") &&
    (storedJournal.error as { statusCode?: string }).statusCode !== "404"
  ) {
    console.error("[loadJournalMarkdown]", storedJournal.error);
  }

  if (checkpoints.error) {
    console.error("[loadJournalMarkdown checkpoints]", checkpoints.error);
  }
  const checkpointMarkdown = (checkpoints.data ?? [])
    .map((checkpoint) => `## ${checkpoint.section_title}\n\n${checkpoint.section_body}`)
    .join("\n\n");
  return [legacyMarkdown, checkpointMarkdown].filter(Boolean).join("\n\n") || null;
}

export async function maybeAppendJournalAfterMessages(
  supabase: SupabaseAdmin,
  licenseNumber: string,
  websiteId: string,
  conversationId: string,
  totalMessageCount: number,
  recentMessages: MessageRow[],
  lease: { traceId: string; ownerToken: string },
): Promise<void> {
  if (totalMessageCount === 0 || totalMessageCount % 10 !== 0) return;

  const summaryLines = recentMessages
    .slice(-10)
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join("\n");
  const sectionTitle = `Conversation checkpoint (${totalMessageCount} messages)`;

  // Checkpoint projection is fenced but best-effort. The durable messages and tool effects
  // remain the source of truth when this derived summary cannot be persisted.
  const { error } = await supabase.rpc("record_agent_journal_checkpoint_owned", {
    p_website_id: websiteId,
    p_trace_id: lease.traceId,
    p_owner_token: lease.ownerToken,
    p_conversation_id: conversationId,
    p_message_count: totalMessageCount,
    p_section_title: sectionTitle,
    p_section_body: summaryLines,
  });
  if (error) {
    // The answer and any tool effects are already durable. Checkpoint projection is
    // best-effort; complete_agent_turn remains the authoritative ownership fence.
    console.error("[maybeAppendJournalAfterMessages checkpoint]", error);
  }

  // Storage projection is intentionally not written by the live turn: object storage
  // cannot participate in the ownership transaction. A projector may render this row later.
  void licenseNumber;
}
