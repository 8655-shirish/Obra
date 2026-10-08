import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { saveOtpVerifyContext } from "@/lib/auth/otp-verify-storage";
import { finalizeStripeCheckout } from "@/lib/checkout.functions";
import { NOINDEX_META } from "@/lib/seo";

const searchSchema = z.object({
  session_id: z.string().min(1).optional(),
});

export const Route = createFileRoute("/checkout/success")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: "Checkout | Obra" }, ...NOINDEX_META],
  }),
  component: CheckoutSuccessPage,
});

function CheckoutSuccessPage() {
  const { session_id: sessionId } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError("Missing checkout session");
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const result = await finalizeStripeCheckout({ data: { sessionId } });
        if (cancelled) return;
        if (result.pending) {
          retryTimer = setTimeout(() => void check(), 2_000);
          return;
        }
        if (!result.checkoutSessionId || !result.email) {
          throw new Error("Checkout confirmation is incomplete");
        }
        if (result.completed && result.websiteId) {
          if (result.profileId) {
            await navigate({
              to: "/user/$userId",
              params: { userId: result.profileId },
              search: {
                websiteId: result.websiteId,
                ...(result.templateId ? { templateId: result.templateId } : {}),
              },
              replace: true,
            });
          } else {
            throw new Error("Unable to resolve purchased workspace");
          }
          return;
        }
        saveOtpVerifyContext({
          flow: "checkout",
          email: result.email,
          session: result.checkoutSessionId,
        });
        await navigate({ to: "/verify-otp", search: { flow: "checkout" }, replace: true });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to check payment status");
        }
      }
    };
    void check();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [sessionId, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground" role={error ? "alert" : "status"}>
        {error ?? "Payment received. Sending your verification code…"}
      </p>
    </div>
  );
}
