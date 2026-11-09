/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 11 — S3-compatible storage provider (AWS S3, MinIO, Cloudflare R2, …).
 *
 * Real AWS Signature V4 requests implemented on Node's crypto primitives —
 * no SDK, no placeholder switch that pretends to be S3. Supports:
 *   PUT  object (payload hash chained into the signature)
 *   GET  object
 *   HEAD object (exists)
 *   DELETE object
 *   LIST objects (ListObjectsV2 with continuation-paging)
 *   presigned GET (private reads) and presigned PUT (signed upload URLs)
 *
 * URL style: with S3_ENDPOINT set (MinIO/R2) requests are PATH-STYLE
 * `<endpoint>/<bucket>/<key>`; without it the AWS VIRTUAL-HOSTED default
 * `https://<bucket>.s3.<region>.amazonaws.com/<key>` is used.
 *
 * Failures throw StorageProviderError carrying the HTTP status so callers can
 * decide policy; nothing is silently swallowed (tests/p11 asserts a server
 * error aborts an upload with no DB row and no orphaned object left behind).
 */
import crypto from 'crypto';
import {
  StorageProvider,
  StorageProviderError,
  type DeleteResult,
  type ObjectVisibility,
  type ReadUrl,
  type SignedUploadUrl,
} from './types.ts';
import { assertSafeProviderKeyWithDriver } from './keys.ts';
import { env } from '../../configuration/env.ts';

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf-8').digest();
}

/** AWS SigV4 URI encoding (RFC 3986, unreserved: A-Za-z0-9 - _ . ~) */
function sigV4Encode(value: string, encodeSlash = true): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, encodeSlash ? '%2F' : '/');
}

function amzDates(d: Date): { amzDate: string; dateStamp: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const amzDate = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly protocol: string;
  private readonly basePath: string;      // e.g. "/bucket" for path-style, "" virtual-hosted
  private readonly host: string;
  private readonly keyPrefix: string;

  constructor(cfg: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
    prefix?: string;
  }) {
    this.bucket = cfg.bucket;
    this.region = cfg.region;
    this.accessKeyId = cfg.accessKeyId;
    this.secretAccessKey = cfg.secretAccessKey;
    this.keyPrefix = (cfg.prefix || '').replace(/^\/+|\/+$/g, '');
    let hostPort = '';
    if (cfg.endpoint) {
      const u = new URL(cfg.endpoint);
      this.protocol = u.protocol;
      hostPort = `${u.hostname}${u.port ? `:${u.port}` : ''}`;
      this.host = hostPort;
      this.basePath = `${u.pathname.replace(/\/+$/, '')}/${this.bucket}`; // PATH-STYLE
    } else {
      this.protocol = 'https:';
      this.host = `${this.bucket}.s3.${this.region}.amazonaws.com`; // VIRTUAL-HOSTED
      this.basePath = '';
    }
  }

  private prefixed(key: string): string {
    assertSafeProviderKeyWithDriver('s3', key);
    return this.keyPrefix ? `${this.keyPrefix}/${key}` : key;
  }

  /** The canonical request URI for a key (already prefixed). */
  private canonicalUri(prefixedKey: string): string {
    const encoded = prefixedKey.split('/').map((seg) => sigV4Encode(seg)).join('/');
    return `${this.basePath}/${encoded}`;
  }

  private requestUrl(key: string): string {
    return `${this.protocol}//${this.host}${this.canonicalUri(key)}`;
  }

  /**
   * Signed S3 REST request.
   */
  private async request(
    method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
    key: string,
    opts?: { body?: Buffer; contentType?: string; extraHeaders?: Record<string, string> },
  ): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
    const prefixedKey = this.prefixed(key);
    const now = new Date();
    const { amzDate, dateStamp } = amzDates(now);
    const body = opts?.body;
    const payloadHash = body && method !== 'GET' && method !== 'HEAD' ? sha256Hex(body) : sha256Hex('');

    const url = new URL(this.requestUrl(prefixedKey));
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(opts?.contentType ? { 'content-type': opts.contentType } : {}),
      ...(opts?.extraHeaders || {}),
    };

    const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalHeaders = signedHeaderNames
      .map((h) => {
        const valueKey = Object.keys(headers).find((k) => k.toLowerCase() === h)!;
        return `${h}:${headers[valueKey].trim()}\n`;
      })
      .join('');

    const canonicalRequest = [
      method,
      url.pathname + (url.search || ''),
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf-8').digest('hex');

    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // strip content-type from body-less requests handled below
    const fetchInit: RequestInit = { method, headers: {...headers} };
    if (body && method !== 'GET' && method !== 'HEAD') fetchInit.body = new Uint8Array(body);

    let res: Response;
    try {
      res = await fetch(url, fetchInit);
    } catch (err: any) {
      throw new StorageProviderError(this.name, `network failure contacting object store: ${err?.cause?.code || err?.code || err?.message || err}`);
    }

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { resHeaders[k.toLowerCase()] = v; });
    const resBody = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: resHeaders, body: resBody };
  }

  private assertOk(res: { status: number; body: Buffer }, action: string, key: string): void {
    if (res.status >= 300) {
      const snippet = res.body.subarray(0, 400).toString('utf-8').replace(/\s+/g, ' ');
      throw new StorageProviderError(this.name, `${action} failed for "${key}" (HTTP ${res.status}): ${snippet}`, res.status);
    }
  }

  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const res = await this.request('PUT', key, { body: buffer, contentType });
    this.assertOk(res, 'PUT', key);
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.request('GET', key);
    if (res.status === 404) {
      throw new StorageProviderError(this.name, `object not found: ${key}`, 404);
    }
    this.assertOk(res, 'GET', key);
    return res.body;
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.request('HEAD', key);
    if (res.status === 404) return false;
    if (res.status === 200) return true;
    this.assertOk(res, 'HEAD', key);
    return false;
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.request('DELETE', key);
    // S3 treats DELETE of a missing object as success (204/200) — stay honest to S3 semantics.
    this.assertOk(res, 'DELETE', key);
  }

  async deleteObjects(keys: string[]): Promise<DeleteResult> {
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const key of keys) {
      try {
        await this.deleteObject(key);
        deleted.push(key);
      } catch {
        failed.push(key);
      }
    }
    return { deleted, failed };
  }

  /** ListObjectsV2 with paging. */
  async listObjects(prefixParam: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | null = null;
    do {
      const fullPrefix = this.prefixed(prefixParam || '');
      const qs = new URLSearchParams();
      qs.set('list-type', '2');
      qs.set('prefix', fullPrefix);
      qs.set('max-keys', '1000');
      if (continuationToken) qs.set('continuation-token', continuationToken);
      const canonicalQuery = [...qs.entries()]
        .map(([k, v]) => `${sigV4Encode(k, true)}=${sigV4Encode(v, true)}`)
        .sort()
        .join('&');

      const res = await this.signedListRequest(canonicalQuery);
      this.assertOk(res, 'LIST', fullPrefix);
      const xml = res.body.toString('utf-8');
      for (const m of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
        keys.push(xmlDecode(m[1]));
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
      continuationToken = truncated && next ? xmlDecode(next[1]) : null;
    } while (continuationToken);
    // Strip the configured prefix so callers see provider-relative keys.
    return keys.map((k) => (this.keyPrefix && k.startsWith(this.keyPrefix + '/') ? k.slice(this.keyPrefix.length + 1) : k)).sort();
  }

  /** LIST needs query-string signing instead of a body; same SigV4 core. */
  private async signedListRequest(canonicalQuery: string): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
    const now = new Date();
    const { amzDate, dateStamp } = amzDates(now);
    const payloadHash = sha256Hex('');
    const url = `${this.protocol}//${this.host}${this.basePath}/?${canonicalQuery}`;

    const headers: Record<string, string> = {
      host: new URL(url).host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h].trim()}\n`).join('');
    const canonicalRequest = ['GET', `${this.basePath}/`, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf-8').digest('hex');
    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers: { ...headers } });
    } catch (err: any) {
      throw new StorageProviderError(this.name, `network failure contacting object store: ${err?.cause?.code || err?.code || err?.message || err}`);
    }
    return { status: res.status, headers: {}, body: Buffer.from(await res.arrayBuffer()) };
  }

  async getReadUrl(key: string, opts?: { visibility?: ObjectVisibility }): Promise<ReadUrl> {
    const prefixedKey = this.prefixed(key);
    const visibility = opts?.visibility || env.STORAGE_MEDIA_VISIBILITY;
    if (visibility === 'private') {
      const expiresIn = 900;
      const presigned = await this.presign(prefixedKey, 'GET', UNSIGNED_PAYLOAD, expiresIn);
      return {
        url: presigned.url,
        kind: 'signed',
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    }
    // Public objects: direct bucket/CDN URL — signed header auth is never needed.
    return { url: this.requestUrl(prefixedKey), kind: 'public', expiresAt: null };
  }

  async getUploadUrl(key: string, opts?: { expiresIn?: number; visibility?: ObjectVisibility }): Promise<SignedUploadUrl> {
    const prefixedKey = this.prefixed(key);
    const expiresIn = Math.min(Math.max(opts?.expiresIn ?? 600, 30), 604800);
    const presigned = await this.presign(prefixedKey, 'PUT', UNSIGNED_PAYLOAD, expiresIn);
    return {
      url: presigned.url,
      method: 'PUT',
      expiresAt: presigned.expiresAt,
      headers: { 'Host': new URL(presigned.url).host },
    };
  }

  /** Query-string SigV4 presign (used for private reads and signed upload URLs). */
  private async presign(prefixedKey: string, method: 'GET' | 'PUT', _payload: string, expiresIn: number): Promise<{ url: string; expiresAt: string }> {
    const now = new Date();
    const { amzDate, dateStamp } = amzDates(now);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const credential = sigV4Encode(`${this.accessKeyId}/${credentialScope}`, true);

    const canonicalUri = `${this.basePath}/${prefixedKey.split('/').map((seg) => sigV4Encode(seg, true)).join('/')}`;
    const canonicalQuery = [
      `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
      `X-Amz-Credential=${credential}`,
      `X-Amz-Date=${amzDate}`,
      `X-Amz-Expires=${expiresIn}`,
      `X-Amz-SignedHeaders=host`,
    ].join('&');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      `host:${new URL(`${this.protocol}//${this.host}${this.basePath}/`).host}\n`,
      'host',
      UNSIGNED_PAYLOAD,
    ].join('\n');

    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf-8').digest('hex');

    return {
      url: `${this.protocol}//${this.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
      expiresAt: new Date((Date.now() + expiresIn * 1000)).toISOString(),
    };
  }
}

function xmlDecode(v: string): string {
  return v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
