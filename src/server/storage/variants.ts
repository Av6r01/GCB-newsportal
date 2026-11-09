/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 — real responsive image variants.
 *
 * Policy (documented in docs/STORAGE.md §variants):
 *   - PNG sources: REAL resized variants (thumbnail 480w, card 800w, lead 1200w)
 *     via the pure-JS PNG codec — each variant is a distinct object with its
 *     own key, byte content, width/height and content type recorded in the
 *     MediaAsset.variants column. Variant URLs never point at the original.
 *   - JPEG / WebP / AVIF / GIF / SVG / unsupported PNG shapes: variants are
 *     NOT generated (no codec in this dependency-free stack) and NOTHING is
 *     recorded that implies a resized asset — no fabricated URLs pointing back
 *     at the original. The omission is persisted as `variantsStatus` so the
 *     magnitude of the limitation is explicit in both data and docs.
 */
import {
  PngVariantError,
  decodePngToRgba,
  encodePngFromRgba,
  readPngHeader,
  resizeRgbaNearest,
} from '../image/pngResize.ts';

export type VariantPurpose = 'thumbnail' | 'card' | 'lead';

export interface GeneratedVariant {
  /** Stable variant name, e.g. '480w'. */
  name: string;
  purpose: VariantPurpose;
  /** Provider-relative object key holding the variant bytes. */
  key: string;
  buffer: Buffer;
  contentType: 'image/png';
  width: number;
  height: number;
  bytes: number;
}

export interface VariantPlanResult {
  variants: GeneratedVariant[];
  /** 'generated' | 'passthrough-unhandled' | 'source-too-small' | 'decode-failed' */
  status: 'generated' | 'passthrough-unhandled' | 'source-too-small' | 'decode-failed';
  /** Human-readable, response-safe reason when status !== 'generated'. */
  note: string | null;
}

export const VARIANT_TARGETS: ReadonlyArray<{ name: string; purpose: VariantPurpose; width: number }> = [
  { name: '480w', purpose: 'thumbnail', width: 480 },
  { name: '800w', purpose: 'card', width: 800 },
  { name: '1200w', purpose: 'lead', width: 1200 },
];

/** Derive a variant object key: media/2026/11/asset-hash.png → media/2026/11/asset-hash-480w.png */
export function deriveVariantKey(originalKey: string, variantName: string): string {
  const dot = originalKey.lastIndexOf('.');
  const stem = dot > 0 ? originalKey.slice(0, dot) : originalKey;
  return `${stem}-${variantName}.png`;
}

export function generateImageVariants(opts: {
  key: string;
  buffer: Buffer;
  mimeType: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
}): VariantPlanResult {
  const { key, buffer, mimeType, sourceWidth, sourceHeight } = opts;

  // Byte-for-byte honesty: outside PNG we simply cannot re-encode. Pingback the
  // exact reason the caller can surface and the DB can persist.
  if (mimeType !== 'image/png') {
    return {
      variants: [],
      status: 'passthrough-unhandled',
      note:
        `No variants generated: this dependency-free stack re-encodes PNG only ` +
        `(documented in docs/STORAGE.md); ${mimeType} uploads are stored as the single original object.`,
    };
  }

  // SVG arrives tagged image/svg+xml and must never be counted as a raster.
  // PNG raster work starts with a real header read — no trusting the route input.
  const header = readPngHeader(buffer);
  if (!header) {
    return { variants: [], status: 'decode-failed', note: 'PNG header unreadable — no variants generated.' };
  }
  const srcW = header.width;
  const srcH = header.height;

  let pixels: { width: number; height: number; rgba: Uint8Array };
  try {
    pixels = decodePngToRgba(buffer);
  } catch (err) {
    if (err instanceof PngVariantError) {
      return {
        variants: [],
        status: err.reason === 'corrupt' ? 'decode-failed' : 'passthrough-unhandled',
        note: `No variants generated: ${err.reason} PNG (${err.message}).`,
      };
    }
    return { variants: [], status: 'decode-failed', note: 'PNG decode failed — no variants generated.' };
  }
  void sourceWidth; void sourceHeight; // header wins over route-supplied dims

  const variants: GeneratedVariant[] = [];
  for (const target of VARIANT_TARGETS) {
    if (target.width >= srcW) continue; // never upscale; only real downscales generate objects
    const dstW = target.width;
    const dstH = Math.max(1, Math.round((srcH * dstW) / srcW));
    const resized = resizeRgbaNearest(pixels.rgba, pixels.width, pixels.height, dstW, dstH);
    const encoded = encodePngFromRgba(resized, dstW, dstH);
    variants.push({
      name: target.name,
      purpose: target.purpose,
      key: deriveVariantKey(key, target.name),
      buffer: encoded,
      contentType: 'image/png',
      width: dstW,
      height: dstH,
      bytes: encoded.length,
    });
  }

  if (variants.length === 0) {
    return {
      variants,
      status: 'source-too-small',
      note: `Source (${srcW}px) is not wider than the smallest variant target (${VARIANT_TARGETS[0].width}px) — no downscale is meaningful.`,
    };
  }
  return { variants, status: 'generated', note: null };
}
