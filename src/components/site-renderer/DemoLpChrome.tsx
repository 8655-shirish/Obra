import { useEffect, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

import { LegalDocumentsPanel, type LegalDocumentSection } from "@/components/LegalDocumentsDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveOtpVerifyContext } from "@/lib/auth/otp-verify-storage";
import { createSaasCheckout } from "@/lib/checkout.functions";
import {
  LOWEST_MONTHLY_PRICE_USD,
  PLANS,
  PLAN_LABELS,
  PLANS_BY_ID,
  PLAN_COMPARISON_COPY,
  type PlanId,
} from "@/lib/plans";

const rootRoute = getRouteApi("__root__");

const DISCLAIMER =
  "All the contents in this website are for demo/preview purposes only and this is not meant to impersonate anyone";

export function DemoLpChrome({
  children,
  websiteId,
  templateSlug,
  templateId,
  prefill,
  showBuyCta,
  showDisclaimer = true,
}: {
  children: React.ReactNode;
  websiteId?: string;
  /**
   * Canonical template id for template-route purchases (e.g. "tpl_painter11").
   * Omitted for direct website buys. The legacy templateSlug prop resolves
   * through the registry when only it is present.
   */
  templateId?: string;
  /** @deprecated Prefer templateId; resolved through the registry when alone. */
  templateSlug?: string;
  showBuyCta: boolean;
  showDisclaimer?: boolean;
  prefill?: {
    licenseNumber?: string;
    businessName?: string;
    city?: string;
  };
}) {
  const navigate = useNavigate();
  const { checkoutEnabled } = rootRoute.useLoaderData();
  const purchaseAvailable = showBuyCta && checkoutEnabled;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"plan" | "details">("plan");
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [legalSection, setLegalSection] = useState<LegalDocumentSection | null>(null);

  const [email, setEmail] = useState("");
  const [licenseNumber, setLicenseNumber] = useState(prefill?.licenseNumber ?? "");
  const [businessName, setBusinessName] = useState(prefill?.businessName ?? "");
  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState(prefill?.city ?? "");

  useEffect(() => {
    if (prefill?.licenseNumber) setLicenseNumber(prefill.licenseNumber);
    if (prefill?.businessName) setBusinessName(prefill.businessName);
    if (prefill?.city) setCity(prefill.city);
  }, [prefill?.licenseNumber, prefill?.businessName, prefill?.city]);

  function resetDialog() {
    setStep("plan");
    setPlan(null);
    setError(null);
    setAcceptedLegal(false);
    setLegalSection(null);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!plan || !acceptedLegal) return;
    setError(null);
    setLoading(true);
    try {
      const result = await createSaasCheckout({
        data: {
          email,
          licenseNumber,
          businessName,
          fullName,
          city,
          ...(websiteId ? { websiteId } : {}),
          ...(templateId ? { templateId } : {}),
          ...(templateSlug ? { templateSlug } : {}),
          plan,
          acceptedLegal: true as const,
        },
      });
      if (result.kind === "otp") {
        saveOtpVerifyContext({
          flow: "checkout",
          email: result.email,
          session: result.checkoutSessionId,
        });
        setOpen(false);
        await navigate({ to: "/verify-otp", search: { flow: "checkout" } });
        return;
      }
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start checkout");
      setLoading(false);
    }
  }

  return (
    <div className="relative flex h-dvh min-h-0 flex-col bg-background">
      {showDisclaimer ? (
        <div
          className="relative z-[60] shrink-0 border-b border-[#dacdb9] bg-[#fff9ed] px-4 py-2.5 text-center text-xs leading-snug text-[#413627] sm:text-sm"
          role="status"
        >
          {DISCLAIMER}
        </div>
      ) : null}

      <div
        className={
          showBuyCta
            ? "min-h-0 flex-1 overflow-auto pb-[calc(4.25rem+env(safe-area-inset-bottom))]"
            : "min-h-0 flex-1 overflow-auto"
        }
      >
        {children}
      </div>

      {showBuyCta && (
        <aside
          aria-label="Template purchase"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(.75rem,env(safe-area-inset-bottom))]"
        >
          <Button
            type="button"
            size="lg"
            disabled={!purchaseAvailable}
            className="pointer-events-auto w-full max-w-md whitespace-normal text-center leading-tight shadow-[0_12px_40px_rgba(0,0,0,.18)]"
            onClick={() => {
              if (!purchaseAvailable) return;
              resetDialog();
              setOpen(true);
            }}
          >
            {purchaseAvailable ? (
              <>
                <span className="sm:hidden">
                  Use this template · from ${LOWEST_MONTHLY_PRICE_USD}/mo
                </span>
                <span className="hidden sm:inline">
                  Use this website template · plans from ${LOWEST_MONTHLY_PRICE_USD}/mo
                </span>
              </>
            ) : (
              <span>New purchases are temporarily unavailable</span>
            )}
          </Button>
        </aside>
      )}

      {purchaseAvailable && (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next && legalSection) {
              setLegalSection(null);
              return;
            }
            setOpen(next);
            if (!next) resetDialog();
          }}
        >
          <DialogContent
            className={
              legalSection
                ? "flex h-[min(85vh,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
                : "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
            }
          >
            {legalSection ? (
              <LegalDocumentsPanel scrollTo={legalSection} onBack={() => setLegalSection(null)} />
            ) : step === "plan" ? (
              <>
                <DialogHeader>
                  <DialogTitle>Choose a plan</DialogTitle>
                  <DialogDescription>{PLAN_COMPARISON_COPY}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PLANS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setPlan(item.id);
                        setStep("details");
                      }}
                      className={`rounded-2xl border p-4 text-left ${
                        item.highlight
                          ? "border-primary bg-card shadow-sm"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="mt-1 font-display text-3xl font-semibold">{item.price}</p>
                      <p className="text-xs text-muted-foreground">/month</p>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Get {plan ? PLAN_LABELS[plan] : "your plan"}</DialogTitle>
                  <DialogDescription>
                    {plan ? PLANS_BY_ID[plan].summary : "Choose a monthly plan."} No setup fee. You
                    will pay on Stripe, then verify your email.
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(e) => void handleSubmit(e)}
                  className="mt-2 grid gap-4 sm:grid-cols-2"
                >
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="demo-checkout-email">Email</Label>
                    <Input
                      id="demo-checkout-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-checkout-license">License number</Label>
                    <Input
                      id="demo-checkout-license"
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      required
                      readOnly={Boolean(prefill?.licenseNumber)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-checkout-business">Business name</Label>
                    <Input
                      id="demo-checkout-business"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-checkout-name">Full name</Label>
                    <Input
                      id="demo-checkout-name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-checkout-city">City</Label>
                    <Input
                      id="demo-checkout-city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex items-start gap-2 sm:col-span-2">
                    <Checkbox
                      id="demo-checkout-legal"
                      checked={acceptedLegal}
                      onCheckedChange={(value) => setAcceptedLegal(value === true)}
                    />
                    <Label
                      htmlFor="demo-checkout-legal"
                      className="text-sm font-normal leading-snug"
                    >
                      I have read and agree to the{" "}
                      <button
                        type="button"
                        className="text-primary underline underline-offset-4"
                        onClick={() => setLegalSection("terms")}
                      >
                        Master Services Agreement
                      </button>{" "}
                      and{" "}
                      <button
                        type="button"
                        className="text-primary underline underline-offset-4"
                        onClick={() => setLegalSection("privacy")}
                      >
                        Data Processing Addendum
                      </button>
                      .
                    </Label>
                  </div>
                  {error && (
                    <p className="text-sm text-destructive sm:col-span-2" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="button" variant="outline" onClick={() => setStep("plan")}>
                      Back
                    </Button>
                    <Button type="submit" className="flex-1" disabled={loading || !acceptedLegal}>
                      {loading ? "Redirecting…" : "Continue to payment"}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
