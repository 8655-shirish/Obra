import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  adminImpersonateUser,
  getAdminConversationMessages,
  listAdminConversations,
  listAdminEditEvents,
  listAdminJobChains,
  listAdminLeads,
  listAdminUsers,
  listAdminWebsites,
} from "@/lib/admin.functions";

type TabKey = "users" | "websites" | "conversations" | "edits" | "leads" | "jobs";

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function AdminRecordsPanel() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("users");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedConversationId, setExpandedConversationId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<
    Array<{ id: string; role: string; content: string; created_at: string }>
  >([]);
  const [workspaceOpenError, setWorkspaceOpenError] = useState<string | null>(null);
  const [openingProfileId, setOpeningProfileId] = useState<string | null>(null);
  const limit = 50;

  async function openWorkspace(profileId: string) {
    if (!profileId || openingProfileId) return;
    setWorkspaceOpenError(null);
    setOpeningProfileId(profileId);
    try {
      await adminImpersonateUser({ data: { profileId } });
      await navigate({ to: "/user/$userId", params: { userId: profileId } });
    } catch (err) {
      setWorkspaceOpenError(
        err instanceof Error ? err.message : "Unable to open workspace",
      );
    } finally {
      setOpeningProfileId(null);
    }
  }

  useEffect(() => {
    setLoading(true);
    const loader =
      tab === "users"
        ? listAdminUsers
        : tab === "websites"
          ? listAdminWebsites
          : tab === "conversations"
            ? listAdminConversations
            : tab === "edits"
              ? listAdminEditEvents
              : tab === "leads"
                ? listAdminLeads
                : listAdminJobChains;

    loader({ data: { limit, offset } })
      .then((result) => {
        setRows(result.rows as Record<string, unknown>[]);
        setTotal(result.total);
      })
      .finally(() => setLoading(false));
  }, [tab, offset]);

  async function loadConversationMessages(conversationId: string) {
    if (expandedConversationId === conversationId) {
      setExpandedConversationId(null);
      setConversationMessages([]);
      return;
    }
    const result = await getAdminConversationMessages({ data: { conversationId } });
    setExpandedConversationId(conversationId);
    setConversationMessages(result.messages);
  }

  const tableHeaders: Record<TabKey, string[]> = {
    users: ["License", "Name", "Email", "Subscription", "Activated", "Created"],
    websites: ["License", "Status", "Research", "Public URL", "Created"],
    conversations: ["Phase", "Website", "Summary", "Created"],
    edits: ["Category", "Website", "Version", "Created"],
    leads: ["License", "Website", "Form data", "Created"],
    jobs: ["Chain", "Type", "Status", "Seq", "Website", "Completed"],
  };

  function renderRow(row: Record<string, unknown>, tabKey: TabKey) {
    switch (tabKey) {
      case "users":
        const subs = row.subscriptions as
          | Array<{ status?: string }>
          | { status?: string }
          | null;
        const subStatus = Array.isArray(subs)
          ? subs[0]?.status
          : subs && typeof subs === "object"
            ? subs.status
            : null;
        return [
          row.license_number,
          row.full_name,
          row.email,
          subStatus,
          row.auth_user_id ? "yes" : "no",
          row.created_at,
        ];
      case "websites":
        return [
          row.license_number,
          row.status,
          row.research_status,
          row.public_url,
          row.created_at,
        ];
      case "conversations":
        return [row.phase, row.website_id, row.summary, row.created_at];
      case "edits":
        return [row.category, row.website_id, row.version_id, row.created_at];
      case "leads":
        return [row.license_number, row.website_id, row.form_data, row.created_at];
      case "jobs":
        return [
          row.chain_id,
          row.job_type,
          row.status,
          row.sequence_index,
          row.website_id,
          row.completed_at,
        ];
      default:
        return [];
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Records</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Users, websites, chat, edits, leads, and background job chains (paginated).
      </p>
      {workspaceOpenError && (
        <p className="mt-2 text-sm text-destructive">{workspaceOpenError}</p>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as TabKey);
          setOffset(0);
          setExpandedConversationId(null);
        }}
        className="mt-4"
      >
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="websites">Sites</TabsTrigger>
          <TabsTrigger value="conversations">Chat</TabsTrigger>
          <TabsTrigger value="edits">Edits</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    {tableHeaders[tab].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                    {tab === "conversations" && <th className="px-3 py-2 font-medium">Messages</th>}
                    {(tab === "users" || tab === "websites" || tab === "conversations") && (
                      <th className="px-3 py-2 font-medium">Open</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 align-top">
                      {renderRow(row, tab).map((cell, j) => (
                        <td key={j} className="px-3 py-2 max-w-xs truncate font-mono text-xs">
                          {formatCell(cell)}
                        </td>
                      ))}
                      {tab === "conversations" && (
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void loadConversationMessages(String(row.id))}
                          >
                            {expandedConversationId === row.id ? "Hide" : "View"}
                          </Button>
                        </td>
                      )}
                      {tab === "users" && (
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={openingProfileId === String(row.id)}
                            onClick={() => void openWorkspace(String(row.id))}
                          >
                            {openingProfileId === String(row.id) ? "Opening…" : "Open workspace"}
                          </Button>
                        </td>
                      )}
                      {tab === "websites" && (
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={openingProfileId === String(row.user_id)}
                            onClick={() => void openWorkspace(String(row.user_id))}
                          >
                            {openingProfileId === String(row.user_id) ? "Opening…" : "Open workspace"}
                          </Button>
                        </td>
                      )}
                      {tab === "conversations" && (
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={openingProfileId === String(row.user_id)}
                            onClick={() => void openWorkspace(String(row.user_id))}
                          >
                            {openingProfileId === String(row.user_id) ? "Opening…" : "Open workspace"}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={10}>No rows</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "conversations" && expandedConversationId && conversationMessages.length > 0 && (
            <div className="mt-4 rounded-md border border-border p-4 space-y-2 max-h-64 overflow-auto">
              <p className="text-xs font-medium text-muted-foreground">Message history</p>
              {conversationMessages.map((m) => (
                <div key={m.id} className="rounded bg-muted/30 px-3 py-2 text-xs">
                  <span className="font-semibold capitalize">{m.role}</span>
                  <span className="text-muted-foreground"> · {m.created_at}</span>
                  <p className="mt-1 whitespace-pre-wrap">{m.content.slice(0, 500)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0 || loading}
                onClick={() => setOffset((o) => Math.max(0, o - limit))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + limit >= total || loading}
                onClick={() => setOffset((o) => o + limit)}
              >
                Next
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
