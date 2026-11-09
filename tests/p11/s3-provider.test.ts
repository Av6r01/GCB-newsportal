/**
 * Phase 11 — S3-compatible storage provider tests.
 *
 * Runs with STORAGE_DRIVER=s3 and the test S3 credentials from run.ts.
 * Starts an in-process S3-compatible HTTP server to test real SigV4
 * requests, pagination, presigned URLs, and route integration without
 * touching any external media service.
 */
import http from 'http';
import net from 'net';
import type { Checker } from './run-suite';
import { buildFixture, api, uploadFile, type BuiltFixture } from './harness';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function check(T: Checker) {
  const pngMod = await import('../../src/server/image/pngResize.ts');
  const { S3StorageProvider } = await import('../../src/server/storage/s3.ts');
  const { resolveStorageProvider, resetStorageProviderForTests } = await import('../../src/server/storage/index.ts');
  const { env, validateStorageConfig } = await import('../../src/configuration/env.ts');

  function makePng(width: number, height: number): Buffer {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        rgba[o] = (x * 19) % 256;
        rgba[o + 1] = (y * 23) % 256;
        rgba[o + 2] = ((x + y) * 29) % 256;
        rgba[o + 3] = 255;
      }
    }
    return pngMod.encodePngFromRgba(rgba, width, height);
  }

  // ── 1. In-process S3 Mock HTTP Server ──────────────────────────────────
  const mockBucket = 'gcn-test-bucket';
  const storedObjects = new Map<string, { buffer: Buffer; contentType: string }>();
  let simulateS3Failure = false;

  const mockS3Server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const prefix = `/${mockBucket}/`;

    if (!pathname.startsWith(`/${mockBucket}`) && pathname !== `/${mockBucket}`) {
      res.writeHead(400, { 'Content-Type': 'application/xml' });
      return res.end('<Error><Code>InvalidBucketName</Code></Error>');
    }

    if (simulateS3Failure) {
      res.writeHead(500, { 'Content-Type': 'application/xml' });
      return res.end('<Error><Code>InternalError</Code><Message>Simulated S3 failure</Message></Error>');
    }

    // ListObjectsV2
    if (url.searchParams.get('list-type') === '2') {
      const listPrefix = url.searchParams.get('prefix') || '';
      const matchingKeys = [...storedObjects.keys()]
        .filter((k) => !listPrefix || k.startsWith(listPrefix))
        .sort();

      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
        `  <Name>${mockBucket}</Name>`,
        `  <Prefix>${xmlEscape(listPrefix)}</Prefix>`,
        `  <KeyCount>${matchingKeys.length}</KeyCount>`,
        `  <MaxKeys>1000</MaxKeys>`,
        `  <IsTruncated>false</IsTruncated>`,
        ...matchingKeys.map((k) => `  <Contents><Key>${xmlEscape(k)}</Key><Size>${storedObjects.get(k)!.buffer.length}</Size></Contents>`),
        '</ListBucketResult>',
      ].join('\n');

      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(xml);
    }

    const objectKey = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';

    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      storedObjects.set(objectKey, { buffer: body, contentType: req.headers['content-type'] || 'application/octet-stream' });
      res.writeHead(200, { ETag: '"mock-etag"' });
      return res.end();
    }

    if (req.method === 'GET') {
      const obj = storedObjects.get(objectKey);
      if (!obj) {
        res.writeHead(404, { 'Content-Type': 'application/xml' });
        return res.end('<Error><Code>NoSuchKey</Code></Error>');
      }
      res.writeHead(200, { 'Content-Type': obj.contentType, 'Content-Length': String(obj.buffer.length) });
      return res.end(obj.buffer);
    }

    if (req.method === 'HEAD') {
      const obj = storedObjects.get(objectKey);
      if (!obj) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': obj.contentType, 'Content-Length': String(obj.buffer.length) });
      return res.end();
    }

    if (req.method === 'DELETE') {
      storedObjects.delete(objectKey);
      res.writeHead(204);
      return res.end();
    }

    res.writeHead(405);
    res.end();
  });

  await new Promise<void>((resolve) => mockS3Server.listen(0, '127.0.0.1', resolve));
  const s3Port = (mockS3Server.address() as net.AddressInfo).port;
  const mockS3Endpoint = `http://127.0.0.1:${s3Port}`;
  process.env.S3_ENDPOINT = mockS3Endpoint;
  (env as any).S3_ENDPOINT = mockS3Endpoint;

  try {
    // ── 2. Direct S3StorageProvider Unit Operations ────────────────────────
    const s3Provider = new S3StorageProvider({
      bucket: mockBucket,
      region: 'us-east-1',
      accessKeyId: 'p11-test-access',
      secretAccessKey: 'p11-test-secret-key-material-0001',
      endpoint: mockS3Endpoint,
    });

    T.eq(s3Provider.name, 's3', 's3 provider: reports name s3');

    // putObject & exists
    const testData = Buffer.from('hello-s3-binary-payload');
    await s3Provider.putObject('media/test-obj.txt', testData, 'text/plain');
    T.eq(storedObjects.has('media/test-obj.txt'), true, 's3 provider: putObject landed in mock bucket');
    T.eq(await s3Provider.exists('media/test-obj.txt'), true, 's3 provider: exists returns true for placed key');
    T.eq(await s3Provider.exists('media/nonexistent.txt'), false, 's3 provider: exists returns false for missing key');

    // getObject
    const fetched = await s3Provider.getObject('media/test-obj.txt');
    T.ok(fetched.equals(testData), 's3 provider: getObject matches written bytes');

    // listObjects
    await s3Provider.putObject('media/sub/doc.txt', Buffer.from('sub'), 'text/plain');
    const listed = await s3Provider.listObjects('media');
    T.ok(listed.includes('media/test-obj.txt'), 's3 provider: listObjects finds root item');
    T.ok(listed.includes('media/sub/doc.txt'), 's3 provider: listObjects finds sub item');

    // deleteObject
    await s3Provider.deleteObject('media/test-obj.txt');
    T.eq(await s3Provider.exists('media/test-obj.txt'), false, 's3 provider: deleted object is gone');

    // deleteObjects batch
    await s3Provider.putObject('media/a.txt', Buffer.from('a'), 'text/plain');
    await s3Provider.putObject('media/b.txt', Buffer.from('b'), 'text/plain');
    const batchDel = await s3Provider.deleteObjects(['media/a.txt', 'media/b.txt']);
    T.eq(batchDel.deleted.length, 2, 's3 provider: batch delete deleted 2 objects');
    T.eq(batchDel.failed.length, 0, 's3 provider: batch delete zero failures');

    // getReadUrl
    const publicRead = await s3Provider.getReadUrl('media/photo.png', { visibility: 'public' });
    T.eq(publicRead.kind, 'public', 's3 provider: public read kind');
    T.ok(publicRead.url.includes('/gcn-test-bucket/media/photo.png'), 's3 provider: public read URL path-style');
    T.ok(!publicRead.url.includes('X-Amz-Signature'), 's3 provider: public read URL has no signature');

    const privateRead = await s3Provider.getReadUrl('media/photo.png', { visibility: 'private' });
    T.eq(privateRead.kind, 'signed', 's3 provider: private read kind is signed');
    T.ok(privateRead.url.includes('X-Amz-Signature='), 's3 provider: private read URL has SigV4 signature');
    T.ok(!!privateRead.expiresAt, 's3 provider: private read URL has expiresAt');

    // getUploadUrl
    const uploadUrl = await s3Provider.getUploadUrl('media/upload.png');
    T.eq(uploadUrl.method, 'PUT', 's3 provider: upload url method is PUT');
    T.ok(uploadUrl.url.includes('X-Amz-Signature='), 's3 provider: presigned upload URL has signature');

    // Error handling: missing object throws 404
    let notFoundStatus: number | null = null;
    try {
      await s3Provider.getObject('media/never-existed.png');
    } catch (err: any) {
      notFoundStatus = err?.status ?? null;
    }
    T.eq(notFoundStatus, 404, 's3 provider: getObject of missing key throws 404');

    // Error handling: 500 from S3 raises StorageProviderError
    simulateS3Failure = true;
    let thrownErrorStatus: number | null = null;
    try {
      await s3Provider.putObject('media/fail.png', Buffer.from('x'), 'image/png');
    } catch (err: any) {
      thrownErrorStatus = err?.status ?? null;
    }
    simulateS3Failure = false;
    T.eq(thrownErrorStatus, 500, 's3 provider: simulated 500 raises StorageProviderError with status 500');

    // ── 3. Fail-Closed Configuration Guards ───────────────────────────────
    let failedClosed = false;
    try {
      validateStorageConfig(
        {
          STORAGE_DRIVER: 's3',
          S3_BUCKET: 'valid-bucket',
          // missing S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
        } as any,
        true,
      );
    } catch {
      failedClosed = true;
    }
    T.ok(failedClosed, 's3 config: validateStorageConfig fails closed on incomplete S3 env');

    // ── 4. Express App Integration with S3 Provider ───────────────────────
    resetStorageProviderForTests();
    const fx: BuiltFixture = await buildFixture();
    const { baseUrl, users } = fx;
    const admin = users.admin.token;

    try {
      // Describe storage endpoint
      const descRes = await api(baseUrl, 'GET', '/api/admin/storage', admin);
      T.eq(descRes.status, 200, 's3 app: /api/admin/storage 200');
      T.eq(descRes.json?.driver, 's3', 's3 app: reports top-level driver s3');
      T.eq(descRes.json?.active?.driver, 's3', 's3 app: active driver is s3');
      T.eq(descRes.json?.active?.s3Connected, true, 's3 app: s3Connected is true');
      T.eq(descRes.json?.active?.bucket, mockBucket, 's3 app: bucket matches configured bucket');

      // PNG Upload through S3
      const pngBuf = makePng(1200, 600);
      const uploadRes = await uploadFile(baseUrl, '/api/media/file-upload', admin, {
        filename: 's3-headline-photo.png',
        contentType: 'image/png',
        buffer: pngBuf,
      });
      T.eq(uploadRes.status, 200, 's3 upload: 200');
      const asset = uploadRes.json;
      T.eq(asset?.storageDriver, 's3', 's3 upload: storageDriver recorded as s3');
      T.ok(storedObjects.has(asset.storageKey), 's3 upload: original object exists in mock S3');

      const vRecords = asset.variants?.records || [];
      T.ok(vRecords.length >= 2, 's3 upload: real variant records persisted');
      T.ok(
        vRecords.every((v: any) => storedObjects.has(v.key)),
        's3 upload: all variant objects written to mock S3',
      );

      // Replace file through S3
      const newPng = makePng(800, 400);
      const oldKey = asset.storageKey;
      const replaceRes = await uploadFile(baseUrl, `/api/media/${asset.id}/replace-file`, admin, {
        filename: 's3-headline-v2.png',
        contentType: 'image/png',
        buffer: newPng,
      });
      T.eq(replaceRes.status, 200, 's3 replace: 200');
      const replacedAsset = replaceRes.json;
      T.ok(storedObjects.has(replacedAsset.storageKey), 's3 replace: new object present on S3');
      T.eq(storedObjects.has(oldKey), false, 's3 replace: unreferenced old object removed from S3');

      // Delete media through S3
      const delRes = await api(baseUrl, 'DELETE', `/api/media/${replacedAsset.id}`, admin);
      T.eq(delRes.status, 200, 's3 delete: 200');
      T.eq(storedObjects.has(replacedAsset.storageKey), false, 's3 delete: object removed from S3');

      // Rollback on S3 partial failure
      simulateS3Failure = true;
      const failUpload = await uploadFile(baseUrl, '/api/media/file-upload', admin, {
        filename: 'should-fail.png',
        contentType: 'image/png',
        buffer: pngBuf,
      });
      simulateS3Failure = false;
      T.ok(failUpload.status >= 500, 's3 failure: upload refused with 5xx');

      // Verify no leaked media asset row in DB
      const allAssets = await fx.db.mediaAsset.findMany();
      T.ok(
        !allAssets.some((a: any) => a.filename === 'should-fail.png'),
        's3 failure: no orphaned DB row left behind after failed upload',
      );
    } finally {
      await fx.close();
    }
  } finally {
    await new Promise<void>((resolve) => mockS3Server.close(() => resolve()));
    resetStorageProviderForTests();
  }
}
