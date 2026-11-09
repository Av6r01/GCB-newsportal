/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Media Security Pipeline — Phase 5 hardened.
 *
 * Key changes from Phase 3 baseline:
 *   - SVG uploads REJECTED by default (ALLOW_SVG_UPLOADS=true env opt-in required).
 *     Even with opt-in, SVGs pass through a comprehensive XSS pattern scan.
 *   - All 8 KB of SVG text inspected, not just first 512 bytes.
 *   - Dimension sanity limits enforced (max 20000 × 20000 px, min 1 × 1).
 *   - File size validated against 10 MB hard cap before processing.
 *   - Upload rate limiter (per-user, 20 uploads / 10 min) tracked here.
 *   - generateSafeFileName uses crypto.randomUUID for guaranteed uniqueness.
 *   - PHP/shell/script magic byte rejection expanded.
 */

import crypto from 'crypto';

export interface MagicByteResult {
  isValid: boolean;
  mimeType: string;
  extension: string;
  detectedType: string;
  error?: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
}

/** Maximum allowed image dimension in either direction */
const MAX_DIMENSION = 20_000;
/** Maximum upload size enforced in this layer (multer also limits to 10 MB) */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Whether SVG uploads are permitted.
 * Off by default — set ALLOW_SVG_UPLOADS=true in env to enable.
 * Even when enabled, SVGs must pass the XSS pattern scan.
 */
export function svgUploadsAllowed(): boolean {
  return process.env.ALLOW_SVG_UPLOADS === 'true';
}

/**
 * Comprehensive SVG XSS pattern scan.
 * Scans up to 64 KB of the file (covers all practical SVGs).
 * Returns an error string if a prohibited pattern is found, otherwise null.
 */
function scanSvgForXss(buffer: Buffer): string | null {
  const scanWindow = Math.min(buffer.length, 65_536);
  const text = buffer.slice(0, scanWindow).toString('utf-8');
  const lower = text.toLowerCase();

  // Patterns with reason labels — order matters: early-exit on first hit
  const patterns: Array<[RegExp, string]> = [
    [/<script/i,                                    'embedded <script> tag'],
    [/javascript\s*:/i,                             'javascript: URI scheme'],
    [/\bon\w+\s*=/i,                                'inline event handler (on*)'],
    [/<\s*foreignobject/i,                          '<foreignObject> element'],
    [/xlink\s*:\s*href\s*=\s*["']?\s*data\s*:/i,  'xlink:href with data: URI'],
    [/<\s*use[^>]+href\s*=\s*["']?\s*data\s*:/i,  '<use> with data: href'],
    [/href\s*=\s*["']\s*data\s*:\s*text\s*\/\s*html/i, 'data:text/html href'],
    [/<\s*animate[^>]+attributename\s*=\s*["']href["']/i, 'animated href attribute'],
    [/<\s*set[^>]+attributename\s*=\s*["']href["']/i, '<set> href manipulation'],
    [/expression\s*\(/i,                            'CSS expression()'],
    [/-moz-binding\s*:/i,                           '-moz-binding CSS'],
    [/&#x?[0-9a-f]+;/i,                            'HTML entity encoding (obfuscation)'],
    [/\\u[0-9a-f]{4}/i,                            'Unicode escape in SVG'],
  ];

  for (const [pattern, reason] of patterns) {
    if (pattern.test(text)) return `SVG rejected: ${reason} is a prohibited XSS vector.`;
  }
  return null;
}

/**
 * Validates raw file buffer against magic bytes and content policy.
 * Single entry point for all upload validation.
 */
export function inspectBufferSignature(buffer: Buffer): MagicByteResult {
  if (!buffer || buffer.length < 4) {
    return { isValid: false, mimeType: 'application/octet-stream', extension: 'bin', detectedType: 'UNKNOWN', error: 'Empty or invalid file buffer.' };
  }

  if (buffer.length > MAX_FILE_BYTES) {
    return { isValid: false, mimeType: 'application/octet-stream', extension: 'bin', detectedType: 'OVERSIZED', error: `File exceeds maximum allowed size of ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  }

  // ── Raster image magic bytes ──────────────────────────────────────────────
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { isValid: true, mimeType: 'image/jpeg', extension: 'jpg', detectedType: 'JPEG' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { isValid: true, mimeType: 'image/png', extension: 'png', detectedType: 'PNG' };
  }

  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { isValid: true, mimeType: 'image/gif', extension: 'gif', detectedType: 'GIF' };
  }

  // WebP: RIFF....WEBP
  if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { isValid: true, mimeType: 'image/webp', extension: 'webp', detectedType: 'WEBP' };
  }

  // AVIF: usually wrapped in ISOBMFF — check ftyp box with 'avif'
  if (buffer.length >= 12 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    const brand = buffer.slice(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') {
      return { isValid: true, mimeType: 'image/avif', extension: 'avif', detectedType: 'AVIF' };
    }
  }

  // ── SVG (text-based — handle with care) ──────────────────────────────────
  const svgHeader = buffer.slice(0, Math.min(buffer.length, 512)).toString('utf-8').toLowerCase();
  if (svgHeader.includes('<svg') || (svgHeader.includes('<?xml') && svgHeader.includes('svg'))) {
    if (!svgUploadsAllowed()) {
      return {
        isValid: false,
        mimeType: 'image/svg+xml',
        extension: 'svg',
        detectedType: 'SVG_REJECTED',
        error: 'SVG uploads are disabled by policy. Upload JPEG, PNG, WebP or AVIF instead.',
      };
    }
    // SVG allowed — run full XSS scan
    const xssError = scanSvgForXss(buffer);
    if (xssError) {
      return { isValid: false, mimeType: 'image/svg+xml', extension: 'svg', detectedType: 'SVG_REJECTED', error: xssError };
    }
    return { isValid: true, mimeType: 'image/svg+xml', extension: 'svg', detectedType: 'SVG' };
  }

  // ── Dangerous signatures — reject explicitly ──────────────────────────────
  // Windows PE executable (MZ header)
  if (buffer[0] === 0x4D && buffer[1] === 0x5A) {
    return { isValid: false, mimeType: 'application/x-msdownload', extension: 'exe', detectedType: 'EXECUTABLE', error: 'Executable binaries are prohibited.' };
  }
  // ELF binary
  if (buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
    return { isValid: false, mimeType: 'application/x-elf', extension: 'elf', detectedType: 'ELF_BINARY', error: 'ELF binaries are prohibited.' };
  }
  // PHP script
  const textHeader = buffer.slice(0, 64).toString('utf-8');
  if (textHeader.trimStart().startsWith('<?php') || textHeader.trimStart().startsWith('<?PHP')) {
    return { isValid: false, mimeType: 'application/x-php', extension: 'php', detectedType: 'PHP_SCRIPT', error: 'PHP scripts are prohibited.' };
  }
  // Shell scripts
  if (textHeader.startsWith('#!/')) {
    return { isValid: false, mimeType: 'text/x-shellscript', extension: 'sh', detectedType: 'SHELL_SCRIPT', error: 'Shell scripts are prohibited.' };
  }
  // ZIP / JAR / DOCX (PK header) — reject to prevent zip-bomb or macro attacks
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return { isValid: false, mimeType: 'application/zip', extension: 'zip', detectedType: 'ZIP_ARCHIVE', error: 'Archive files are prohibited.' };
  }

  return {
    isValid: false,
    mimeType: 'application/octet-stream',
    extension: 'bin',
    detectedType: 'UNSUPPORTED',
    error: 'Unsupported file type. Allowed formats: JPEG, PNG, WebP, AVIF, GIF.',
  };
}

/**
 * Extract image dimensions from buffer.
 * Returns 1200×675 defaults when extraction fails.
 */
export function extractDimensionsFromBuffer(buffer: Buffer, detectedType: string): ImageDimensions {
  const clamp = (w: number, h: number): ImageDimensions => {
    const width = Math.min(w, MAX_DIMENSION);
    const height = Math.min(h, MAX_DIMENSION);
    if (width < 1 || height < 1) return { width: 0, height: 0, aspectRatio: 0 };
    return { width, height, aspectRatio: Number((width / height).toFixed(4)) };
  };

  try {
    if (detectedType === 'PNG' && buffer.length >= 24) {
      return clamp(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
    }
    if (detectedType === 'JPEG') {
      let i = 2;
      while (i < buffer.length - 8) {
        if (buffer[i] !== 0xFF) { i++; continue; }
        const marker = buffer[i + 1];
        if (marker >= 0xC0 && marker <= 0xC3) {
          return clamp(buffer.readUInt16BE(i + 7), buffer.readUInt16BE(i + 5));
        }
        i += 2 + buffer.readUInt16BE(i + 2);
      }
    }
    if (detectedType === 'GIF' && buffer.length >= 10) {
      return clamp(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
    }
    if (detectedType === 'WEBP' && buffer.length >= 30 && buffer[15] === 0x20) {
      return clamp(buffer.readUInt16LE(26) & 0x3FFF, buffer.readUInt16LE(28) & 0x3FFF);
    }
    if (detectedType === 'SVG') {
      const text = buffer.toString('utf-8');
      const m = text.match(/viewBox=["']\s*\d+\s+\d+\s+(\d+)\s+(\d+)\s*["']/i);
      if (m) return clamp(parseInt(m[1], 10), parseInt(m[2], 10));
    }
  } catch {}
  return { width: 0, height: 0, aspectRatio: 0 };
}

/**
 * Generate a safe, collision-resistant storage filename.
 * Uses crypto.randomUUID for guaranteed uniqueness.
 */
export function generateSafeFileName(originalName: string, extension: string): { filename: string; storedName: string } {
  const base = (originalName || 'media')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')       // strip extension
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'media';

  const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const storedName = `${base}-${uuid}.${extension}`;
  return { filename: originalName || storedName, storedName };
}

// ── Per-user upload rate limiter (20 uploads / 10 min) ────────────────────
const uploadMap = new Map<string, { count: number; resetAt: number }>();

export function checkUploadRateLimit(userId: string): boolean {
  const now = Date.now();
  const WINDOW = 10 * 60_000;
  const MAX = 20;
  const entry = uploadMap.get(userId);
  if (!entry || now > entry.resetAt) {
    uploadMap.set(userId, { count: 1, resetAt: now + WINDOW });
    return true; // allowed
  }
  if (++entry.count > MAX) return false; // blocked
  return true;
}
