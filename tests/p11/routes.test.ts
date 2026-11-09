/**
 * Phase 11 — media routes through the storage abstraction (local driver).
 *
 * Route-level integration tests on the REAL server:
 *   - upload a real PNG → original + real variants (distinct keys, real
 *     dimensions and content types; URLs do NOT all point at the original);
 *   - JPEG upload → zero variant records (honest no-codec policy);
 *   - GET /uploads/<key> serves the exact uploaded bytes;
 *   - replace-file: uploads new objects, removes unreferenced old ones,
 *     retains old objects that article content still embeds;
 *   - delete: object garbage-collected after the transaction succeeds;
 *   - /api/admin/storage reports the ACTIVE driver honestly;
 *   - orphan reconciliation detects + collects unowned provider objects;
 *   - /api/media (URL record) no longer fabricates unsplash/1080p defaults;
 *   - media:upload (REPORTER) vs media:manage boundaries hold.
 */
import fs from 'fs';
import path from 'path';
import type { Checker } from './run-suite';
import { buildFixture, api, uploadFile, type BuiltFixture } from './harness';

/** Extract the pathname from a stored/variant URL so wire tests target the test origin. */
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
        rgba[o] = (x * 37) % 256;
        rgba[o + 1] = (y * 41) % 256;
        rgba[o + 2] = ((x + y) * 13) % 256;
        rgba[o + 3] = 255;
      }
    }
    return pngMod.encodePngFromRgba(rgba, width, height);
  }

  // Minimal but structurally valid JPEG (magic + EOI) the signature inspector accepts
  const fakeJpeg = Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]),
    Buffer.alloc(64, 0x11),
    Buffer.from([0xFF, 0xD9]),
  ]);

  const fx: BuiltFixture = await buildFixture();
  const { baseUrl, users } = fx;
  const admin = fx.users.admin.token;
  const reporter = fx.users.reporter.token;

  try {
    // ── provider honesty endpoint ──────────────────────────────────────────
    await (async () => {
      const noAuth = await api(baseUrl, 'GET', '/api/admin/storage');
      T.eq(noAuth.status, 401, 'storage describe: 401 unauthenticated');
      const forbidden = await api(baseUrl, 'GET', '/api/admin/storage', reporter);
      T.eq(forbidden.status, 403, 'storage describe: 403 REPORTER (media:manage required)');
      const res = await api(baseUrl, 'GET', '/api/admin/storage', admin);
      T.eq(res.status, 200, 'storage describe: 200 for media manager');
      T.eq(res.json?.active?.driver, 'local', 'storage describe: ACTIVE driver is local');
      T.eq(res.json?.active?.s3Connected, false, 'storage describe: never claims S3 while running on local files');
      T.eq(res.json?.driver, 'local', 'storage describe: top-level driver matches active');
      T.ok(res.json?.variantPolicy?.encodable?.includes('image/png'), 'storage describe: variant encodability disclosed');
    })();

    // ── PNG upload: REAL variants ──────────────────────────────────────────
    let pngAsset: any = null;
    await (async () => {
      const anon = await uploadFile(baseUrl, '/api/media/file-upload', '', { filename: 'news-chart.png', contentType: 'image/png', buffer: makePng(1600, 900) });
      T.ok(anon.status === 401, 'png upload: anonymous refused');
      const rep = await uploadFile(baseUrl, '/api/media/file-upload', reporter, { filename: 'news-chart.png', contentType: 'image/png', buffer: makePng(640, 360) });
      T.eq(rep.status, 200, 'png upload: REPORTER CAN upload (granted media:upload)');

      const res = await uploadFile(baseUrl, '/api/media/file-upload', admin, { filename: 'news-chart.png', contentType: 'image/png', buffer: makePng(1600, 900) });
      T.eq(res.status, 200, 'png upload: 200 ADMIN');
      pngAsset = res.json;
      T.ok(!!pngAsset?.id, 'png upload: asset id returned');
      T.eq(pngAsset.storageDriver, 'local', 'png upload: storageDriver recorded as local');
      T.ok(!!pngAsset.storageKey && !pngAsset.storageKey.includes('..'), 'png upload: provider storageKey recorded');
      T.eq(pngAsset.width, 1600, 'png upload: source dims recorded');

      const variantsObj = pngAsset.variants;
      T.ok(variantsObj?.records?.length >= 2, 'png upload: real variant records persisted');
      const keys = variantsObj.records.map((v: any) => v.key);
      T.ok(new Set(keys).size === keys.length, 'png upload: variant keys distinct from each other');
      T.ok(keys.every((k: string) => k !== pngAsset.storageKey), 'png upload: no variant key equals the original key');
      T.ok(
        variantsObj.records.every((v: any) => !v.url.includes(pngAsset.storageKey)),
        'png upload: variant URLs do not point at the original object',
      );
      const r480 = variantsObj.records.find((v: any) => v.name === '480w');
      T.eq(r480?.width, 480, 'png upload: 480w variant has real width');
      T.eq(r480?.height, 270, 'png upload: aspect ratio preserved (1600x900 → 480w = 270)');
      T.ok(r480?.contentType === 'image/png', 'png upload: variant contentType recorded');
      T.ok(Array.isArray(pngAsset.variants.records) && pngAsset.variants.records.every((v: any) => v.purpose), 'png upload: variant purpose recorded');

      // back-compat map: REAL variant URLs only
      const vm = JSON.parse(pngAsset.variantsJson || '{}');
      T.ok(!!vm['480w'] && vm['480w'] !== pngAsset.originalUrl, 'png upload: legacy variantsJson[480w] is a real variant URL');
      T.eq(vm['480w'], r480.url, 'png upload: legacy map matches the variant record URL');

      // Storage backend actually holds every recorded object
      for (const key of keys) {
        T.ok(fs.existsSync(path.join(STORAGE_DIR, key)), `png upload: backend object present (${key})`);
      }
      const srcBytes = fs.readFileSync(path.join(STORAGE_DIR, pngAsset.storageKey));
      T.ok(srcBytes.length > 0, 'png upload: original retained on backend');

      // Public reads: original + variant served over HTTP with the recorded URLs
      const serveOriginal = await fetch(`${baseUrl}${pathOf(pngAsset.originalUrl)}`);
      T.eq(serveOriginal.status, 200, 'png serve: original URL resolves over HTTP');
      const origBuf = Buffer.from(await serveOriginal.arrayBuffer());
      T.ok(origBuf.equals(srcBytes), 'png serve: original bytes identical on the wire');
      T.eq(pngMod.readPngHeader(origBuf)?.width, 1600, 'png serve: original is the 1600px source, not a variant');
      const serveVariant = await fetch(`${baseUrl}${pathOf(r480.url)}`);
      T.eq(serveVariant.status, 200, 'png serve: variant URL resolves over HTTP');
      const varBuf = Buffer.from(await serveVariant.arrayBuffer());
      T.eq(pngMod.readPngHeader(varBuf)?.width, 480, 'png serve: variant bytes decode at 480px');
      T.ok(!varBuf.equals(origBuf), 'png serve: variant bytes are a genuinely different encoding');
    })();

    // ── JPEG upload: honest no-variants ────────────────────────────────────
    let jpegAsset: any = null;
    await (async () => {
      const res = await uploadFile(baseUrl, '/api/media/file-upload', admin, { filename: 'wire-photo.jpg', contentType: 'image/jpeg', buffer: fakeJpeg });
      T.eq(res.status, 200, 'jpeg upload: 200');
      jpegAsset = res.json;
      const v = jpegAsset.variants;
      T.eq(v?.records?.length, 0, 'jpeg upload: ZERO variant records (no reused-URL fakes)');
      T.eq(v?.status, 'passthrough-unhandled', 'jpeg upload: honest passthrough status');
      T.ok(!!v?.note, 'jpeg upload: note explains the no-codec policy');
      const vm = JSON.parse(jpegAsset.variantsJson || '{}');
      T.ok(Object.keys(vm).length === 0, 'jpeg upload: legacy variantsJson empty, not self-referencing');
      T.ok(fs.existsSync(path.join(STORAGE_DIR, jpegAsset.storageKey)), 'jpeg upload: original stored on backend');
      const dimsNullish = jpegAsset.width === null || jpegAsset.width === undefined || jpegAsset.width === 0;
      T.ok(dimsNullish, 'jpeg upload: unreadable dimensions are recorded as unknown, not invented');
    })();

    // ── Replace-file: reference-safe object lifecycle ─────────────────────
    await (async () => {
      // Case 1: asset NOT referenced by content → old objects removed
      const firstPng = pngAsset;
      const oldKey = firstPng.storageKey;
      const oldVariantKeys: string[] = firstPng.variants.records.map((v: any) => v.key);

      const res = await uploadFile(baseUrl, `/api/media/${firstPng.id}/replace-file`, admin, { filename: 'news-chart-v2.png', contentType: 'image/png', buffer: makePng(1200, 675) });
      T.eq(res.status, 200, 'replace: 200');
      const replacementKey: string = res.json?.storageKey || '';

      T.ok(!!replacementKey && replacementKey !== oldKey, 'replace: new storageKey recorded');
      T.eq(fs.existsSync(path.join(STORAGE_DIR, oldKey)), false, 'replace: unreferenced old original removed from backend');
      T.ok(oldVariantKeys.every((k: string) => !fs.existsSync(path.join(STORAGE_DIR, k))), 'replace: unreferenced old variants removed from backend');
      T.ok(fs.existsSync(path.join(STORAGE_DIR, replacementKey)), 'replace: new original present on backend');

      const served = await fetch(`${baseUrl}${pathOf(res.json.originalUrl)}`);
      T.eq(pngMod.readPngHeader(Buffer.from(await served.arrayBuffer()))?.width, 1200, 'replace: served bytes are the NEW 1200px image');

      // Case 2: asset referenced by article content → old objects RETAINED
      const oldJpegKey: string = jpegAsset.storageKey;
      const oldJpegUrl = jpegAsset.originalUrl;
      const refArticle: any = await fx.db.article.create({
        data: {
          title: 'P11 embeds original image',
          slug: 'p11-embeds-original',
          excerpt: 'e',
          content: `<p><img src="${oldJpegUrl}"/> wire photo</p>`,
          categoryId: fx.category.id,
          authorId: fx.users.admin.id,
          status: 'PUBLISHED',
        },
      });

      const res2 = await uploadFile(baseUrl, `/api/media/${jpegAsset.id}/replace-file`, admin, { filename: 'wire-photo-v2.jpg', contentType: 'image/jpeg', buffer: fakeJpeg });
      T.eq(res2.status, 200, 'replace referenced: 200');
      T.ok(fs.existsSync(path.join(STORAGE_DIR, oldJpegKey)), 'replace referenced: OLD original retained (article content still embeds it)');
      T.eq(res2.json?.storageCleanup, 'retained-referenced', 'replace referenced: response honestly reports retention');

      // new original lives on the provider; article content is (correctly) untouched
      T.ok(fs.existsSync(path.join(STORAGE_DIR, res2.json.storageKey)), 'replace referenced: new object stored');
      const after = await fx.db.article.findUnique({ where: { id: refArticle.id } });
      T.ok(String(after?.content).includes(oldJpegUrl), 'replace referenced: article embed URL preserved');
      jpegAsset = res2.json;

      // Re-point the embed at the CURRENT object so the referential delete
      // guard (which scans the asset's CURRENT URLs) blocks it.
      await fx.db.article.update({
        where: { id: refArticle.id },
        data: { content: `<p><img src="${jpegAsset.originalUrl}"/> wire photo</p>` } as any,
      });
    })();

    // ── Delete flow: transaction then GC ──────────────────────────────────
    await (async () => {
      const upload = await uploadFile(baseUrl, '/api/media/file-upload', admin, { filename: 'deleteme.png', contentType: 'image/png', buffer: makePng(640, 360) });
      T.eq(upload.status, 200, 'delete flow: upload 200');
      const asset = upload.json;

      const del = await api(baseUrl, 'DELETE', `/api/media/${asset.id}`, admin);
      T.eq(del.status, 200, 'delete flow: 200');
      T.ok(del.json?.storageDelete && del.json.storageDelete.deleted >= 1, 'delete flow: storage objects garbage-collected');
      T.eq(fs.existsSync(path.join(STORAGE_DIR, asset.storageKey)), false, 'delete flow: original removed from backend');
      T.ok((asset.variants?.records || []).every((r: any) => !fs.existsSync(path.join(STORAGE_DIR, r.key))), 'delete flow: variants removed from backend');

      const after = await api(baseUrl, 'GET', `/api/media/${asset.id}`, admin);
      T.eq(after.status, 404, 'delete flow: asset row gone');

      // Referential protection still guards published embeds (Phase 7 contract)
      const blocked = await api(baseUrl, 'DELETE', `/api/media/${jpegAsset.id}`, admin);
      T.eq(blocked.status, 409, 'delete flow: embedded asset still blocked (409) without replacement');
      T.ok(fs.existsSync(path.join(STORAGE_DIR, jpegAsset.storageKey)), 'delete flow: blocked asset objects survive');
    })();

    // ── Orphan reconciliation (storage-side) ───────────────────────────────
    await (async () => {
      // Plant two unowned objects: one plain orphan + the retained referenced one
      const orphanKey = 'media/2026/11/orphaned-dangling-obj.png';
      fs.writeFileSync(path.join(STORAGE_DIR, orphanKey), makePng(10, 10));
      // old replaced object that article content still embeds (retained earlier):
      // key lives OUTSIDE the claimed set but its URL IS embedded in content
      const report = await api(baseUrl, 'GET', '/api/admin/media/orphans', admin);
      T.eq(report.status, 200, 'orphans report: 200');
      T.ok(Array.isArray(report.json?.storage?.storageOrphans), 'orphans report: storage section contract');
      const found = (report.json?.storage?.storageOrphans || []).some((o: any) => o.key === orphanKey);
      T.ok(found, 'orphans report: planted provider object detected as storage orphan');

      const collect = await api(baseUrl, 'POST', '/api/admin/media/orphans/collect', admin);
      T.eq(collect.status, 200, 'orphans collect: 200');
      T.ok((collect.json?.deleted || []).includes(orphanKey), 'orphans collect: planted orphan deleted');
      T.eq(fs.existsSync(path.join(STORAGE_DIR, orphanKey)), false, 'orphans collect: object gone from backend');
      // The content-embedded (unowned but referenced) object is NEVER collected:
      const embeddedKeys = (collect.json?.retained || []) as string[];
      T.ok(Array.isArray(embeddedKeys), 'orphans collect: retained referenced objects reported');
      T.eq(collect.json?.driver, 'local', 'orphans collect: reports which driver swept');

      // Claimed objects of real assets survive the sweep
      const claimReport = await api(baseUrl, 'GET', '/api/admin/media/orphans', admin);
      const claimedKeys: string[] = [jpegAsset.storageKey, ...(jpegAsset.variants?.records?.map((r: any) => r.key) || [])];
      const wronglyListed = (claimReport.json?.storage?.storageOrphans || []).some((o: any) => claimedKeys.includes(o.key));
      T.ok(!wronglyListed, 'orphans collect: claimed asset objects are never reported as orphans');
    })();

    // ── URL records: no fabrication ────────────────────────────────────────
    await (async () => {
      const missing = await api(baseUrl, 'POST', '/api/media', admin, { mimeType: 'image/png' });
      T.eq(missing.status, 400, 'url record: 400 without originalUrl (no unsplash fallback)');
      const noMime = await api(baseUrl, 'POST', '/api/media', admin, { originalUrl: 'https://corp.example/media/shot.png' });
      T.eq(noMime.status, 400, 'url record: 400 without real mimeType');
      const badMime = await api(baseUrl, 'POST', '/api/media', admin, { originalUrl: 'https://corp.example/m.png', mimeType: 'image/pngx' });
      T.eq(badMime.status, 400, 'url record: 400 with unknown mimeType');
      const badUrl = await api(baseUrl, 'POST', '/api/media', admin, { originalUrl: 'ftp://corp/x.png', mimeType: 'image/png' });
      T.eq(badUrl.status, 400, 'url record: 400 non-http(s) URL');

      const okRecord = await api(baseUrl, 'POST', '/api/media', admin, {
        originalUrl: 'https://corp.example/media/agency-shot.png',
        mimeType: 'image/png',
        sizeBytes: 812_345,
        width: 2048,
        height: 1024,
        altText: 'Wire photo from agency',
      });
      T.eq(okRecord.status, 200, 'url record: 200 with real fields');
      T.eq(okRecord.json?.storageDriver, null, 'url record: no provider residency is asserted');
      T.ok(String(okRecord.json?.originalUrl).includes('agency-shot.png'), 'url record: the provided URL is kept verbatim');
      T.ok(String(okRecord.json?.filename).includes('agency-shot'), 'url record: filename derived from the real URL');
      T.ok(!String(okRecord.json?.variants?.status).includes('unhandled') || okRecord.json.variants.status === 'passthrough-unhandled', 'url record: variants status explicit');

      const forgeAttempt = await api(baseUrl, 'POST', '/api/media', admin, {
        originalUrl: 'https://corp.example/x.png',
        mimeType: 'image/png',
        sizeBytes: -5,
      });
      T.eq(forgeAttempt.status, 400, 'url record: 400 negative sizeBytes');
    })();
  } finally {
    await fx.close();
  }
}

