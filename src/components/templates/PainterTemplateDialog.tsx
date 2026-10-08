import { useEffect, useState, type ComponentProps } from "react";

import { DialogContent } from "@/components/ui/dialog";

import "./painter-template-dialog.css";

export function PainterTemplateDialog({
  children,
  className = "",
  ...props
}: ComponentProps<typeof DialogContent>) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!element || !viewport) return;
    function resize() {
      if (!element || !viewport) return;
      element.style.setProperty("--pt-viewport-width", `${viewport.width}px`);
      element.style.setProperty("--pt-viewport-height", `${viewport.height}px`);
      element.style.setProperty("--pt-viewport-left", `${viewport.offsetLeft}px`);
      element.style.setProperty("--pt-viewport-top", `${viewport.offsetTop}px`);
    }
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, [element]);

  return (
    <DialogContent {...props} ref={setElement} className={`pt-dialog ${className}`}>
      {/* The close action belongs to the shell, never the scrolling article. */}
      <div className="pt-dialog-scroll">{children}</div>
    </DialogContent>
  );
}
