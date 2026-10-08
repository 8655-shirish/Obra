import { useEffect, useState, type ReactNode } from "react";

import { LegalDocumentsDialog, type LegalDocumentSection } from "@/components/LegalDocumentsDialog";
import { ObraLogo } from "@/components/ObraLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyDemoLicense } from "@/lib/demo-license.functions";
import { readDemoLicenseUnlock, saveDemoLicenseUnlock } from "@/lib/demo-license-storage";

type GateStatus = "checking" | "locked" | "unlocked";

type DemoLicenseGateProps = {
  websiteId: string;
  versionId: string;
  licenseConfigured: boolean;
  children: (verifiedLicense: string) => ReactNode;
};

export function DemoLicenseGate({
  websiteId,
  versionId,
  licenseConfigured,
  children,
}: DemoLicenseGateProps) {
  const [status, setStatus] = useState<GateStatus>(() =>
    licenseConfigured ? "checking" : "locked",
  );
  const [verifiedLicense, setVerifiedLicense] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(!licenseConfigured);
  const [legalOpen, setLegalOpen] = useState(false);
  const [legalScrollTo, setLegalScrollTo] = useState<LegalDocumentSection | null>(null);

  useEffect(() => {
    if (!licenseConfigured) return;

    const existing = readDemoLicenseUnlock(websiteId, versionId);
    if (existing) {
      setVerifiedLicense(existing.licenseNumber);
      setStatus("unlocked");
    } else {
      setStatus("locked");
    }
  }, [websiteId, versionId, licenseConfigured]);

  function openLegal(section: LegalDocumentSection) {
    setLegalScrollTo(section);
    setLegalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await verifyDemoLicense({
        data: { websiteId, versionId, licenseNumber },
      });

      if (result.ok) {
        saveDemoLicenseUnlock(websiteId, versionId, licenseNumber);
        setVerifiedLicense(licenseNumber);
        setStatus("unlocked");
        return;
      }

      if (result.reason === "not_configured") {
        setNotConfigured(true);
        return;
      }

      setError("License number does not match this preview.");
    } catch {
      setError("Unable to verify license number. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (status === "checking") {
    return <div className="h-dvh min-h-0 bg-background" aria-busy="true" />;
  }

  if (status === "unlocked") {
    return <>{children(verifiedLicense)}</>;
  }

  if (notConfigured) {
    return (
      <div className="flex h-dvh min-h-0 items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <ObraLogo size={40} wordmarkClassName="text-xl" className="justify-center" />
          <p className="text-sm text-muted-foreground" role="alert">
            This preview is not available. Contact{" "}
            <a href="mailto:support@obra.com" className="text-primary underline underline-offset-4">
              support@obra.com
            </a>{" "}
            for help.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-dvh min-h-0 items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
          <div className="space-y-2 text-center">
            <ObraLogo size={40} wordmarkClassName="text-xl" className="justify-center" />
            <h1 className="text-2xl font-semibold tracking-tight">Preview your website</h1>
            <p className="text-sm text-muted-foreground">
              Enter your contractor license number to view this demo site.
            </p>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="demo-license-number">License number</Label>
              <Input
                id="demo-license-number"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                required
                autoComplete="off"
                disabled={loading}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Verifying…" : "Continue"}
            </Button>

            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              By clicking on Continue you agree to our{" "}
              <button
                type="button"
                className="text-primary underline underline-offset-4 hover:text-primary/80"
                onClick={() => openLegal("terms")}
              >
                Terms &amp; Conditions
              </button>{" "}
              and{" "}
              <button
                type="button"
                className="text-primary underline underline-offset-4 hover:text-primary/80"
                onClick={() => openLegal("privacy")}
              >
                Privacy Policy
              </button>
            </p>
          </form>
        </div>
      </div>

      <LegalDocumentsDialog open={legalOpen} onOpenChange={setLegalOpen} scrollTo={legalScrollTo} />
    </>
  );
}
