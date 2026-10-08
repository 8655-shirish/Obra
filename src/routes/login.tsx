import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ObraLogoLink } from "@/components/ObraLogo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  contractorLoginSearchSchema,
  contractorResumeTo,
  safeContractorReturnPath,
} from "@/lib/auth/contractor-return-path";
import { saveOtpVerifyContext } from "@/lib/auth/otp-verify-storage";
import { getContractorSessionProfile, sendOtp } from "@/lib/contractor-auth.functions";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/login")({
  validateSearch: contractorLoginSearchSchema,
  head: () => ({
    meta: [{ title: "Log in | Obra" }, ...NOINDEX_META],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabaseBrowser.auth.getSession();
        if (!data.session) {
          if (!cancelled) setResuming(false);
          return;
        }
        const { profileId } = await getContractorSessionProfile();
        if (cancelled) return;
        await navigate({ ...contractorResumeTo(next, profileId), replace: true });
      } catch {
        if (!cancelled) setResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await sendOtp({ data: { identifier } });
      saveOtpVerifyContext({ flow: "login", email: result.email });
      const resume = safeContractorReturnPath(next);
      await navigate({
        to: "/verify-otp",
        search: resume ? { flow: "login", next: resume } : { flow: "login" },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send code");
    } finally {
      setLoading(false);
    }
  }

  if (resuming) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground" role="status">
          Continuing to your workspace…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <ObraLogoLink to="/" size={40} wordmarkClassName="text-xl" className="justify-center" />
          <h1 className="text-2xl font-semibold tracking-tight">Contractor login</h1>
          <p className="text-sm text-muted-foreground">
            Enter your license number or email. We&apos;ll send a one-time code.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">License number or email</Label>
            <Input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="C-123456 or you@company.com"
              autoComplete="username"
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending code…" : "Send verification code"}
          </Button>
        </form>
      </div>
    </div>
  );
}
