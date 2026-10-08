const MAX_REDIRECTS = 5;
const TRUSTED_REMOTE_MEDIA_HOSTS = [
  "yelpcdn.com",
  "hzcdn.com",
  "cloudinary.com",
  "squarespace-cdn.com",
  "buildzoom.com",
] as const;

function isTrustedRemoteMediaHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return TRUSTED_REMOTE_MEDIA_HOSTS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function forbiddenAddress(address: string): boolean {
  const normalized = address
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/^::ffff:/, "");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 0 && Number(normalized.split(".")[2]) === 2) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && Number(normalized.split(".")[2]) === 113)
    );
  }
  if (normalized.includes(":")) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    );
  }
  return true;
}

export async function assertSafeRemoteUrl(
  url: URL,
  resolveHost?: (hostname: string) => Promise<string[]>,
): Promise<string[]> {
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443")
  )
    throw new Error("Unsafe remote media URL");
  if (/^\d+$/.test(url.hostname) || /^0x/i.test(url.hostname))
    throw new Error("Unsafe numeric host");
  const literalKind = /^[0-9.]+$/.test(url.hostname) ? 4 : url.hostname.includes(":") ? 6 : 0;
  if (literalKind !== 0) {
    if (forbiddenAddress(url.hostname)) throw new Error("Unsafe remote media address");
    return [url.hostname];
  }
  if (!resolveHost && isTrustedRemoteMediaHost(url.hostname)) return [];
  // A supplied resolver is only valid for controlled test/runtime adapters that own transport.
  if (resolveHost) {
    const addresses = await resolveHost(url.hostname);
    if (addresses.length === 0 || addresses.some(forbiddenAddress))
      throw new Error("Unsafe remote media address");
    return addresses;
  }
  // Cloudflare Workers fetch public http(s) hostnames. Residual vs pinning is DNS rebinding.
  return [];
}

export function isRemoteMediaUrlSsrfSafe(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443")
  )
    return false;
  if (/^\d+$/.test(url.hostname) || /^0x/i.test(url.hostname)) return false;
  const literalKind = /^[0-9.]+$/.test(url.hostname) ? 4 : url.hostname.includes(":") ? 6 : 0;
  if (literalKind !== 0) return !forbiddenAddress(url.hostname);
  return true;
}

export async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredRaw = response.headers.get("content-length");
  const declared = declaredRaw == null ? null : Number(declaredRaw);
  if (declared != null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes))
    throw new Error("Remote media is too large");
  if (!response.body) throw new Error("Remote media has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Remote media is too large");
    }
    chunks.push(value);
  }
  if (declared != null && response.headers.get("content-encoding") == null && declared !== total)
    throw new Error("Remote media length mismatch");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function safeFetchRemoteMedia(
  url: string,
  options: {
    fetchImpl?: typeof fetch;
    headers?: Record<string, string>;
    maxBytes: number;
    resolveHost?: (hostname: string) => Promise<string[]>;
    signal?: AbortSignal;
  },
): Promise<{ bytes: Uint8Array; response: Response }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(10_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let current = new URL(url);
  const initialOrigin = current.origin;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertSafeRemoteUrl(current, options.resolveHost);
    const headers = { ...(options.headers ?? {}) };
    if (current.origin !== initialOrigin) delete headers.Referer;
    const init: RequestInit = {
      redirect: "manual",
      headers,
      signal,
    };
    const response = await fetchImpl(current, init);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("Unsafe remote redirect");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error("Remote media request failed");
    return { bytes: await readBodyLimited(response, options.maxBytes), response };
  }
  throw new Error("Too many redirects");
}
