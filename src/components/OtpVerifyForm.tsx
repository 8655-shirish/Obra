import { OTPInput, OTPInputContext } from "input-otp";
import { useContext, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OtpVerifyFormProps {
  onSubmit: (token: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

export function OtpVerifyForm({ onSubmit, loading, error }: OtpVerifyFormProps) {
  const [value, setValue] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (value.length < 6) return;
    await onSubmit(value);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <OTPInput
        maxLength={6}
        value={value}
        onChange={setValue}
        containerClassName="flex justify-center gap-2"
        disabled={loading}
      >
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <OtpSlot key={index} index={index} />
          ))}
        </div>
      </OTPInput>

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={loading || value.length < 6}>
        {loading ? "Verifying…" : "Verify and continue"}
      </Button>
    </form>
  );
}

function OtpSlot({ index, className }: { index: number; className?: string }) {
  const inputOTPContext = useContext(OTPInputContext);
  const slot = inputOTPContext?.slots[index];
  const char = slot?.char ?? null;
  const isActive = slot?.isActive ?? false;

  return (
    <div
      className={cn(
        "relative flex h-12 w-10 items-center justify-center rounded-md border border-input text-lg font-semibold",
        isActive && "z-10 ring-2 ring-ring ring-offset-2",
        className,
      )}
    >
      {char}
    </div>
  );
}
