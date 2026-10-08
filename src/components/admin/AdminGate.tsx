import { useEffect, useState } from "react";

import { ObraLogoLink } from "@/components/ObraLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminLogin, adminLogout, getAdminStatus } from "@/lib/admin.functions";

/** Shared admin auth gate: single fixed credential pair, no setup or recovery flows. */
export function AdminGate({
  children,
}: {
  children: (props: { onLogout: () => Promise<void> }) => React.ReactNode;
}) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    getAdminStatus()
      .then((status) => setAuthenticated(status.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!authenticated) return <AdminLoginForm onSuccess={() => setAuthenticated(true)} />;

  return (
    <>
      {children({
        onLogout: async () => {
          await adminLogout();
          setAuthenticated(false);
        },
      })}
    </>
  );
}

function AdminLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminLogin({ data: { username, password } });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <ObraLogoLink to="/" size={40} wordmarkClassName="text-xl" className="justify-center" />
          <h1 className="text-2xl font-semibold tracking-tight">Admin login</h1>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-email">Email</Label>
            <Input
              id="admin-email"
              type="email"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Working…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
