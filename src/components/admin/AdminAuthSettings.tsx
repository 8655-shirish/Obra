import { useState } from "react";

import { Button } from "@/components/ui/button";
import { adminLogoutEverywhere } from "@/lib/admin.functions";

export function AdminAuthSettings({ onSessionEnded }: { onSessionEnded: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin security action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Admin authentication</h2>
        <p className="text-sm text-muted-foreground">
          Admin access uses one fixed credential pair. Signing out everywhere ends every active
          admin session immediately.
        </p>
      </div>
      <Button
        type="button"
        variant="destructive"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await adminLogoutEverywhere();
            await onSessionEnded();
          }, "All admin sessions signed out.")
        }
      >
        Sign out all admin sessions
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </section>
  );
}
