const STORAGE_KEY = "obra_otp_verify";

export interface OtpVerifyContext {
  flow: "login" | "checkout";
  email: string;
  session?: string;
}

export function saveOtpVerifyContext(context: OtpVerifyContext): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function readOtpVerifyContext(): OtpVerifyContext | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OtpVerifyContext;
    if (!parsed.flow || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOtpVerifyContext(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
