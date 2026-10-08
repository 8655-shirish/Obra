import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import msaMarkdown from "@/content/legal/msa.md?raw";
import dpaMarkdown from "@/content/legal/dpa.md?raw";

export type LegalDocumentSection = "terms" | "privacy";

type LegalDocumentsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scrollTo?: LegalDocumentSection | null;
};

const markdownClassName =
  "space-y-3 text-sm leading-relaxed text-muted-foreground [&_h1]:mb-4 [&_h1]:mt-8 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-foreground [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5";

export function LegalDocumentsPanel({
  scrollTo,
  onBack,
}: {
  scrollTo?: LegalDocumentSection | null;
  onBack: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const termsRef = useRef<HTMLDivElement>(null);
  const privacyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = scrollTo === "privacy" ? privacyRef.current : termsRef.current;
      const scroller = scrollerRef.current;
      if (!target || !scroller) return;
      const top =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      scroller.scrollTop = Math.max(0, top);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollTo]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="shrink-0 border-b border-border px-6 py-4 text-left">
        <DialogTitle>Legal documents</DialogTitle>
        <DialogDescription>
          Master Services Agreement and Data Processing Addendum
        </DialogDescription>
      </DialogHeader>
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4"
      >
        <div className="space-y-10 pb-4">
          <div id="terms" ref={termsRef} className={markdownClassName}>
            <h2 className="!mt-0 text-xl font-semibold text-foreground">Terms &amp; Conditions</h2>
            <ReactMarkdown>{msaMarkdown}</ReactMarkdown>
          </div>
          <div id="privacy" ref={privacyRef} className={markdownClassName}>
            <h2 className="!mt-0 text-xl font-semibold text-foreground">Privacy Policy</h2>
            <ReactMarkdown>{dpaMarkdown}</ReactMarkdown>
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-border px-6 py-4">
        <Button type="button" variant="outline" onClick={onBack}>
          Go back
        </Button>
      </div>
    </div>
  );
}

export function LegalDocumentsDialog({ open, onOpenChange, scrollTo }: LegalDocumentsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(85vh,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <LegalDocumentsPanel scrollTo={scrollTo} onBack={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
