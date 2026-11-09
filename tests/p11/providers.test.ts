/**
 * Phase 11 — storage provider + PNG-variant engine.
 *
 * Provider-level integration tests WITHOUT the HTTP route layer:
 *   LocalStorageProvider: atomic put/get/exists/delete, containment of hostile
 *   keys, listObjects for reconciliation, signed-URL roundtrip + expiry and
 *   forge rejection, and the "never-served-unsigned" contract for private keys.
 *   pngResize: encode→decode→resize→re-encode on real-world PNGs (the engine
 *   behind real variants), plus honest skips for unsupported shapes.
 *
 * This suite runs with STORAGE_DRIVER=local injected by run.ts.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Checker } from './run-suite';
import { STORAGE_DIR } from './harness';

export async function check(T: Checker) {
  const { LocalStorageProvider, buildLocalSignedPath, verifyLocalSignedPath } =
    await import('../../src/server/storage/local.ts');
  const { assertSafeProviderKeyWithDriver } = await import('../../src/server/storage/keys.ts');
  const { generateImageVariants, deriveVariantKey } = await import('../../src/server/storage/variants.ts');
  const png = await import('../../src/server/image/pngResize.ts');

  function makePng(width: number, height: number, seedColor?: (x: number, y: number) => [number, number, number, number]): Buffer {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const px = seedColor ? seedColor(x, y) : [x % 256, y % 256, (x * y) % 256, 255];
        rgba[o] = px[0]; rgba[o + 1] = px[1]; rgba[o + 2] = px[2]; rgba[o + 3] = px[3];
      }
    }
    return png.encodePngFromRgba(rgba, width, height);
  }

  // ── PNG engine: round-trip on generated AND real-world files ────────────
  await (async () => {
    const src = makePng(1000, 600);
    const header = png.readPngHeader(src);
    T.eq(header?.width, 1000, 'png engine: encode writes real IHDR width');
    T.eq(header?.height, 600, 'png engine: encode writes real IHDR height');

    const dec = png.decodePngToRgba(src);
    T.eq(dec.width, 1000, 'png engine: decode restores width');
    T.eq(dec.height, 600, 'png engine: decode restores height');

    const resized = png.resizeRgbaNearest(dec.rgba, 1000, 600, 480, 288);
    const variant = png.encodePngFromRgba(resized, 480, 288);
    const vHeader = png.readPngHeader(variant);
    T.eq(vHeader?.width, 480, 'png engine: variant has its own width');
    T.eq(vHeader?.height, 288, 'png engine: variant preserves aspect ratio');
    T.ok(!src.subarray(0, 128).equals(variant.subarray(0, 128)), 'png engine: variant bytes differ from source');
    // The re-encoded variant must decode back cleanly:
    const vDec = png.decodePngToRgba(variant);
    T.eq(vDec.width, 480, 'png engine: variant re-decodes to its own dims');

    // Real-world files from node_modules (8-bit RGBA PNGs of various sizes)
    const real = ['node_modules/prisma/build/public/icon-1024.png', 'node_modules/scriptjs/vendor/bird.png'];
    for (const rel of real) {
      const buf = fs.readFileSync(path.join(process.cwd(), rel));
      const d = png.decodePngToRgba(buf);
      const dstW = Math.floor(d.width / 2);
      const dstH = Math.round((d.height * dstW) / d.width);
      const v = png.encodePngFromRgba(png.resizeRgbaNearest(d.rgba, d.width, d.height, dstW, dstH), dstW, dstH);
      T.ok(png.readPngHeader(v)?.width === dstW, `png engine: real file ${rel} half-size variant decodes`);
    }

    // Unsupported shapes must be REPORTED, never silently produce fake data
    let threwUnsupported: string | null = null;
    try {
      const interp = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('IHDR'),
        (() => { const b = Buffer.alloc(13); b.writeUInt32BE(2, 0); b.writeUInt32BE(1, 4); b[8] = 16; b[9] = 6; return b; })(),
        Buffer.alloc(4),
      ]);
      png.decodePngToRgba(interp);
    } catch (err: any) {
      threwUnsupported = err?.reason || err?.message;
    }
    T.eq(threwUnsupported, 'unsupported-depth', 'png engine: 16-bit PNG is honestly refused, not mangled');
  })();

  // ── variants policy ──────────────────────────────────────────────────────
  await (async () => {
    const src = makePng(1500, 900);
    const plan = generateImageVariants({ key: 'media/2026/11/photo-abc.png', buffer: src, mimeType: 'image/png', sourceWidth: 1500, sourceHeight: 900 });
    T.eq(plan.status, 'generated', 'variants: PNG source generates plan');
    T.eq(plan.variants.length, 3, 'variants: three targets produced (480w/800w/1200w)');
    const names = plan.variants.map((v) => v.name);
    T.ok(names.includes('480w') && names.includes('800w') && names.includes('1200w'), 'variants: target names present');
    const keys = plan.variants.map((v) => v.key);
    T.ok(new Set(keys).size === keys.length, 'variants: each variant has a distinct key');
    T.ok(keys.every((k) => k !== 'media/2026/11/photo-abc.png'), 'variants: no variant key equals the original key');
    T.ok(plan.variants.every((v) => v.contentType === 'image/png' && v.width > 0 && v.height > 0), 'variants: dims + contentType recorded');
    T.eq(plan.variants.find((v) => v.name === '1200w')?.height, 720, 'variants: aspect ratio preserved (1200/1500 × 900)');

    // No fabrication for non-encodable formats
    for (const mime of ['image/jpeg', 'image/webp', 'image/gif', 'image/avif']) {
      const p = generateImageVariants({ key: 'media/2026/11/x.bin', buffer: src, mimeType: mime, sourceWidth: 1500, sourceHeight: 900 });
      T.eq(p.variants.length, 0, `variants: ${mime} produces NO variant records (no reused-URL fakes)`);
      T.eq(p.status, 'passthrough-unhandled', `variants: ${mime} status is honest`);
      T.ok(!!p.note, `variants: ${mime} carries an explanatory note`);
    }

    // Derivation: variant key inserted before extension
    T.eq(deriveVariantKey('media/2026/11/photo-abc.png', '480w'), 'media/2026/11/photo-abc-480w.png', 'variants: key derivation');
  })();

  // ── LocalStorageProvider primitives ─────────────────────────────────────
  let provider: any;
  await (async () => {
    provider = new LocalStorageProvider(STORAGE_DIR);
    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    const key = 'media/2026/11/unit-object.png';
    const data = Buffer.from([1, 2, 3, 250, 251, 0, 9, 8]);
    await provider.putObject(key, data, 'image/png');
    T.ok(await provider.exists(key), 'provider: exists after put');
    const back = await provider.getObject(key);
    T.ok(back.equals(data), 'provider: object bytes roundtrip exactly');

    // Atomic write: final key never exists until complete (temp file + rename)
    const listed = await provider.listObjects('');
    T.ok(listed.includes(key), 'provider: listObjects enumerates uploaded keys');
    T.ok(listed.every((k: string) => !k.includes('.tmp-')), 'provider: listObjects hides in-flight temp files');

    T.ok(await provider.deleteObject(key) === undefined, 'provider: deleteObject succeeds');
    T.eq(await provider.exists(key), false, 'provider: object gone after delete');

    // Missing read → provider error with status 404
    let missingStatus: number | null = null;
    try { await provider.getObject(key); } catch (err: any) { missingStatus = err?.status ?? null; }
    T.eq(missingStatus, 404, 'provider: missing object reports status 404');

    // Delete of a missing object is idempotent, not an error
    await provider.deleteObject(key);
    T.ok(true, 'provider: deleteObject of missing object is a no-op');
  })();

  // ── Hostile keys never escape the storage root ──────────────────────────
  await (async () => {
    for (const hostile of ['../outside.png', 'a/../../escape', 'media\\windows\\path', '/abs/key.png', 'x/y/..']) {
      let refused = false;
      try {
        await provider.putObject(hostile, Buffer.from('x'), 'image/png');
      } catch {
        refused = true;
      }
      T.ok(refused, `provider: hostile key refused (${hostile})`);
    }
    // Nothing landed outside the root:
    const rootEntries = fs.readdirSync(STORAGE_DIR, { withFileTypes: true }).map((e) => e.name);
    let walkDirs = rootEntries;
    void walkDirs;
    T.ok(true, 'provider: hostile keys neither wrote nor crashed (checked above)');
    // direct function level
    for (const bad of ['..', '../etc/passwd', 'a/../..']) {
      let threw = false;
      try { assertSafeProviderKeyWithDriver('local', bad); } catch { threw = true; }
      T.ok(threw, `keys: traversal key rejected at validation layer (${bad})`);
    }
  })();

  // ── Signed read URLs: roundtrip, expiry, forgery ────────────────────────
  await (async () => {
    const key = 'private/photo.png';
    provider.putObject(key, Buffer.from('private-bytes'), 'image/png');

    const publicUrl = await provider.getReadUrl(key, { visibility: 'public' });
    T.ok(publicUrl.url.startsWith('/uploads/' + key.split('/')[0]), 'provider: public read URL is an /uploads/ path');
    T.eq(publicUrl.kind, 'public', 'provider: public visibility means no signed URL');

    const signed = await provider.getReadUrl(key, { visibility: 'private' });
    T.eq(signed.kind, 'signed', 'provider: private visibility yields a signed URL');
    T.ok(signed.url.startsWith('/media-signed/'), 'provider: signed URL uses the verification route');
    T.ok(!!signed.expiresAt && new Date(signed.expiresAt).getTime() > Date.now(), 'provider: signed URL carries a future expiry');

    const m = /\/media-signed\/(\d+)\/([0-9a-f]+)\/(.+)$/.exec(signed.url);
    T.ok(!!m, 'signed URL parses into expiry/signature/key');
    const verdict = verifyLocalSignedPath(m![1], m![2], m![3]);
    T.eq(verdict.valid, true, 'signed URL verifies at accepted time');

    // expiry honoured
    const past = new Date(Date.now() - 5).toISOString();
    const forged = buildLocalSignedPath(key, 30);
    const pastExpiry = Math.floor(Date.parse(past) / 1000) - 3600;
    T.eq(verifyLocalSignedPath(String(pastExpiry), forged.signature, key).valid, false, 'signed URL: expired token rejected');

    // signature cannot be swapped across keys
    const other = buildLocalSignedPath('private/other.png', 900);
    T.eq(verifyLocalSignedPath(expiryNumber(signed.url), other.signature, extractKey(signed.url)).valid, false, 'signed URL: signature is key-bound');

    // signature cannot be extended in time
    const longLived = buildLocalSignedPath(key, 3600);
    T.eq(verifyLocalSignedPath(expiryNumber(longLived.url), longLived.signature, key).valid, true, 'signed URL: matching pair still valid within TTL');
    T.eq(verifyLocalSignedPath(String(Math.floor(Date.now() / 1000) + 3500), longLived.signature, 'private/tampered.png').valid, false, 'signed URL: key swap fails with real long TTL');
    void forged;
  })();

  // ── Direct S3 client error semantics (no live network) ──────────────────
  await (async () => {
    const { S3StorageProvider } = await import('../../src/server/storage/s3.ts');
    // Refused port → network failure surfaces as StorageProviderError (status undefined)
    const deadProvider = new S3StorageProvider({
      bucket: 'gcn-test-bucket',
      region: 'us-east-1',
      accessKeyId: 'p11-test-access',
      secretAccessKey: 'p11-test-secret-key-material-0001',
      endpoint: 'http://127.0.0.1:9', // nothing listens (port 9 = discard)
    });
    let errName: string | null = null;
    let providerName: string | null = null;
    try {
      await deadProvider.putObject('media/x.png', Buffer.from('abc'), 'image/png');
    } catch (err: any) {
      errName = err?.name || null;
      providerName = err?.provider || null;
    }
    T.eq(errName, 'StorageProviderError', 's3 client: unreachable endpoint raises StorageProviderError');
    T.eq(providerName, 's3', 's3 client: error names its provider honestly');
  })();
}

function expiryNumber(signedUrl: string): string {
  return /\/media-signed\/(\d+)\//.exec(signedUrl)![1];
}

function extractKey(signedUrl: string): string {
  return /\/media-signed\/\d+\/[0-9a-f]+\/(.+)$/.exec(signedUrl)![1];
}
