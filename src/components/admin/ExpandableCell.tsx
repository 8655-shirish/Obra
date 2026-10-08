import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function prettyPrint(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Truncated table cell — click anywhere on it to open a popup with the full,
 * pretty-printed (JSON-aware) text. Used across every table on /admin/traces.
 */
export function ExpandableCell({
  value,
  title,
  className = "max-w-xs",
}: {
  value: unknown;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const text = prettyPrint(value);
  const isEmpty = text === "—";

  return (
    <>
      <button
        type="button"
        disabled={isEmpty}
        onClick={() => setOpen(true)}
        className={`block truncate text-left font-mono text-xs ${className} ${
          isEmpty ? "cursor-default text-muted-foreground" : "cursor-pointer hover:underline"
        }`}
        title={isEmpty ? undefined : "Click to expand"}
      >
        {text}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title ?? "Full value"}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-4 text-xs">
            {text}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
