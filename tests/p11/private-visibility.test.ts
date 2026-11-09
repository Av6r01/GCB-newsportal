/**
 * Phase 11 — private media visibility & signed URL contracts.
 *
 * Runs with STORAGE_DRIVER=local and STORAGE_MEDIA_VISIBILITY=private.
 * Verifies:
 *   - Uploaded assets default to 'private' visibility.
 *   - Read URLs for original and variants are signed, expiring URLs.
 *   - Direct access via /uploads is blocked for private assets.
 *   - The /media-signed/... route serves binary objects with security headers.
 *   - Signature verification: signature tampering and key swapping return 403.
 *   - Expiration verification: expired URLs return 410.
 *   - Replacement updates signed URLs; old signed URLs 404 once collected.
 *   - Deletion removes objects; signed URLs 404.
 */
import fs from 'fs';
import path from 'path';
import type { Checker } from './run-suite';
import { buildFixture, api, uploadFile, type BuiltFixture } from './harness';

function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

export async function check(T: Checker) {
  const pngMod = await import('../../src/server/image/pngResize.ts');
  const { STORAGE_DIR } = await import('./harness');

  function makePng(width: number, height: number): Buffer {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        rgba[o] = (x * 29) % 256;
        rgba[o + 1] = (y * 31) % 256;
        rgba[o + 2] = ((x + y) * 17) % 256;
        rgba[o + 3] = 255;
      }
    }
    return pngMod.encodePngFromRgba(rgba, width, height);
  }

  const fx: BuiltFixture = await buildFixture();
  const { baseUrl, users } = fx;
  const admin = users.admin.token;

  try {
    // ── 1. Storage description reports private visibility ─────────────────
    await (async () => {
      const res = await api(baseUrl, 'GET', '/api/admin/storage', admin);
      T.eq(res.status, 200, 'private describe: 200');
      T.eq(res.json?.visibility, 'private', 'private describe: visibility is private');
      T.eq(res.json?.driver, 'local', 'private describe: driver is local');
    })();

    // ── 2. PNG upload with private visibility ─────────────────────────────
    let privateAsset: any = null;
    let originalBuf: Buffer = makePng(1000, 500);
    await (async () => {
      const res = await uploadFile(baseUrl, '/api/media/file-upload', admin, {
        filename: 'classified-report.png',
        contentType: 'image/png',
        buffer: originalBuf,
      });
      T.eq(res.status, 200, 'private upload: 200');
      privateAsset = res.json;
      T.ok(!!privateAsset?.id, 'private upload: asset created');
      T.eq(privateAsset.visibility, 'private', 'private upload: asset marked private');
      T.ok(pathOf(privateAsset.originalUrl).startsWith('/media-signed/'), 'private upload: originalUrl is a signed URL');

      const vRecords = privateAsset.variants?.records || [];
      T.ok(vRecords.length >= 2, 'private upload: variants created');
      T.ok(
        vRecords.every((r: any) => pathOf(r.url).startsWith('/media-signed/') && r.urlKind === 'signed'),
        'private upload: variant URLs are all signed URLs',
      );
      T.ok(
        vRecords.every((r: any) => r.key !== privateAsset.storageKey),
        'private upload: variant keys distinct from original key',
      );

      const vm = JSON.parse(privateAsset.variantsJson || '{}');
      T.ok(
        Object.values(vm).every((u: any) => typeof u === 'string' && pathOf(u).startsWith('/media-signed/')),
        'private upload: legacy variantsJson entries are signed URLs',
      );
    })();

    // ── 3. Serving through /media-signed route ────────────────────────────
    await (async () => {
      const serveRes = await fetch(`${baseUrl}${pathOf(privateAsset.originalUrl)}`);
      T.eq(serveRes.status, 200, 'private serve: 200 for valid signed URL');
      T.eq(serveRes.headers.get('cache-control'), 'no-store', 'private serve: Cache-Control is no-store');
      T.eq(serveRes.headers.get('x-content-type-options'), 'nosniff', 'private serve: X-Content-Type-Options nosniff');
      T.eq(serveRes.headers.get('cross-origin-resource-policy'), 'same-site', 'private serve: CORP same-site');

      const bodyBuf = Buffer.from(await serveRes.arrayBuffer());
      T.ok(bodyBuf.equals(originalBuf), 'private serve: served bytes match original');

      // Variant signed URL serve
      const v480 = privateAsset.variants.records.find((r: any) => r.name === '480w');
      T.ok(!!v480, 'private serve: 480w variant record found');
      const vRes = await fetch(`${baseUrl}${pathOf(v480.url)}`);
      T.eq(vRes.status, 200, 'private serve: 200 for variant signed URL');
      const vBuf = Buffer.from(await vRes.arrayBuffer());
      T.eq(pngMod.readPngHeader(vBuf)?.width, 480, 'private serve: variant decodes at 480px');
    })();

    // ── 4. Signed URL Tampering & Expiration ───────────────────────────────
    await (async () => {
      const parsed = /\/media-signed\/(\d+)\/([0-9a-f]+)\/(.+)$/.exec(privateAsset.originalUrl);
      T.ok(!!parsed, 'private verify: signed URL parsed');
      const [, expiry, sig, key] = parsed!;

      // Tampered signature
      const badSigUrl = `/media-signed/${expiry}/0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff/${key}`;
      const badSigRes = await fetch(`${baseUrl}${badSigUrl}`);
      T.eq(badSigRes.status, 403, 'private verify: tampered signature rejected (403)');

      // Tampered key with original signature
      const badKeyUrl = `/media-signed/${expiry}/${sig}/media/other-secret.png`;
      const badKeyRes = await fetch(`${baseUrl}${badKeyUrl}`);
      T.eq(badKeyRes.status, 403, 'private verify: key swap rejected (403)');

      // Expired timestamp (in the past)
      const pastExpiry = Math.floor(Date.now() / 1000) - 3600;
      const expiredUrl = `/media-signed/${pastExpiry}/${sig}/${key}`;
      const expiredRes = await fetch(`${baseUrl}${expiredUrl}`);
      T.eq(expiredRes.status, 410, 'private verify: expired timestamp rejected (410)');
    })();

    // ── 5. Direct access via /uploads/ is blocked ──────────────────────────
    await (async () => {
      const directRes = await fetch(`${baseUrl}/uploads/${privateAsset.storageKey}`);
      T.eq(directRes.status, 403, 'private verify: direct /uploads/ access blocked (403)');
    })();

    // ── 6. Replacement generates fresh signed URLs ────────────────────────
    let replacementAsset: any = null;
    await (async () => {
      const newBuf = makePng(800, 400);
      const res = await uploadFile(
        baseUrl,
        `/api/media/${privateAsset.id}/replace-file`,
        admin,
        { filename: 'classified-v2.png', contentType: 'image/png', buffer: newBuf },
      );
      T.eq(res.status, 200, 'private replace: 200');
      replacementAsset = res.json;
      T.ok(pathOf(replacementAsset.originalUrl).startsWith('/media-signed/'), 'private replace: new signed URL issued');
      T.ok(replacementAsset.storageKey !== privateAsset.storageKey, 'private replace: new storage key');

      // Old signed URL now 404s because the old object was unreferenced and cleaned up
      const oldServe = await fetch(`${baseUrl}${pathOf(privateAsset.originalUrl)}`);
      T.eq(oldServe.status, 404, 'private replace: old signed URL returns 404');

      // New signed URL serves the new image
      const newServe = await fetch(`${baseUrl}${pathOf(replacementAsset.originalUrl)}`);
      T.eq(newServe.status, 200, 'private replace: new signed URL returns 200');
      const servedBuf = Buffer.from(await newServe.arrayBuffer());
      T.eq(pngMod.readPngHeader(servedBuf)?.width, 800, 'private replace: served new 800px image');
    })();

    // ── 7. Deletion removes object and signed URL returns 404 ─────────────
    await (async () => {
      const del = await api(baseUrl, 'DELETE', `/api/media/${replacementAsset.id}`, admin);
      T.eq(del.status, 200, 'private delete: 200');

      const afterServe = await fetch(`${baseUrl}${pathOf(replacementAsset.originalUrl)}`);
      T.eq(afterServe.status, 404, 'private delete: deleted signed URL returns 404');
    })();
  } finally {
    await fx.close();
  }
}
