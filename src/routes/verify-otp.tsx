import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { OtpVerifyForm } from "@/components/OtpVerifyForm";
import { ObraLogoLink } from "@/components/ObraLogo";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  clearOtpVerifyContext,
  readOtpVerifyContext,
  type OtpVerifyContext,
} from "@/lib/auth/otp-verify-storage";
import { resendCheckoutOtp, verifyOtpAndLinkProfile } from "@/lib/checkout.functions";
import { contractorResumeTo, verifyOtpSearchSchema } from "@/lib/auth/contractor-return-path";
import { sendOtp, verifyOtp } from "@/lib/contractor-auth.functions";
import { NOINDEX_META } from "@/lib/seo";

export const Route = createFileRoute("/verify-otp")({
  validateSearch: verifyOtpSearchSchema,
  head: () => ({
    meta: [{ title: "Verify code | Obra" }, ...NOINDEX_META],
  }),
  component: VerifyOtpPage,
});

function VerifyOtpPage() {
  const { flow, next } = Route.useSearch();
  const navigate = useNavigate();
  const [context, setContext] = useState<OtpVerifyContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = readOtpVerifyContext();
    if (!stored || stored.flow !== flow) {
      void navigate(
        flow === "checkout"
          ? { to: "/admin", replace: true }
          : { to: "/login", search: next ? { next } : {}, replace: true },
      );
      return;
    }
    setContext(stored);
  }, [flow, navigate, next]);

  async function handleVerify(token: string) {
    if (!context) return;

    setError(null);
    setLoading(true);

    try {
      if (flow === "login") {
        const result = await verifyOtp({ data: { email: context.email, token } });
        if (result.session) {
          await supabaseBrowser.auth.setSession({
            access_token: result.session.access_token,
            refresh_token: result.session.refresh_token,
          });
        }
        clearOtpVerifyContext();
        await navigate(contractorResumeTo(next, result.profileId));
        return;
      }

      if (!context.session) {
        throw new Error("Missing checkout session");
      }

      const result = await verifyOtpAndLinkProfile({
        data: {
          checkoutSessionId: context.session,
          email: context.email,
          token,
        },
      });

      if (result.session) {
        await supabaseBrowser.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
      }

      clearOtpVerifyContext();
      // Purchase intent routes, not tagging outcome: a template id lands the
      // buyer in the purchaser flow even if the website row is not tagged yet
      // — Step 1 heals the row or surfaces a coded support state there.
      if (result.templateId) {
        await navigate({
          to: "/user/$userId",
          params: { userId: result.profileId },
          search: { websiteId: result.websiteId, templateId: result.templateId },
        });
      } else if (result.profileId) {
        await navigate({
          to: "/user/$userId",
          params: { userId: result.profileId },
          search: { websiteId: result.websiteId },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!context) return;
    if (flow === "checkout" && !context.session) return;
    setError(null);
    setResendMessage(null);
    setResending(true);
    try {
      if (flow === "login") {
        await sendOtp({ data: { identifier: context.email } });
      } else {
        await resendCheckoutOtp({
          data: { checkoutSessionId: context.session!, email: context.email },
        });
      }
      setResendMessage("A new verification code was sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resend verification code");
    } finally {
      setResending(false);
    }
  }

  if (!context) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  const maskedEmail = maskEmail(context.email);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <ObraLogoLink to="/" size={40} wordmarkClassName="text-xl" className="justify-center" />
          <h1 className="text-2xl font-semibold tracking-tight">Enter verification code</h1>
          <p className="text-sm text-muted-foreground">
            We sent a code to <span className="font-medium text-foreground">{maskedEmail}</span>
          </p>
        </div>

        <OtpVerifyForm onSubmit={handleVerify} loading={loading} error={error} />

        <div className="space-y-2 text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleResend()}
            disabled={loading || resending}
          >
            {resending ? "Sending…" : "Resend code"}
          </Button>
          {resendMessage && (
            <p className="text-sm text-muted-foreground" role="status">
              {resendMessage}
            </p>
          )}
        </div>

        {flow === "login" && (
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">
              Use a different license or email
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
