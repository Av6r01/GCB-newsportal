/**
 * Minimal HTTP test client for hitting the live Express app on a random port.
 * Spins up the real server.ts Express app with an isolated DB file injected
 * via environment variable override before module load.
 *
 * Because server.ts uses a module-level singleton DB, we use child_process
 * for complete isolation when needed. For route-level tests that call the
 * HTTP layer directly, we use http.request against a started server.
 */

import http from 'http';
import https from 'https';

export interface TestResponse {
  status: number;
  body: any;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Sends an HTTP request to the test server.
 */
export async function request(
  baseUrl: string,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const options = {
      hostname: url.hostname,
      port: parseInt(url.port) || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: reqHeaders,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed: any;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({
          status: res.statusCode || 0,
          body: parsed,
          headers: res.headers as Record<string, string | string[] | undefined>,
        });
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export function bearerHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
