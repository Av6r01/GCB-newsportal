/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 — real PNG decode → resize → encode, implemented with Node's own
 * zlib (no native/3rd-party codecs). This is what makes the media pipeline's
 * responsive variants REAL:
 *
 *   - decode a valid 8-bit PNG (color types 0/2/3/4/6, non-interlaced) to RGBA,
 *   - nearest-neighbour downscale, and
 *   - re-encode a fresh PNG (its own dimensions + bytes) that the storage
 *     provider uploads as a separate object.
 *
 * Scope is intentionally honest: JPEG/WebP/AVIF/GIF CANNOT be re-encoded
 * without a codec, and callers (storage/variants.ts) treat those formats as
 * "no generated variants" instead of faking URLs that all point at the
 * original — that contract is documented in docs/STORAGE.md and asserted in
 * tests/p11. Unsupported PNG shapes (16-bit, Adam7 interlaced) throw a
 * structured error and are likewise skipped, never degraded to fake data.
 */
import zlib from 'zlib';

export class PngVariantError extends Error {
  readonly reason: string;
  constructor(reason: string, message?: string) {
    super(message || `PNG variant decode skipped: ${reason}`);
    this.name = 'PngVariantError';
    this.reason = reason;
  }
}

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaced: boolean;
}

export interface PngPixels {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel: length === width * height * 4 (alpha 255 when none). */
  rgba: Uint8Array;
}

function u32be(b: Buffer | Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

/**
 * Minimal CRC32 needed to emit valid PNG chunks on encode.
 */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Read IHDR without trusting anything (also hostile-buffer safe — size-checked). */
export function readPngHeader(png: Buffer): PngHeader | null {
  if (png.length < 29) return null;
  const sig = 0x89;
  if (png[0] !== sig) return null;
  if (png.subarray(1, 8).toString('ascii') !== 'PNG\r\n\x1a\n') return null;
  let width: number;
  let height: number;
  let bitDepth: number;
  let colorType: number;
  let interlace: number;
  if (png.length >= 33 && png.subarray(12, 16).toString('ascii') === 'IHDR') {
    width = u32be(png, 16);
    height = u32be(png, 20);
    bitDepth = png[24];
    colorType = png[25];
    interlace = png[28];
  } else if (png.subarray(8, 12).toString('ascii') === 'IHDR') {
    width = u32be(png, 12);
    height = u32be(png, 16);
    bitDepth = png[20];
    colorType = png[21];
    interlace = png[24];
  } else {
    return null;
  }
  if (width === 0 || height === 0 || width > 100_000 || height > 100_000) return null;
  return { width, height, bitDepth, colorType, interlaced: interlace !== 0 };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function channelsForColorType(colorType: number): number {
  // 0 gray, 2 RGB, 3 palette(expanded to RGBA), 4 gray+alpha, 6 RGBA
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 3; // PLTE-expanded → RGB indices resolved below
    case 4: return 2;
    case 6: return 4;
    default: return 0;
  }
}

/** Concatenate all IDAT payloads and inflate. */
function inflateIdat(png: Buffer): Uint8Array {
  const parts: Buffer[] = [];
  let pos = 8;
  let seenEnd = false;
  while (pos + 8 <= png.length) {
    const len = u32be(png, pos);
    const type = png.subarray(pos + 4, pos + 8).toString('ascii');
    if (len > png.length - (pos + 12)) throw new PngVariantError('corrupt', 'PNG chunk length exceeds buffer');
    if (type === 'IDAT') parts.push(png.subarray(pos + 8, pos + 8 + len));
    if (type === 'IEND') { seenEnd = true; break; }
    pos += 12 + len;
  }
  if (parts.length === 0) throw new PngVariantError('corrupt', 'PNG has no IDAT data');
  if (!seenEnd) throw new PngVariantError('corrupt', 'PNG is truncated (no IEND)');
  const raw = Buffer.concat(parts);
  try {
    return zlib.inflateSync(raw);
  } catch {
    throw new PngVariantError('corrupt', 'PNG IDAT payload failed to inflate');
  }
}

function palette(png: Buffer): { plte: Buffer; trns: Buffer | null } {
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  let pos = 8;
  while (pos + 8 <= png.length) {
    const len = u32be(png, pos);
    const type = png.subarray(pos + 4, pos + 8).toString('ascii');
    if (type === 'PLTE') plte = Buffer.from(png.subarray(pos + 8, pos + 8 + len));
    if (type === 'tRNS') trns = Buffer.from(png.subarray(pos + 8, pos + 8 + len));
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!plte) throw new PngVariantError('corrupt', 'palette PNG without PLTE chunk');
  return { plte, trns };
}

/** Decode an 8-bit, non-interlaced PNG into RGBA pixels. Throws PngVariantError otherwise. */
export function decodePngToRgba(png: Buffer): PngPixels {
  const header = readPngHeader(png);
  if (!header) throw new PngVariantError('corrupt', 'not a parseable PNG');
  const { width, height, bitDepth, colorType, interlaced } = header;
  if (interlaced) throw new PngVariantError('interlaced', 'Adam7-interlaced PNGs cannot be resized');
  if (bitDepth !== 8) throw new PngVariantError('unsupported-depth', `bit depth ${bitDepth} not supported`);
  const nch = channelsForColorType(colorType);
  if (nch === 0) throw new PngVariantError('unsupported-colortype', `color type ${colorType} not supported`);

  const raw = inflateIdat(png);
  const bytesPerRow = width * nch;
  const expected = height * (bytesPerRow + 1);
  if (raw.length < expected) throw new PngVariantError('corrupt', `deflated stream shorter than image data`);

  const out = new Uint8Array(width * height * 4);
  let paletteData: Buffer | null = null;
  let trnsData: Buffer | null = null;
  if (header.colorType === 3) {
    const p = palette(png);
    paletteData = p.plte;
    trnsData = p.trns;
    if (paletteData.length % 3 !== 0) throw new PngVariantError('corrupt', 'PLTE chunk size not divisible by 3');
  }

  const prev = new Uint8Array(bytesPerRow);
  let offset = 0; // raw scanline cursor
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    for (let x = 0; x < bytesPerRow; x++) {
      const idx = offset + x;
      let value = raw[idx];
      switch (filter) {
        case 0: break;
        case 1: value = (value + (x >= nch ? raw[idx - nch] : 0)) & 0xff; break;
        case 2: value = (value + prev[x]) & 0xff; break;
        case 3: value = (value + (((x >= nch ? raw[idx - nch] : 0) + prev[x]) >> 1)) & 0xff; break;
        case 4: {
          const a = x >= nch ? raw[idx - nch] : 0;
          const b = prev[x];
          const c = x >= nch ? prev[x - nch] : 0;
          value = (value + paeth(a, b, c)) & 0xff;
          break;
        }
        default:
          throw new PngVariantError('corrupt', `unknown scanline filter ${filter}`);
      }
      prev[x] = value;
    }
    offset += bytesPerRow;

    // Unpack to RGBA
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      const r0 = y * bytesPerRow + x * nch;
      switch (header.colorType) {
        case 0: out[o] = out[o + 1] = out[o + 2] = prev[r0]; out[o + 3] = 255; break;
        case 2: out[o] = prev[r0]; out[o + 1] = prev[r0 + 1]; out[o + 2] = prev[r0 + 2]; out[o + 3] = 255; break;
        case 3: {
          const pi = prev[r0];
          out[o] = paletteData![pi * 3]; out[o + 1] = paletteData![pi * 3 + 1]; out[o + 2] = paletteData![pi * 3 + 2];
          const ti = trnsData && pi < trnsData.length ? trnsData[pi] : 255;
          out[o + 3] = ti;
          break;
        }
        case 4: out[o] = out[o + 1] = out[o + 2] = prev[r0]; out[o + 3] = prev[r0 + 1]; break;
        case 6: out[o] = prev[r0]; out[o + 1] = prev[r0 + 1]; out[o + 2] = prev[r0 + 2]; out[o + 3] = prev[r0 + 3]; break;
      }
    }
  }
  return { width, height, rgba: out };
}

/** Nearest-neighbour resize on an RGBA raster. Deterministic, no fish-eye smoothing. */
export function resizeRgbaNearest(
  src: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number,
): Uint8Array {
  if (dstW < 1 || dstH < 1 || srcW < 1 || srcH < 1) throw new PngVariantError('bad-size');
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const s = (sy * srcW + sx) * 4;
      const d = (y * dstW + x) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

/** Write one PNG chunk (length, type, body, CRC) into `out` at `at`; returns next offset. */
function chunk(out: Buffer, at: number, type: string, body: Buffer): number {
  out.writeUInt32BE(body.length, at);
  out.write(type, at + 4, 'ascii');
  body.copy(out, at + 8);
  const crcBody = out.subarray(at + 4, at + 8 + body.length);
  out.writeUInt32BE(crc32(crcBody), at + 8 + body.length);
  return at + 12 + body.length;
}

/**
 * Encode RGBA pixels as a fresh RGBA (color type 6) PNG with filter type 0
 * rows. Output is a standalone valid PNG validated by tests/p11 (signature,
 * IHDR dims, and byte-inequality with the source).
 */
export function encodePngFromRgba(rgba: Uint8Array, width: number, height: number): Buffer {
  const bytesPerRow = width * 4;
  const raw = Buffer.alloc(height * (bytesPerRow + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (bytesPerRow + 1);
    raw[rowStart] = 0; // filter None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * bytesPerRow, bytesPerRow).copy(raw, rowStart + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const out = Buffer.alloc(8 + 25 + 12 + idat.length + 12);
  // PNG signature
  out[0] = 0x89; out[1] = 0x50; out[2] = 0x4e; out[3] = 0x47;
  out[4] = 0x0d; out[5] = 0x0a; out[6] = 0x1a; out[7] = 0x0a;
  let p = 8;

  // IHDR (width, height, 8, 6, 0, 0, 0)
  const ihdrBody = Buffer.alloc(13);
  ihdrBody.writeUInt32BE(width, 0);
  ihdrBody.writeUInt32BE(height, 4);
  ihdrBody[8] = 8;  // bit depth
  ihdrBody[9] = 6;  // RGBA
  ihdrBody[10] = 0; ihdrBody[11] = 0; ihdrBody[12] = 0;
  p = chunk(out, p, 'IHDR', ihdrBody);

  p = chunk(out, p, 'IDAT', idat);
  p = chunk(out, p, 'IEND', Buffer.alloc(0));
  return out.subarray(0, p);
}
