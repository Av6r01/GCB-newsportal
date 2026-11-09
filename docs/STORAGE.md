# Storage Provider and Media Delivery Architecture — Global Chronicle News

**Milestone**: Phase 11  
**Status**: COMPLETE  
**Last Updated**: 2026-11-09  

---

## 1. Overview

Global Chronicle News uses a unified storage abstraction for all media assets (`src/server/storage/`). Route handlers never directly perform filesystem writes (`fs.writeFileSync`, `fs.unlinkSync`) or talk directly to external clouds; all operations are routed through the `StorageProvider` contract.

The system supports two production-ready storage backends:
1. **`LocalStorageProvider`** (`src/server/storage/local.ts`): Default development provider. Performs atomic writes (temporary file + rename), root path containment to guard against directory traversal, and signature-verified local signed routes for private assets.
2. **`S3StorageProvider`** (`src/server/storage/s3.ts`): S3-compatible provider supporting AWS S3, Cloudflare R2, MinIO, or Ceph. Implemented with Node-native crypto (AWS Signature Version 4) with zero external SDK dependencies. Supports path-style and virtual-hosted addressing, streaming/payload-hash signing, ListObjectsV2 pagination, and SigV4 presigned read/upload URLs.

---

## 2. Environment Configuration & Fail-Closed Guard

The active storage provider is determined strictly by validated environment variables in `src/configuration/env.ts` and `src/server/storage/index.ts`. The system fails closed during startup if configuration is missing or invalid.

### Environment Schema (`src/configuration/env.ts`)
| Variable | Type | Default | Description |
|---|---|---|---|
| `STORAGE_DRIVER` | `'local' \| 's3'` | `'local'` | Active driver. Required in production. |
| `STORAGE_LOCAL_DIR` | `string` | `public/uploads` | Absolute root directory for `LocalStorageProvider`. |
| `STORAGE_MEDIA_VISIBILITY` | `'public' \| 'private'` | `'public'` | Default visibility for uploaded media. |
| `STORAGE_PUBLIC_BASE_URL` | `string` (URL) | `APP_URL` | Base origin for public read links (e.g. CDN or bucket website). |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | `number` | `900` (15 min) | Time-to-live for signed URLs (min 30s, max 86400s). |
| `S3_BUCKET` | `string` | — | Bucket name (min 3 chars). Required when `STORAGE_DRIVER=s3`. |
| `S3_REGION` | `string` | — | AWS / S3 region. Required when `STORAGE_DRIVER=s3`. |
| `S3_ENDPOINT` | `string` (URL) | — | S3-compatible service URL (required for MinIO, R2, or local mock). |
| `S3_ACCESS_KEY_ID` | `string` | — | S3 access key. Required when `STORAGE_DRIVER=s3`. |
| `S3_SECRET_ACCESS_KEY` | `string` | — | S3 secret key (min 16 chars). Required when `STORAGE_DRIVER=s3`. |
| `S3_UPLOAD_PREFIX` | `string` | — | Optional top-level key prefix (e.g. `media`). |

### Fail-Closed Startup Rules
- If `STORAGE_DRIVER=s3` and any of `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, or `S3_SECRET_ACCESS_KEY` are missing or blank, `validateStorageConfig()` and `resolveStorageProvider()` throw a `[FATAL]` error and halt the server.
- In production (`NODE_ENV=production`), `STORAGE_DRIVER` must be explicitly declared; fallback to local dev without `STORAGE_LOCAL_DIR` configured is forbidden.
- The `/api/admin/storage` endpoint honestly reports the active provider via `describeStorage()`. The application never claims S3 is active when `LocalStorageProvider` is in use.

---

## 3. Storage Abstraction Interface

Every operation goes through the `StorageProvider` interface (`src/server/storage/types.ts`):

```typescript
export interface StorageProvider {
  readonly name: 'local' | 's3';

  putObject(key: string, buffer: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<DeleteResult>;
  listObjects(prefix: string): Promise<string[]>;
  getReadUrl(key: string, opts?: { visibility?: ObjectVisibility }): Promise<ReadUrl>;
  getUploadUrl?(key: string, opts?: { expiresIn?: number; visibility?: ObjectVisibility }): Promise<SignedUploadUrl>;
}
```

### Key Safety and Path Containment
All storage keys are relative paths without leading slashes (e.g. `media/2026/11/headline-abc123.png`). `assertSafeProviderKeyWithDriver` in `src/server/storage/keys.ts` enforces:
- Rejection of relative path traversal (`..`, `a/../../etc`).
- Rejection of absolute paths (`/etc/passwd`, `C:\Windows`).
- Rejection of backslashes or dangerous shell characters.

---

## 4. Public and Private Access Models

### Public Access
- When `STORAGE_MEDIA_VISIBILITY=public`:
  - `LocalStorageProvider`: Objects are addressed by `/uploads/<key>` and served statically via Express with security headers.
  - `S3StorageProvider`: Objects are addressed directly via the CDN/bucket URL (`STORAGE_PUBLIC_BASE_URL` or `https://<host>/<bucket>/<key>`).
  - Cache headers: `Cache-Control: public, max-age=31536000, immutable`.

### Private Access
- When `STORAGE_MEDIA_VISIBILITY=private` (or requested per object):
  - Direct static access via `/uploads/<key>` is strictly blocked (HTTP 403 Forbidden).
  - **Local Signed URLs**: Paths in the form `/media-signed/<expiry>/<signature>/<key>`. The signature is computed as `HMAC-SHA256(key + ":" + expiry, JWT_SECRET)`.
    - Handled by `GET /media-signed/:expiry/:sig/*` in `server.ts`.
    - Signature mismatch or key swap returns HTTP 403 Forbidden.
    - Expired timestamp returns HTTP 410 Gone.
    - Cache headers: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
  - **S3 Signed URLs**: Query-string SigV4 presigned URLs (`X-Amz-Signature`, `X-Amz-Algorithm`, `X-Amz-Expires`) generated directly by `S3StorageProvider.getReadUrl()`.

---

## 5. Responsive Image Variants Pipeline

### Real Variant Generation (`src/server/image/pngResize.ts` & `src/server/storage/variants.ts`)
- High-resolution images uploaded in `image/png` generate real downscaled responsive variants using Node's native `zlib` deflate/inflate and nearest-neighbor resampling.
- Variant specifications:
  - `480w`: Thumbnail / mobile feed (`width: 480px`, aspect ratio preserved).
  - `800w`: Card / article grid (`width: 800px`, aspect ratio preserved).
  - `1200w`: Lead / hero image (`width: 1200px`, aspect ratio preserved).
- Every variant is stored as an **independent object** with its own unique key (e.g. `media/2026/11/chart-123-480w.png`) and distinct byte payload.
- Variant URLs never point back to the original file.

### Honest Non-Encodable Format Handling
- JPEG, WebP, AVIF, and GIF files cannot be safely re-encoded without native C/Rust codecs.
- Rather than fabricating duplicate records or pointing multiple variant URLs at the source image, the system honestly records `variants.records = []` with status `'passthrough-unhandled'` and an explanatory note.

---

## 6. Object Lifecycle & Referential Integrity

### Upload Flow
1. Memory buffer validated for size (≤10 MB), magic bytes, and SVG XSS filtering.
2. Dimensions extracted from binary headers (`extractDimensionsFromBuffer`).
3. Primary object written to storage provider.
4. Variants generated and written to storage provider.
5. If variant write fails, uploaded objects are immediately rolled back via `deleteObjects()`.
6. Media asset row created in database. If DB insert fails, uploaded objects are immediately garbage-collected.

### Replace Flow (`PUT /api/media/:id/replace-file`)
1. Validates new file and uploads new primary object + variants.
2. Updates database record with new storage keys, dimensions, and URLs.
3. If DB update fails, newly uploaded objects are removed; original objects remain intact.
4. **Reference Preservation**: Scans all articles (`prisma.article.findMany()`) to check if any article content embeds the old URL.
   - If referenced: Old objects are **retained** to prevent breaking published articles (`storageCleanup: 'retained-referenced'`).
   - If unreferenced: Old objects are safely deleted from the storage provider (`storageCleanup: 'deleted-or-absent'`).

### Delete Flow (`DELETE /api/media/:id`)
1. Verifies asset is not currently referenced by published articles (returns HTTP 409 Conflict if locked).
2. Deletes database record.
3. Garbage-collects primary object and all variant objects from storage provider.

---

## 7. Cleanup and Reconciliation of Orphaned Objects

- `GET /api/admin/media/orphans` (requires `media:manage` permission):
  - Enumerates objects from the active storage provider (`listObjects('media')`).
  - Compares against claimed keys in `mediaAsset` rows and embedded URLs in `article.content`.
  - Distinguishes between unowned dangling objects and retained referenced objects.
- `POST /api/admin/media/orphans/collect` (requires `media:manage` permission):
  - Deletes orphaned objects from the storage provider.
  - Never deletes retained objects whose URLs are embedded in published articles.

---

## 8. CORS, CDN & Cache Headers

### CORS Configuration
- Static uploads and signed media routes enforce `Cross-Origin-Resource-Policy: same-site`.
- When integrating with external CDNs (Cloudflare, AWS CloudFront, Fastly):
  - Public bucket CORS rule:
    ```json
    [
      {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedOrigins": ["https://globalchronicle.news"],
        "MaxAgeSeconds": 86400
      }
    ]
    ```

### Cache Headers
- **Public Assets (`/uploads/...`)**:
  - `Cache-Control: public, max-age=31536000, immutable`
  - `X-Content-Type-Options: nosniff`
- **Private / Signed Assets (`/media-signed/...`)**:
  - `Cache-Control: no-store`
  - `X-Content-Type-Options: nosniff`
  - `Content-Disposition: inline`

---

## 9. File Limits & Operational Quotas

- **File Size Maximum**: 10 MB per file (`MAX_FILE_BYTES = 10 * 1024 * 1024`).
- **Upload Rate Limit**: 20 uploads per 10 minutes per authenticated user (`checkUploadRateLimit`).
- **Allowed Types**:
  - `image/jpeg` (`.jpg`, `.jpeg`)
  - `image/png` (`.png`)
  - `image/webp` (`.webp`)
  - `image/avif` (`.avif`)
  - `image/gif` (`.gif`)
  - `image/svg+xml` (Strictly scanned for script injection, onload/onerror events, and foreignObjects).

---

## 10. Backup & Disaster Recovery

1. **Local Storage**: Daily rsync / snapshot of `STORAGE_LOCAL_DIR` to offsite volume.
2. **S3 Storage**:
   - Bucket Versioning enabled to protect against accidental overwrite or ransomware.
   - Cross-Region Replication (CRR) configured for disaster recovery.
   - Lifecycle rules: Transition non-current versions to S3 Glacier Flexible Retrieval after 30 days, purge after 90 days.
