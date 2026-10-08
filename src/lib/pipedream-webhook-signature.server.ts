import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifiedPipedreamSignature = { timestamp: number };

function equalHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyPipedreamSignature(input: {
  header: string;
  rawBody: string;
  secret: string;
  nowMs?: number;
  maxAgeSeconds?: number;
}): VerifiedPipedreamSignature | null {
  const parts = new Map<string, string[]>();
  for (const part of input.header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (!key || value === undefined) continue;
    parts.set(key, [...(parts.get(key) ?? []), value]);
  }
  const timestampText = parts.get("t")?.at(0) ?? "";
  const signatures = parts.get("v1") ?? [];
  if (!/^\d{10}$/.test(timestampText) || !signatures.length) return null;
  const timestamp = Number(timestampText);
  const nowMs = input.nowMs ?? Date.now();
  const maxAge = input.maxAgeSeconds ?? 300;
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowMs / 1000 - timestamp) > maxAge) return null;
  const expected = createHmac("sha256", input.secret)
    .update(timestampText + "." + input.rawBody)
    .digest("hex");
  if (
    !signatures.some(
      (signature) =>
        /^[a-f0-9]{64}$/i.test(signature) && equalHex(expected, signature.toLowerCase()),
    )
  )
    return null;
  return { timestamp };
}
