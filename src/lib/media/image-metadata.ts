export type ImageOrientation = "landscape" | "portrait" | "square";

export type ImageByteMetadata = {
  width: number;
  height: number;
  aspect: number;
  orientation: ImageOrientation;
};

function u16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 0x100;
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 0x100 + bytes[offset + 2]! * 0x10000;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function exifOrientation(bytes: Uint8Array, offset: number, length: number): number | null {
  if (length < 14 || ascii(bytes, offset, 6) !== "Exif\0\0") return null;
  const tiff = offset + 6;
  const little = ascii(bytes, tiff, 2) === "II";
  if (!little && ascii(bytes, tiff, 2) !== "MM") return null;
  const read16 = (at: number) => (little ? u16le(bytes, at) : u16be(bytes, at));
  const read32 = (at: number) =>
    little
      ? bytes[at]! + bytes[at + 1]! * 0x100 + bytes[at + 2]! * 0x10000 + bytes[at + 3]! * 0x1000000
      : u32be(bytes, at);
  if (read16(tiff + 2) !== 42) return null;
  const ifd = tiff + read32(tiff + 4);
  if (ifd < tiff || ifd + 2 > offset + length) return null;
  const count = read16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > offset + length) return null;
    if (read16(entry) === 0x0112 && read16(entry + 2) === 3 && read32(entry + 4) >= 1) {
      return read16(entry + 8);
    }
  }
  return null;
}

function jpegDimensions(
  bytes: Uint8Array,
  applyExifOrientation = true,
): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let orientation: number | null = null;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const size = u16be(bytes, offset);
    if (size < 2 || offset + size > bytes.length) return null;
    if (marker === 0xe1) orientation = exifOrientation(bytes, offset + 2, size - 2) ?? orientation;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
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

function dimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    ascii(bytes, 12, 4) === "IHDR"
  ) {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length >= 10 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) {
    return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8X") return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes[21]! + bytes[22]! * 0x100 + bytes[23]! * 0x10000 + bytes[24]! * 0x1000000;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (
      kind === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
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

const MAX_IMAGE_EDGE = 20_000;
const MAX_IMAGE_PIXELS = 16_000_000;

function saneDimensions(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_EDGE &&
    height <= MAX_IMAGE_EDGE &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

function structurallyValidPng(bytes: Uint8Array): boolean {
  if (
    bytes.length < 45 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  )
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

function structurallyValidJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) return sawFrame && sawScan && offset === bytes.length;
    if (marker === 0x00 || marker === undefined) return false;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return false;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 7 || !saneDimensions(u16be(bytes, offset + 3), u16be(bytes, offset + 5)))
        return false;
      sawFrame = true;
    }
    offset += length;
    if (marker !== 0xda) continue;
    sawScan = true;
    while (offset + 1 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const next = bytes[offset + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        offset += 2;
        continue;
      }
      break;
    }
  }
  return false;
}

function structurallyValidGif(bytes: Uint8Array): boolean {
  if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return false;
  if (!saneDimensions(u16le(bytes, 6), u16le(bytes, 8))) return false;
  let offset = 13;
  if (bytes[10]! & 0x80) offset += 3 * 2 ** ((bytes[10]! & 7) + 1);
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const n = bytes[offset++]!;
      if (n === 0) return true;
      if (offset + n > bytes.length) return false;
      offset += n;
    }
    return false;
  };
  while (offset < bytes.length) {
    const block = bytes[offset++]!;
    if (block === 0x3b) return offset === bytes.length;
    if (block === 0x21) {
      if (offset++ >= bytes.length || !skipBlocks()) return false;
      continue;
    }
    if (block !== 0x2c || offset + 9 > bytes.length) return false;
    if (!saneDimensions(u16le(bytes, offset + 4), u16le(bytes, offset + 6))) return false;
    const packed = bytes[offset + 8]!;
    offset += 9;
    if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1);
    if (offset++ >= bytes.length || !skipBlocks()) return false;
  }
  return false;
}

function structurallyValidWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP")
    return false;
  const size = bytes[4]! + bytes[5]! * 256 + bytes[6]! * 65536 + bytes[7]! * 16777216;
  if (size + 8 !== bytes.length) return false;
  let offset = 12;
  let sawImage = false;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const n =
      bytes[offset + 4]! +
      bytes[offset + 5]! * 256 +
      bytes[offset + 6]! * 65536 +
      bytes[offset + 7]! * 16777216;
    offset += 8;
    if (n > bytes.length - offset) return false;
    if (type === "VP8 " || type === "VP8L" || type === "VP8X") sawImage = true;
    offset += n + (n & 1);
  }
  return sawImage && offset === bytes.length;
}

export function isStructurallyValidImage(
  bytes: Uint8Array,
  mimeType = detectImageMimeType(bytes),
): boolean {
  if (mimeType === "image/png") return structurallyValidPng(bytes);
  if (mimeType === "image/jpeg") return structurallyValidJpeg(bytes);
  if (mimeType === "image/gif") return structurallyValidGif(bytes);
  if (mimeType === "image/webp") return structurallyValidWebp(bytes);
  return false;
}

export function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a"))
    return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "image/webp";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 32));
    if (/(heic|heix|hevc|hevx)/.test(brands)) return "image/heic";
    if (/(mif1|msf1|heif)/.test(brands)) return "image/heif";
  }
  return null;
}

export function extractImageByteMetadata(bytes: Uint8Array): ImageByteMetadata | null {
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType || !isStructurallyValidImage(bytes, mimeType)) return null;
  const found = dimensions(bytes);
  if (
    !found ||
    !Number.isSafeInteger(found.width) ||
    !Number.isSafeInteger(found.height) ||
    found.width <= 0 ||
    found.height <= 0
  )
    return null;
  const orientation: ImageOrientation =
    found.width === found.height ? "square" : found.width > found.height ? "landscape" : "portrait";
  return {
    width: found.width,
    height: found.height,
    aspect: found.width / found.height,
    orientation,
  };
}

/** Authoritative validation: container structure plus a full bounded pixel decode. */
export async function validateDecodedImageBytes(
  bytes: Uint8Array,
): Promise<ImageByteMetadata | null> {
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
        maxResolutionInMP: MAX_IMAGE_PIXELS / 1_000_000,
        maxMemoryUsageInMB: 128,
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
      // WebP remains unsupported at the attestation boundary until its decoder can be
      // bundled with a Worker-safe WASM module. Structural parsing alone is not trust.
      return null;
    } else return null;
    return metadata;
  } catch {
    return null;
  }
}
