async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getPreviewSecret(): string | null {
  return (
    process.env.PREVIEW_TOKEN_SECRET ||
    process.env.JOB_RUNNER_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    null
  );
}

/** Deterministic owner preview token for `/lp/:id?preview=…` on non-live sites. */
export async function createOwnerPreviewToken(websiteId: string): Promise<string | null> {
  const secret = getPreviewSecret();
  if (!secret) return null;
  return hmacSha256Hex(secret, websiteId);
}

export async function buildOwnerPreviewUrl(websiteId: string): Promise<string | null> {
  const token = await createOwnerPreviewToken(websiteId);
  if (!token) return null;
  const baseUrl = process.env.PUBLIC_APP_URL ?? "https://obra-tech.lovable.app";
  return `${baseUrl}/lp/${websiteId}?preview=${token}`;
}

export async function isValidOwnerPreviewToken(
  websiteId: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token?.trim()) return false;
  const expected = await createOwnerPreviewToken(websiteId);
  if (!expected) return false;
  return timingSafeEqualString(token, expected);
}
