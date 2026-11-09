/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 — shared object-key validation for every storage provider.
 * One bad key must never read or write outside its scope in ANY backend, so
 * the check lives here and both providers enforce it.
 */
import { StorageProviderError, type StorageDriverName } from './types.ts';

export function assertSafeProviderKeyWithDriver(driver: StorageDriverName, key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
    throw new StorageProviderError(driver, 'object key must be a non-empty string of ≤ 512 chars');
  }
  if (key.startsWith('/') || key.includes('\\') || key.includes('..') || key.endsWith('/')) {
    throw new StorageProviderError(driver, 'object key must be relative and traversal-free');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key)) {
    throw new StorageProviderError(driver, 'object key contains characters outside [A-Za-z0-9._/-]');
  }
}
