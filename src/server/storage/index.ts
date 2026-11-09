/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 — storage provider resolution.
 *
 * The provider is chosen EXPLICITLY from validated env (STORAGE_DRIVER), never
 * inferred from what happens to be reachable. `describeStorage()` reports the
 * provider that is actually active — this is the only value any endpoint or
 * log may print, so a local-filesystem backend can never masquerade as S3.
 *
 * Fail-closed rules (enforced again here, belt-and-braces with env.ts):
 *   - STORAGE_DRIVER=s3 with incomplete credentials → throw at resolution time;
 *   - a constructed S3 provider really IS S3-compatible (real SigV4 client) —
 *     nothing in StaticFileLand is labelled S3.
 */
import { env } from '../../configuration/env.ts';
import { LocalStorageProvider } from './local.ts';
import { S3StorageProvider } from './s3.ts';
import type { StorageProvider, StorageDriverName } from './types.ts';
import { assertSafeProviderKeyWithDriver } from './keys.ts';
import { generateImageVariants, deriveVariantKey, VARIANT_TARGETS } from './variants.ts';

export * from './types.ts';
export { assertSafeProviderKeyWithDriver, generateImageVariants, deriveVariantKey, VARIANT_TARGETS };

let cachedProvider: StorageProvider | null = null;

export function resolveStorageProvider(): StorageProvider {
  if (cachedProvider) return cachedProvider;
  if (env.STORAGE_DRIVER === 's3') {
    const missing = (['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const)
      .filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(
        `[FATAL] S3 storage driver requested but misconfigured: missing ${missing.join(', ')} — refusing to start media services on a placeholder.`
      );
    }
    cachedProvider = new S3StorageProvider({
      bucket: (process.env.S3_BUCKET || env.S3_BUCKET)!,
      region: (process.env.S3_REGION || env.S3_REGION)!,
      accessKeyId: (process.env.S3_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID)!,
      secretAccessKey: (process.env.S3_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY)!,
      endpoint: process.env.S3_ENDPOINT || env.S3_ENDPOINT,
      prefix: process.env.S3_UPLOAD_PREFIX || env.S3_UPLOAD_PREFIX,
    });
  } else {
    // local provides its own root directory and static-serving metadata
    cachedProvider = new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
  }
  return cachedProvider;
}

/** Test/isolation hook: drop the cached provider so a new env takes effect. */
export function resetStorageProviderForTests(): void {
  cachedProvider = null;
}

export interface StorageDescription {
  driver: StorageDriverName;
  /** What is ACTUALLY active — never a claimed-but-running state. */
  active:
    | {
        driver: 's3';
        /** true: a real S3-compatible client is the live provider. */
        s3Connected: boolean;
        bucket: string;
        keyPrefix: string;
        region: string;
        endpoint: string | null;
      }
    | {
        driver: 'local';
        s3Connected: boolean;
        localRoot: string;
      };
  visibility: 'public' | 'private';
  publicBaseUrl: string;
  signedUrlTtlSeconds: number;
  variantPolicy: {
    targets: Array<{ name: string; purpose: string; width: number }>;
    encodable: string[];
    note: string;
  };
}

export function describeStorage(): StorageDescription {
  const provider = resolveStorageProvider();
  const isS3 = provider.name === 's3';
  return {
    driver: isS3 ? 's3' : 'local',
    active: isS3
      ? {
          driver: 's3',
          s3Connected: true,
          bucket: env.S3_BUCKET!,
          keyPrefix: env.S3_UPLOAD_PREFIX || '',
          region: env.S3_REGION!,
          endpoint: process.env.S3_ENDPOINT || env.S3_ENDPOINT || null,
        }
      : {
          driver: 'local',
          s3Connected: false,
          localRoot: (provider as LocalStorageProvider).root,
        },
    visibility: env.STORAGE_MEDIA_VISIBILITY,
    publicBaseUrl: publicStorageBaseUrl(),
    signedUrlTtlSeconds: env.STORAGE_SIGNED_URL_TTL_SECONDS,
    variantPolicy: {
      targets: VARIANT_TARGETS.map((t) => ({ name: t.name, purpose: t.purpose, width: t.width })),
      encodable: ['image/png'],
      note:
        'Real resized variants are generated for image/png sources. ' +
        'JPEG/WebP/AVIF/GIF/SVG have no re-encode codec in this dependency-free stack — ' +
        'no variant records with URLs pointing back at the original are fabricated for them.',
    },
  };
}

/**
 * Base URL used for PUBLIC read links. STORAGE_PUBLIC_BASE_URL wins (CDN /
 * bucket-website), otherwise the canonical APP_URL — which is what a local
 * driver's /uploads/<key> paths belong to.
 */
export function publicStorageBaseUrl(): string {
  return (env.STORAGE_PUBLIC_BASE_URL || env.APP_URL).replace(/\/+$/, '');
}
