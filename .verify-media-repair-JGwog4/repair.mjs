// src/lib/media/contractor-media-repair.server.ts
import { createHash } from "node:crypto";

// src/lib/media-validation.ts
var ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg"
];
var ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "image/gif"];
var ALLOWED_MEDIA_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_VIDEO_MIME_TYPES
];
var MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024;
var MAX_SITE_MEDIA_BYTES = 50 * 1024 * 1024;
function extensionForMime(mimeType) {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

// src/lib/media/image-metadata.ts
function u16be(bytes, offset) {
  return bytes[offset] * 256 + bytes[offset + 1];
}
function u16le(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 256;
}
function u24le(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
}
function u32be(bytes, offset) {
  return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}
function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function exifOrientation(bytes, offset, length) {
  if (length < 14 || ascii(bytes, offset, 6) !== "Exif\0\0") return null;
  const tiff = offset + 6;
  const little = ascii(bytes, tiff, 2) === "II";
  if (!little && ascii(bytes, tiff, 2) !== "MM") return null;
  const read16 = (at) => little ? u16le(bytes, at) : u16be(bytes, at);
  const read32 = (at) => little ? bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 + bytes[at + 3] * 16777216 : u32be(bytes, at);
  if (read16(tiff + 2) !== 42) return null;
  const ifd = tiff + read32(tiff + 4);
  if (ifd < tiff || ifd + 2 > offset + length) return null;
  const count = read16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > offset + length) return null;
    if (read16(entry) === 274 && read16(entry + 2) === 3 && read32(entry + 4) >= 1) {
      return read16(entry + 8);
    }
  }
  return null;
}
function jpegDimensions(bytes, applyExifOrientation = true) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return null;
  let offset = 2;
  let orientation = null;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 255) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 255) offset += 1;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (offset + 2 > bytes.length) return null;
    const size = u16be(bytes, offset);
    if (size < 2 || offset + size > bytes.length) return null;
    if (marker === 225) orientation = exifOrientation(bytes, offset + 2, size - 2) ?? orientation;
    const isSof = marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207;
    if (isSof && size >= 7) {
      let height = u16be(bytes, offset + 3);
      let width = u16be(bytes, offset + 5);
      if (applyExifOrientation && orientation != null && orientation >= 5 && orientation <= 8)
        [width, height] = [height, width];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += size;
  }
  return null;
}
function dimensions(bytes) {
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(bytes, 1, 3) === "PNG" && ascii(bytes, 12, 4) === "IHDR") {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length >= 10 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) {
    return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8X") return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    if (kind === "VP8L" && bytes[20] === 47) {
      const bits = bytes[21] + bytes[22] * 256 + bytes[23] * 65536 + bytes[24] * 16777216;
      return { width: (bits & 16383) + 1, height: (bits >>> 14 & 16383) + 1 };
    }
    if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return { width: u16le(bytes, 26) & 16383, height: u16le(bytes, 28) & 16383 };
    }
  }
  if (detectImageMimeType(bytes) === "image/heic" || detectImageMimeType(bytes) === "image/heif") {
    for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
      if (ascii(bytes, offset, 4) !== "ispe") continue;
      const width = u32be(bytes, offset + 8);
      const height = u32be(bytes, offset + 12);
      if (width > 0 && height > 0) return { width, height };
    }
  }
  return jpegDimensions(bytes);
}
var MAX_IMAGE_EDGE = 2e4;
var MAX_IMAGE_PIXELS = 16e6;
function saneDimensions(width, height) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= MAX_IMAGE_EDGE && height <= MAX_IMAGE_EDGE && width * height <= MAX_IMAGE_PIXELS;
}
function structurallyValidPng(bytes) {
  if (bytes.length < 45 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71 || bytes[4] !== 13 || bytes[5] !== 10 || bytes[6] !== 26 || bytes[7] !== 10)
    return false;
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = u32be(bytes, offset);
    if (length > bytes.length - offset - 12) return false;
    const type = ascii(bytes, offset + 4, 4);
    if (!sawHeader && (type !== "IHDR" || length !== 13)) return false;
    if (type === "IHDR") {
      if (sawHeader || !saneDimensions(u32be(bytes, offset + 8), u32be(bytes, offset + 12)))
        return false;
      sawHeader = true;
    }
    if (type === "IDAT") sawData = true;
    offset += 12 + length;
    if (type === "IEND") return length === 0 && sawHeader && sawData && offset === bytes.length;
  }
  return false;
}
function structurallyValidJpeg(bytes) {
  if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216) return false;
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset += 1;
    const marker = bytes[offset++];
    if (marker === 217) return sawFrame && sawScan && offset === bytes.length;
    if (marker === 0 || marker === void 0) return false;
    if (marker >= 208 && marker <= 215) continue;
    if (offset + 2 > bytes.length) return false;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207) {
      if (length < 7 || !saneDimensions(u16be(bytes, offset + 3), u16be(bytes, offset + 5)))
        return false;
      sawFrame = true;
    }
    offset += length;
    if (marker !== 218) continue;
    sawScan = true;
    while (offset + 1 < bytes.length) {
      if (bytes[offset] !== 255) {
        offset += 1;
        continue;
      }
      const next = bytes[offset + 1];
      if (next === 0 || next >= 208 && next <= 215) {
        offset += 2;
        continue;
      }
      break;
    }
  }
  return false;
}
function structurallyValidGif(bytes) {
  if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return false;
  if (!saneDimensions(u16le(bytes, 6), u16le(bytes, 8))) return false;
  let offset = 13;
  if (bytes[10] & 128) offset += 3 * 2 ** ((bytes[10] & 7) + 1);
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const n = bytes[offset++];
      if (n === 0) return true;
      if (offset + n > bytes.length) return false;
      offset += n;
    }
    return false;
  };
  while (offset < bytes.length) {
    const block = bytes[offset++];
    if (block === 59) return offset === bytes.length;
    if (block === 33) {
      if (offset++ >= bytes.length || !skipBlocks()) return false;
      continue;
    }
    if (block !== 44 || offset + 9 > bytes.length) return false;
    if (!saneDimensions(u16le(bytes, offset + 4), u16le(bytes, offset + 6))) return false;
    const packed = bytes[offset + 8];
    offset += 9;
    if (packed & 128) offset += 3 * 2 ** ((packed & 7) + 1);
    if (offset++ >= bytes.length || !skipBlocks()) return false;
  }
  return false;
}
function structurallyValidWebp(bytes) {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP")
    return false;
  const size = bytes[4] + bytes[5] * 256 + bytes[6] * 65536 + bytes[7] * 16777216;
  if (size + 8 !== bytes.length) return false;
  let offset = 12;
  let sawImage = false;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const n = bytes[offset + 4] + bytes[offset + 5] * 256 + bytes[offset + 6] * 65536 + bytes[offset + 7] * 16777216;
    offset += 8;
    if (n > bytes.length - offset) return false;
    if (type === "VP8 " || type === "VP8L" || type === "VP8X") sawImage = true;
    offset += n + (n & 1);
  }
  return sawImage && offset === bytes.length;
}
function isStructurallyValidImage(bytes, mimeType = detectImageMimeType(bytes)) {
  if (mimeType === "image/png") return structurallyValidPng(bytes);
  if (mimeType === "image/jpeg") return structurallyValidJpeg(bytes);
  if (mimeType === "image/gif") return structurallyValidGif(bytes);
  if (mimeType === "image/webp") return structurallyValidWebp(bytes);
  return false;
}
function detectImageMimeType(bytes) {
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a"))
    return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "image/webp";
  if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 32));
    if (/(heic|heix|hevc|hevx)/.test(brands)) return "image/heic";
    if (/(mif1|msf1|heif)/.test(brands)) return "image/heif";
  }
  return null;
}
function extractImageByteMetadata(bytes) {
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType || !isStructurallyValidImage(bytes, mimeType)) return null;
  const found = dimensions(bytes);
  if (!found || !Number.isSafeInteger(found.width) || !Number.isSafeInteger(found.height) || found.width <= 0 || found.height <= 0)
    return null;
  const orientation = found.width === found.height ? "square" : found.width > found.height ? "landscape" : "portrait";
  return {
    width: found.width,
    height: found.height,
    aspect: found.width / found.height,
    orientation
  };
}
async function validateDecodedImageBytes(bytes) {
  const metadata = extractImageByteMetadata(bytes);
  const mimeType = detectImageMimeType(bytes);
  if (!metadata || !mimeType) return null;
  try {
    if (mimeType === "image/png") {
      const { decode } = await import("fast-png");
      const decoded = decode(bytes, { checkCrc: true });
      if (decoded.width !== metadata.width || decoded.height !== metadata.height) return null;
    } else if (mimeType === "image/jpeg") {
      const jpeg = (await import("jpeg-js")).default;
      const decoded = jpeg.decode(bytes, {
        useTArray: true,
        maxResolutionInMP: MAX_IMAGE_PIXELS / 1e6,
        maxMemoryUsageInMB: 128
      });
      const encoded = jpegDimensions(bytes, false);
      if (!encoded || decoded.width !== encoded.width || decoded.height !== encoded.height)
        return null;
    } else if (mimeType === "image/gif") {
      const { GifReader } = await import("omggif");
      const reader = new GifReader(bytes);
      if (!saneDimensions(reader.width, reader.height) || reader.numFrames() < 1) return null;
      reader.decodeAndBlitFrameRGBA(0, new Uint8Array(reader.width * reader.height * 4));
    } else if (mimeType === "image/webp") {
      return null;
    } else return null;
    return metadata;
  } catch {
    return null;
  }
}

// src/lib/media/safe-remote-media.server.ts
var MAX_REDIRECTS = 5;
var TRUSTED_REMOTE_MEDIA_HOSTS = [
  "yelpcdn.com",
  "hzcdn.com",
  "cloudinary.com",
  "squarespace-cdn.com",
  "buildzoom.com"
];
function isTrustedRemoteMediaHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return TRUSTED_REMOTE_MEDIA_HOSTS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}
function forbiddenAddress(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 192 && b === 0 || a === 192 && b === 0 && Number(normalized.split(".")[2]) === 2 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0 && Number(normalized.split(".")[2]) === 113;
  }
  if (normalized.includes(":")) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
  }
  return true;
}
async function assertSafeRemoteUrl(url, resolveHost) {
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "80" && url.port !== "443")
    throw new Error("Unsafe remote media URL");
  if (/^\d+$/.test(url.hostname) || /^0x/i.test(url.hostname))
    throw new Error("Unsafe numeric host");
  const literalKind = /^[0-9.]+$/.test(url.hostname) ? 4 : url.hostname.includes(":") ? 6 : 0;
  if (literalKind !== 0) {
    if (forbiddenAddress(url.hostname)) throw new Error("Unsafe remote media address");
    return [url.hostname];
  }
  if (!resolveHost && isTrustedRemoteMediaHost(url.hostname)) return [];
  if (resolveHost) {
    const addresses = await resolveHost(url.hostname);
    if (addresses.length === 0 || addresses.some(forbiddenAddress))
      throw new Error("Unsafe remote media address");
    return addresses;
  }
  throw new Error("Remote media host is not trusted by this runtime");
}
async function readBodyLimited(response, maxBytes) {
  const declaredRaw = response.headers.get("content-length");
  const declared = declaredRaw == null ? null : Number(declaredRaw);
  if (declared != null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes))
    throw new Error("Remote media is too large");
  if (!response.body) throw new Error("Remote media has no body");
  const reader = response.body.getReader();
  const chunks = [];
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
async function safeFetchRemoteMedia(url, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = new URL(url);
  const initialOrigin = current.origin;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertSafeRemoteUrl(current, options.resolveHost);
    const headers = { ...options.headers ?? {} };
    if (current.origin !== initialOrigin) delete headers.Referer;
    const init = {
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(1e4)
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

// src/lib/media/persist-scraped-media.server.ts
function asImageRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value;
  const url = typeof rec.url === "string" ? rec.url.trim() : "";
  if (!url) return null;
  return {
    url,
    platform: typeof rec.platform === "string" ? rec.platform : void 0,
    alt: typeof rec.alt === "string" ? rec.alt : void 0,
    storagePath: typeof rec.storagePath === "string" && rec.storagePath.trim() ? rec.storagePath.trim() : void 0,
    mimeType: typeof rec.mimeType === "string" ? rec.mimeType : void 0,
    width: typeof rec.width === "number" ? rec.width : void 0,
    height: typeof rec.height === "number" ? rec.height : void 0,
    aspect: typeof rec.aspect === "number" ? rec.aspect : void 0,
    orientation: rec.orientation === "landscape" || rec.orientation === "portrait" || rec.orientation === "square" ? rec.orientation : void 0,
    contentHash: typeof rec.contentHash === "string" ? rec.contentHash : void 0,
    provenance: rec.provenance && typeof rec.provenance === "object" ? rec.provenance : void 0,
    proofEligible: typeof rec.proofEligible === "boolean" ? rec.proofEligible : void 0
  };
}
function siteMediaPathKind(websiteId, storagePath) {
  if (!storagePath || [...storagePath].some(
    (character) => character === "\\" || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  ) || /%(?:2f|5c|2e)/i.test(storagePath))
    return null;
  let decoded;
  try {
    decoded = decodeURIComponent(storagePath);
  } catch {
    return null;
  }
  if (decoded !== storagePath || decoded.split("/").some((part) => !part || part === "." || part === ".."))
    return null;
  const prefix = `${websiteId}/`;
  if (!storagePath.startsWith(prefix)) return null;
  const relative = storagePath.slice(prefix.length);
  if (/^enrichment\/[a-f0-9]{64}\.(?:png|jpe?g|webp)$/.test(relative)) return "enrichment";
  if (/^generated\/[a-f0-9]{64}\.[a-z0-9]+$/.test(relative)) return "generated";
  if (/^[0-9]+-[a-f0-9]{8}\.(?:png|jpe?g|webp|gif|mp4)$/.test(relative)) return "upload";
  return null;
}
function parseEnrichmentImages(images) {
  if (!Array.isArray(images)) return [];
  const out = [];
  for (const item of images) {
    const parsed = asImageRef(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

// src/lib/media/contractor-media-repair.server.ts
var APPROVED_HISTORICAL_MEDIA_HOSTS = [
  "yelpcdn.com",
  "hzcdn.com",
  "cloudinary.com",
  "squarespace-cdn.com",
  "buildzoom.com"
];
var MAX_REPAIR_MEDIA_BYTES = 25 * 1024 * 1024;
var HISTORICAL_STATUSES = ["live", "selected", "draft", "discarded", "archived"];
function isApprovedHistoricalMediaUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return APPROVED_HISTORICAL_MEDIA_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}
function isExpiredSignedUrl(rawUrl, nowMs) {
  if (!rawUrl.includes("/storage/v1/object/sign/")) return false;
  const token = (() => {
    try {
      return new URL(rawUrl).searchParams.get("token");
    } catch {
      return null;
    }
  })();
  const payload = token?.split(".")[1];
  if (!payload) return true;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1e3 <= nowMs : true;
  } catch {
    return true;
  }
}
async function defaultFetchRemote(url) {
  if (!isApprovedHistoricalMediaUrl(url)) return null;
  const { bytes } = await safeFetchRemoteMedia(url, {
    maxBytes: MAX_REPAIR_MEDIA_BYTES,
    headers: {
      Accept: "image/png,image/jpeg,image/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; ObraMediaRepair/1.0)"
    }
  });
  const mimeType = detectImageMimeType(bytes);
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") return null;
  return { bytes, mimeType };
}
function contentAddressedPath(websiteId, hash, mimeType) {
  return `${websiteId}/enrichment/${hash}.${extensionForMime(mimeType)}`;
}
function manifestSlots(config) {
  const manifest = config.mediaManifest;
  if (!manifest || typeof manifest !== "object") return [];
  const slots = manifest.slots;
  return Array.isArray(slots) ? slots.filter(Boolean) : [];
}
function galleryItems(config) {
  const gallery = config.mediaGallery;
  return Array.isArray(gallery) ? gallery.filter(Boolean) : [];
}
function str(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function classify(input) {
  const issues = [];
  const { storagePath, sourceUrl } = input;
  if (!storagePath) issues.push("url_only");
  else if (!siteMediaPathKind(input.websiteId, storagePath)) issues.push("unowned_storage_path");
  else if (input.storageMissing) issues.push("missing_storage_object");
  if (sourceUrl && isExpiredSignedUrl(sourceUrl, input.nowMs)) issues.push("expired_signed_url");
  if (input.duplicate) issues.push("duplicate_source_url");
  if (issues.length === 0) return { issues, action: "none" };
  const needsBytes = issues.some(
    (issue) => issue === "url_only" || issue === "unowned_storage_path" || issue === "missing_storage_object"
  );
  if (!needsBytes) return { issues, action: "relink" };
  if (sourceUrl && isApprovedHistoricalMediaUrl(sourceUrl)) return { issues, action: "rehost" };
  issues.push("unrecoverable_source");
  return { issues, action: "manual" };
}
async function inspectContractorMedia(deps, websiteId) {
  const errors = [];
  const nowMs = (deps.now?.() ?? /* @__PURE__ */ new Date()).getTime();
  const website = await deps.loadWebsite(websiteId);
  if (!website) throw new Error("Website not found");
  const enrichment = await deps.loadEnrichment(websiteId) ?? {};
  const enrichmentImages = parseEnrichmentImages(enrichment.images);
  const versionRows = (await deps.loadVersions(websiteId)).filter(
    (row) => HISTORICAL_STATUSES.includes(row.status)
  );
  const slots = await deps.loadSlots(websiteId);
  const existsCache = /* @__PURE__ */ new Map();
  const exists = async (path) => {
    const cached = existsCache.get(path);
    if (cached !== void 0) return cached;
    let value = false;
    try {
      value = await deps.storageExists(path);
    } catch (error) {
      errors.push(`storage probe failed for ${path}: ${error.message}`);
    }
    existsCache.set(path, value);
    return value;
  };
  const items = [];
  const seenUrls = /* @__PURE__ */ new Set();
  for (const [index, image] of enrichmentImages.entries()) {
    const duplicate = seenUrls.has(image.url);
    seenUrls.add(image.url);
    const storagePath = str(image.storagePath);
    const { issues, action } = classify({
      websiteId,
      sourceUrl: image.url,
      storagePath,
      storageMissing: storagePath ? !await exists(storagePath) : false,
      nowMs,
      duplicate
    });
    items.push({
      scope: "enrichment",
      locus: "gallery",
      key: `images[${index}]`,
      sourceUrl: image.url,
      ...storagePath ? { storagePath } : {},
      issues,
      action
    });
  }
  const versions = [];
  for (const version of versionRows) {
    const config = version.config_json ?? {};
    const ledger = slots.filter((slot) => slot.version_id === version.id);
    const ledgerByslot = new Map(ledger.map((slot) => [slot.slot_id, slot]));
    const manifest = manifestSlots(config);
    let repairable = 0;
    const before = items.length;
    for (const [index, entry] of galleryItems(config).entries()) {
      const sourceUrl = str(entry.url) ?? str(entry.sourceUrl);
      const storagePath = str(entry.storagePath);
      const { issues, action } = classify({
        websiteId,
        ...sourceUrl ? { sourceUrl } : {},
        ...storagePath ? { storagePath } : {},
        storageMissing: storagePath ? !await exists(storagePath) : false,
        nowMs,
        duplicate: false
      });
      if (issues.length === 0) continue;
      items.push({
        scope: "version",
        locus: "gallery",
        versionId: version.id,
        versionStatus: version.status,
        key: `mediaGallery[${index}]`,
        ...sourceUrl ? { sourceUrl } : {},
        ...storagePath ? { storagePath } : {},
        issues,
        action
      });
    }
    for (const slot of manifest) {
      const slotId = str(slot.slotId) ?? "";
      const storagePath = str(slot.storagePath);
      const sourceUrl = str(slot.url);
      const { issues, action } = classify({
        websiteId,
        ...sourceUrl ? { sourceUrl } : {},
        ...storagePath ? { storagePath } : {},
        storageMissing: storagePath ? !await exists(storagePath) : false,
        nowMs,
        duplicate: false
      });
      const attachment = ledgerByslot.get(slotId);
      if (!attachment || attachment.storage_path !== (storagePath ?? "")) {
        issues.push("manifest_attachment_mismatch");
      }
      if (issues.length === 0) continue;
      items.push({
        scope: "version",
        locus: "manifest",
        versionId: version.id,
        versionStatus: version.status,
        key: slotId || "(missing slotId)",
        ...sourceUrl ? { sourceUrl } : {},
        ...storagePath ? { storagePath } : {},
        issues,
        action: action === "none" ? "relink" : action
      });
    }
    const logoPath = str(config.logoStoragePath);
    const logoUrl = str(config.logoUrl);
    if (logoPath || logoUrl) {
      const { issues, action } = classify({
        websiteId,
        ...logoUrl ? { sourceUrl: logoUrl } : {},
        ...logoPath ? { storagePath: logoPath } : {},
        storageMissing: logoPath ? !await exists(logoPath) : false,
        nowMs,
        duplicate: false
      });
      if (issues.length > 0) {
        items.push({
          scope: "version",
          locus: "logo",
          versionId: version.id,
          versionStatus: version.status,
          key: "logo",
          ...logoUrl ? { sourceUrl: logoUrl } : {},
          ...logoPath ? { storagePath: logoPath } : {},
          issues,
          action
        });
      }
    }
    for (const slot of ledger) {
      if (manifest.some((entry) => str(entry.slotId) === slot.slot_id)) continue;
      items.push({
        scope: "version",
        locus: "ledger",
        versionId: version.id,
        versionStatus: version.status,
        key: slot.slot_id,
        storagePath: slot.storage_path,
        issues: ["manifest_attachment_mismatch"],
        action: "relink"
      });
    }
    const versionItems = items.slice(before);
    repairable = versionItems.filter(
      (item) => item.action === "rehost" || item.action === "relink"
    ).length;
    const isLive = website.activeVersionId === version.id || version.status === "live";
    versions.push({
      versionId: version.id,
      status: version.status,
      revision: version.revision,
      versionNumber: version.version_number,
      variantKey: version.variant_key,
      isLive,
      itemsInspected: versionItems.length,
      repairable,
      manifestSlotCount: manifest.length,
      ledgerSlotCount: ledger.length,
      parity: !versionItems.some((item) => item.issues.includes("manifest_attachment_mismatch")),
      action: repairable === 0 ? "none" : isLive ? "fork_and_repoint" : "update_in_place"
    });
  }
  return {
    items,
    versions,
    enrichmentImages,
    enrichment,
    versionRows,
    activeVersionId: website.activeVersionId,
    errors
  };
}
async function materializeIdentity(deps, websiteId, sourceUrl) {
  const fetched = await (deps.fetchRemote ?? defaultFetchRemote)(sourceUrl);
  if (!fetched) throw new Error("source unavailable or not an approved host");
  const metadata = await validateDecodedImageBytes(fetched.bytes);
  const mimeType = detectImageMimeType(fetched.bytes);
  if (!metadata || mimeType !== "image/png" && mimeType !== "image/jpeg")
    throw new Error("bytes failed decoder validation");
  const contentHash = createHash("sha256").update(fetched.bytes).digest("hex");
  const storagePath = contentAddressedPath(websiteId, contentHash, mimeType);
  if (!await deps.storageExists(storagePath)) {
    const uploaded = await deps.upload(storagePath, fetched.bytes, mimeType);
    if (!uploaded) throw new Error("upload failed");
  }
  return { ...metadata, mimeType, contentHash, storagePath };
}
function applyIdentityToConfig(config, identities) {
  const next = { ...config };
  const gallery = galleryItems(config);
  if (gallery.length > 0) {
    next.mediaGallery = gallery.map((entry) => {
      const url = str(entry.url) ?? str(entry.sourceUrl);
      const identity = url ? identities.get(url) : void 0;
      return identity ? {
        ...entry,
        storagePath: identity.storagePath,
        mimeType: identity.mimeType,
        width: identity.width,
        height: identity.height,
        aspect: identity.aspect,
        orientation: identity.orientation,
        contentHash: identity.contentHash
      } : entry;
    });
  }
  const slots = manifestSlots(config);
  if (slots.length > 0) {
    const repaired = slots.map((slot) => {
      const url = str(slot.url);
      const identity = url ? identities.get(url) : void 0;
      if (!identity) return slot;
      const { url: _dropped, ...rest } = slot;
      return {
        ...rest,
        storagePath: identity.storagePath,
        mimeType: identity.mimeType,
        width: identity.width,
        height: identity.height
      };
    });
    next.mediaManifest = { ...config.mediaManifest, slots: repaired };
  }
  const logoUrl = str(config.logoUrl);
  const logoIdentity = logoUrl ? identities.get(logoUrl) : void 0;
  if (logoIdentity) next.logoStoragePath = logoIdentity.storagePath;
  return next;
}
function slotSnapshot(config) {
  return manifestSlots(config);
}
async function repairContractorMedia(deps, input) {
  const websiteId = input.websiteId;
  const dryRun = input.dryRun !== false;
  const inspection = await inspectContractorMedia(deps, websiteId);
  const errors = [...inspection.errors];
  const items = inspection.items;
  const versions = inspection.versions;
  const summary = {
    versionsInspected: versions.length,
    itemsInspected: items.length + inspection.enrichmentImages.length * 0,
    repairable: items.filter((item) => item.action === "rehost" || item.action === "relink").length,
    repaired: 0,
    unrecoverable: items.filter((item) => item.action === "manual").length
  };
  if (dryRun) {
    return { websiteId, dryRun: true, summary, versions, items, errors };
  }
  const identities = /* @__PURE__ */ new Map();
  const failedUrls = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (item.action !== "rehost" || !item.sourceUrl) continue;
    if (identities.has(item.sourceUrl) || failedUrls.has(item.sourceUrl)) continue;
    try {
      identities.set(item.sourceUrl, await materializeIdentity(deps, websiteId, item.sourceUrl));
    } catch (error) {
      failedUrls.add(item.sourceUrl);
      errors.push(`rehost failed for ${item.sourceUrl}: ${error.message}`);
    }
  }
  for (const item of items) {
    const identity = item.sourceUrl ? identities.get(item.sourceUrl) : void 0;
    if (item.action === "rehost" && identity) {
      item.repaired = true;
      item.newStoragePath = identity.storagePath;
      item.contentHash = identity.contentHash;
      summary.repaired += 1;
    } else if (item.action === "rehost") {
      item.repaired = false;
      item.error = "source unrecoverable";
      summary.unrecoverable += 1;
    }
  }
  if (identities.size > 0) {
    const nextImages = inspection.enrichmentImages.map((image) => {
      const identity = identities.get(image.url);
      return identity ? {
        ...image,
        storagePath: identity.storagePath,
        mimeType: identity.mimeType,
        width: identity.width,
        height: identity.height,
        aspect: identity.aspect,
        orientation: identity.orientation,
        contentHash: identity.contentHash,
        provenance: {
          kind: "evidence",
          sourceUrl: image.provenance?.sourceUrl ?? image.url,
          ...image.platform ?? image.provenance?.platform ? { platform: image.platform ?? image.provenance?.platform } : {},
          storageBucket: "site-media"
        }
      } : image;
    });
    const saved = await deps.saveEnrichment(websiteId, {
      ...inspection.enrichment,
      images: nextImages
    });
    if (!saved) errors.push("enrichment write-back failed");
  }
  for (const report of versions) {
    if (report.action === "none") {
      report.outcome = "skipped";
      continue;
    }
    const version = inspection.versionRows.find((row) => row.id === report.versionId);
    const nextConfig = applyIdentityToConfig(version.config_json ?? {}, identities);
    const nextSlots = slotSnapshot(nextConfig);
    const stillBroken = nextSlots.some(
      (slot) => !str(slot.storagePath)
    );
    if (stillBroken) {
      report.outcome = "failed";
      errors.push(`version ${report.versionId}: incomplete media after repair, not written`);
      continue;
    }
    try {
      if (report.action === "fork_and_repoint") {
        const fork = await deps.forkVersion({
          websiteId,
          versionId: version.id,
          expectedRevision: version.revision
        });
        if (!fork) throw new Error("fork failed");
        const updated = await deps.updateVersionMedia({
          websiteId,
          versionId: fork.id,
          expectedRevision: fork.revision,
          configJson: nextConfig,
          mediaSlots: nextSlots
        });
        if (!updated) throw new Error("fork media write failed");
        const published = await deps.publishVersion({
          websiteId,
          versionId: fork.id,
          expectedRevision: fork.revision + 1,
          configJson: nextConfig,
          mediaSlots: nextSlots
        });
        if (!published) throw new Error("atomic repoint failed");
        report.repairedVersionId = fork.id;
      } else {
        const updated = await deps.updateVersionMedia({
          websiteId,
          versionId: version.id,
          expectedRevision: version.revision,
          configJson: nextConfig,
          mediaSlots: nextSlots
        });
        if (!updated) throw new Error("media write failed");
        report.repairedVersionId = version.id;
      }
      report.outcome = "repaired";
      report.parity = true;
    } catch (error) {
      report.outcome = "failed";
      errors.push(`version ${report.versionId}: ${error.message}`);
    }
  }
  await deps.recordAudit({
    website_id: websiteId,
    versions: versions.map((version) => ({
      versionId: version.versionId,
      status: version.status,
      isLive: version.isLive,
      repairedVersionId: version.repairedVersionId ?? null,
      outcome: version.outcome ?? "skipped"
    })),
    identities: [...identities.entries()].map(([sourceUrl, identity]) => ({
      sourceUrl,
      storagePath: identity.storagePath,
      contentHash: identity.contentHash,
      mimeType: identity.mimeType
    })),
    summary,
    errors,
    recorded_at: (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString()
  });
  return { websiteId, dryRun: false, summary, versions, items, errors };
}
export {
  APPROVED_HISTORICAL_MEDIA_HOSTS,
  MAX_REPAIR_MEDIA_BYTES,
  inspectContractorMedia,
  isApprovedHistoricalMediaUrl,
  isExpiredSignedUrl,
  repairContractorMedia
};
