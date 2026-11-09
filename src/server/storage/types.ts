/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 — storage abstraction contracts.
 *
 * Route handlers NEVER touch the filesystem or HTTP object stores directly:
 * they receive one StorageProvider resolved from validated env (see index.ts)
 * and do all upload/replace/delete/read-URL work through it. Providers are
 * selected, never guessed — `describeStorage()` always reports which one is
 * ACTUALLY active so the system can never claim S3 while running locally.
 */

export type StorageDriverName = 'local' | 's3';

export type ObjectVisibility = 'public' | 'private';

export interface ReadUrl {
  /** Absolute URL for S3 providers; origin-relative ("/uploads/…") for local. */
  url: string;
  /** 'public' = cacheable direct link; 'signed' = verify-and-expire link. */
  kind: 'public' | 'signed';
  /** Absolute ISO time after which a signed URL no longer verifies (null for public). */
  expiresAt: string | null;
}

export interface DeleteResult {
  deleted: string[];
  failed: string[];
}

export interface SignedUploadUrl {
  url: string;
  method: 'PUT';
  expiresAt: string;
  headers: Record<string, string>;
}

/**
 * The single interface every media flow goes through. All keys are RELATIVE
 * object keys (no leading slash, no traversal) validated by the provider.
 */
export interface StorageProvider {
  readonly name: StorageDriverName;

  /** Store an object; implementations must be atomic (no partial objects). */
  putObject(key: string, buffer: Buffer, contentType: string): Promise<void>;

  /** Read an object back; throws a provider-specific error when missing. */
  getObject(key: string): Promise<Buffer>;

  exists(key: string): Promise<boolean>;

  deleteObject(key: string): Promise<void>;

  /** Best-effort batch delete — failed keys are REPORTED, never swallowed. */
  deleteObjects(keys: string[]): Promise<DeleteResult>;

  /** Enumerate keys under a prefix (reconciliation/orphan scanning). */
  listObjects(prefix: string): Promise<string[]>;

  /**
   * Resolve the URL a reader fetches an object from. Private objects get
   * signed, expiring URLs (SigV4 presign on S3, HMAC path tokens on local).
   */
  getReadUrl(key: string, opts?: { visibility?: ObjectVisibility }): Promise<ReadUrl>;

  /**
   * Optional signed direct-to-provider upload URL (S3 presigned PUT).
   * Local provider has no equivalent and returns undefined.
   */
  getUploadUrl?(key: string, opts?: { expiresIn?: number; visibility?: ObjectVisibility }):
    Promise<SignedUploadUrl>;
}

export class StorageProviderError extends Error {
  readonly provider: StorageDriverName;
  readonly status?: number;
  constructor(provider: StorageDriverName, message: string, status?: number) {
    super(`[${provider}] ${message}`);
    this.name = 'StorageProviderError';
    this.provider = provider;
    this.status = status;
  }
}
