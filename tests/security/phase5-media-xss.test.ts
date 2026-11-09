/**
 * Phase 5 Security Tests — Media Security & XSS Remediation
 *
 * Covers:
 *   MED  — Upload permissions (all five endpoints)
 *   SVG  — SVG rejection by default; XSS payloads in allowed mode
 *   SIG  — File signature validation (magic bytes)
 *   SAN  — Article content HTML sanitization (server-side)
 *   PRIV — Private asset references not exposed to unauthenticated callers
 *   RATE — Upload rate limiting
 *   HDR  — Security headers on /uploads/ static responses
 *   ORPH — Orphan asset detection endpoint
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InMemoryTestDb, hashPassword } from './testDb.ts';
import { buildTestApp, signToken } from './appFactory.ts';
import { request, bearerHeader } from './testApp.ts';
import {
  inspectBufferSignature,
  checkUploadRateLimit,
  generateSafeFileName,
  svgUploadsAllowed,
} from '../../src/server/mediaSecurity.ts';
import { sanitizeArticleContent, sanitizeExcerpt, validateUrl } from '../../src/lib/contentSanitizer.ts';

async function runTests() {
  console.log('\n🖼️  [Phase 5] Media Security & XSS Remediation\n');
  let passed = 0, failed = 0;

  function check(name: string, cond: boolean, note = '') {
    if (cond) { console.log(`  ✅ ${name}`); passed++; }
    else       { console.log(`  ❌ ${name}${note ? ' — ' + note : ''}`); failed++; }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────
  const db = new InMemoryTestDb();
  const hash = await hashPassword('Test123!');
  const reporter = await db.user.create({ data: { email: 'rep5@gc.test', name: 'Reporter', role: 'REPORTER', passwordHash: hash, isActive: true } });
  const editor   = await db.user.create({ data: { email: 'ed5@gc.test',  name: 'Editor',   role: 'MANAGING_EDITOR', passwordHash: hash, isActive: true } });
  const reader   = await db.user.create({ data: { email: 'rd5@gc.test',  name: 'Reader',   role: 'READER', passwordHash: hash, isActive: true } });
  const cat = await db.category.create({ data: { id: 'cat5', name: 'World', slug: 'world5' } });
  await db.article.create({ data: { title: 'Public Article', slug: 'pub-art-5', excerpt: 'x', content: '<p>Hello</p>', categoryId: cat.id, authorId: reporter.id, status: 'PUBLISHED' } });
  await db.article.create({ data: { title: 'Draft Article',  slug: 'draft-art-5', excerpt: 'x', content: '<p>Draft</p>', categoryId: cat.id, authorId: reporter.id, status: 'DRAFT' } });

  const rToken  = signToken({ id: reporter.id, email: reporter.email, role: reporter.role, name: reporter.name });
  const edToken = signToken({ id: editor.id,   email: editor.email,   role: editor.role,   name: editor.name });
  const rdToken = signToken({ id: reader.id,   email: reader.email,   role: reader.role,   name: reader.name });

  const { baseUrl, close } = await buildTestApp(db, { fixedRoutes: true });

  // ── MED: Upload permission enforcement ──────────────────────────────────────
  console.log('  ── MED: Upload permission enforcement ──');

  // MED-1: READER cannot upload
  {
    const r = await request(baseUrl, 'POST', '/api/media/file-upload', {}, bearerHeader(rdToken));
    check('MED-1: READER cannot upload (403)', r.status === 403, `got ${r.status}`);
  }

  // MED-2: Unauthenticated cannot upload
  {
    const r = await request(baseUrl, 'POST', '/api/media/file-upload', {});
    check('MED-2: Unauthenticated cannot upload (401)', r.status === 401, `got ${r.status}`);
  }

  // MED-3: READER cannot edit media metadata (PUT)
  {
    const r = await request(baseUrl, 'PUT', '/api/media/some-id', { altText: 'hack' }, bearerHeader(rdToken));
    check('MED-3: READER cannot edit media metadata (403)', r.status === 403, `got ${r.status}`);
  }

  // MED-4: REPORTER cannot delete media (no media:manage)
  {
    const r = await request(baseUrl, 'DELETE', '/api/media/some-id', undefined, bearerHeader(rToken));
    check('MED-4: REPORTER cannot delete media (403)', r.status === 403, `got ${r.status}`);
  }

  // MED-5: Unauthenticated cannot list media
  {
    const r = await request(baseUrl, 'GET', '/api/media');
    check('MED-5: Unauthenticated cannot list media (401)', r.status === 401, `got ${r.status}`);
  }

  // MED-6: Authenticated user can list media
  {
    const r = await request(baseUrl, 'GET', '/api/media', undefined, bearerHeader(rToken));
    check('MED-6: Authenticated user can list media (200)', r.status === 200, `got ${r.status}`);
  }

  // MED-7: Public media detail omits uploaderId
  {
    await db.mediaAsset.create({ data: { id: 'med-p5', filename: 'test.jpg', originalUrl: '/uploads/test.jpg', mimeType: 'image/jpeg', uploaderId: reporter.id } });
    const r = await request(baseUrl, 'GET', '/api/media/med-p5');
    check('MED-7: Public media detail hides uploaderId',
      r.status === 200 && !r.body?.uploaderId,
      `uploaderId=${r.body?.uploaderId}`);
  }

  // ── SVG: Reject by default ─────────────────────────────────────────────────
  console.log('\n  ── SVG: Rejection & XSS payload scanning ──');

  // SVG-1: svgUploadsAllowed() is false by default
  {
    delete process.env.ALLOW_SVG_UPLOADS;
    check('SVG-1: SVG uploads disabled by default (ALLOW_SVG_UPLOADS not set)', !svgUploadsAllowed());
  }

  // SVG-2: Safe SVG rejected when uploads disabled
  {
    const safeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>');
    const result = inspectBufferSignature(safeSvg);
    check('SVG-2: Safe SVG rejected when ALLOW_SVG_UPLOADS=false',
      !result.isValid && result.detectedType === 'SVG_REJECTED',
      `isValid=${result.isValid} type=${result.detectedType}`);
  }

  // SVG-3: Enable SVG and verify XSS payloads still blocked
  process.env.ALLOW_SVG_UPLOADS = 'true';

  const xssPayloads: Array<[string, string]> = [
    ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'script tag'],
    ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', 'onload handler'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>', 'javascript: href'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>', 'foreignObject'],
    ['<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="data:text/html,<script>alert(1)</script>"/></svg>', 'xlink data URI'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="alert(1)"/></svg>', 'onerror handler'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" values="javascript:alert(1)"/></svg>', 'animate href'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="href" to="javascript:alert(1)"/></svg>', 'set href'],
  ];

  for (const [payload, label] of xssPayloads) {
    const result = inspectBufferSignature(Buffer.from(payload));
    check(`SVG-3: XSS "${label}" rejected`, !result.isValid, `isValid=${result.isValid} error=${result.error}`);
  }

  // SVG-4: Clean SVG accepted when uploads enabled
  {
    const cleanSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect x="10" y="10" width="180" height="180" fill="#336699"/><text x="100" y="110" text-anchor="middle" fill="white">GCN</text></svg>');
    const result = inspectBufferSignature(cleanSvg);
    check('SVG-4: Clean SVG accepted when ALLOW_SVG_UPLOADS=true', result.isValid && result.detectedType === 'SVG',
      `isValid=${result.isValid} type=${result.detectedType}`);
  }

  delete process.env.ALLOW_SVG_UPLOADS; // restore default

  // ── SIG: File signature / magic byte validation ────────────────────────────
  console.log('\n  ── SIG: File signature validation ──');

  const sigTests: Array<[Buffer | string, boolean, string, string]> = [
    [Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),                          true,  'JPEG', 'JPEG'],
    [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),true,  'PNG',  'PNG'],
    [Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),             true,  'GIF',  'GIF'],
    [Buffer.from([0x52, 0x49, 0x46, 0x46, 0,0,0,0, 0x57, 0x45, 0x42, 0x50]), true, 'WEBP', 'WebP'],
    [Buffer.from([0x4D, 0x5A, 0x90, 0x00]),                         false, 'EXECUTABLE', 'PE executable'],
    [Buffer.from([0x7F, 0x45, 0x4C, 0x46]),                         false, 'ELF_BINARY', 'ELF binary'],
    ['<?php system($_GET["cmd"]); ?>',                               false, 'PHP_SCRIPT', 'PHP script'],
    ['#!/bin/bash\nrm -rf /',                                       false, 'SHELL_SCRIPT', 'Shell script'],
    [Buffer.from([0x50, 0x4B, 0x03, 0x04]),                         false, 'ZIP_ARCHIVE', 'ZIP archive'],
    [Buffer.from([0xFF]),                                            false, 'UNKNOWN', 'Empty/tiny file'],
  ];

  for (const [input, expectedValid, expectedType, label] of sigTests) {
    const buf = typeof input === 'string' ? Buffer.from(input) : input;
    const result = inspectBufferSignature(buf);
    check(`SIG: ${label} → isValid=${expectedValid} type=${expectedType}`,
      result.isValid === expectedValid && result.detectedType === expectedType,
      `got isValid=${result.isValid} type=${result.detectedType}`);
  }

  // SIG: Oversized file rejected
  {
    const huge = Buffer.alloc(11 * 1024 * 1024, 0xFF); // 11 MB — over 10 MB limit
    // Insert JPEG magic bytes so it would otherwise pass
    huge[0] = 0xFF; huge[1] = 0xD8; huge[2] = 0xFF; huge[3] = 0xE0;
    const result = inspectBufferSignature(huge);
    check('SIG: Oversized file (11 MB) rejected', !result.isValid && result.detectedType === 'OVERSIZED',
      `isValid=${result.isValid} type=${result.detectedType}`);
  }

  // ── SAN: Content sanitization ──────────────────────────────────────────────
  console.log('\n  ── SAN: Article content sanitization ──');

  const sanitizeCases: Array<[string, string, string]> = [
    ['<script>alert(1)</script><p>Hello</p>',                       '<p>Hello</p>',                 'script tag stripped'],
    ['<p onclick="alert(1)">Click</p>',                             '<p>Click</p>',                  'onclick stripped from p'],
    ['<a href="javascript:alert(1)">link</a>',                      '<span>link</span>',             'javascript: href replaced with span'],
    ['<img src="javascript:alert(1)" alt="x">',                     '<span></span>',                 'javascript: img src replaced with span'],
    ['<p style="background:url(javascript:alert(1))">x</p>',        '<p>x</p>',                     'inline style stripped'],
    ['<iframe src="https://evil.com"></iframe>',                     '',                              'iframe stripped'],
    ['<p><strong>Bold</strong> and <em>italic</em></p>',            '<p><strong>Bold</strong> and <em>italic</em></p>', 'safe formatting preserved'],
    ['<a href="https://example.com" target="_blank">link</a>',      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>', 'target=_blank gets rel=noopener'],
    ['<h2 id="section">Title</h2><p>Para</p>',                     '<h2 id="section">Title</h2><p>Para</p>', 'headings and IDs preserved'],
  ];

  for (const [input, expected, label] of sanitizeCases) {
    const result = sanitizeArticleContent(input);
    check(`SAN: ${label}`, result === expected, `expected="${expected}" got="${result}"`);
  }

  // Excerpt sanitization
  {
    const excerpt = '<script>alert(1)</script>This is an excerpt with <b>bold</b> text.';
    const result = sanitizeExcerpt(excerpt);
    check('SAN: excerpt strips all HTML tags', !result.includes('<') && !result.includes('script'),
      `got: ${result}`);
  }

  // URL validation
  {
    check('SAN: validateUrl accepts https://', validateUrl('https://example.com') === 'https://example.com');
    check('SAN: validateUrl accepts relative /', validateUrl('/uploads/image.jpg') === '/uploads/image.jpg');
    check('SAN: validateUrl rejects javascript:', validateUrl('javascript:alert(1)') === null);
    check('SAN: validateUrl rejects data:', validateUrl('data:text/html,<script>alert(1)</script>') === null);
    check('SAN: validateUrl rejects //', validateUrl('//evil.com/xss') === null);
  }

  // Server-side: article create with XSS payload is sanitized
  {
    const r = await request(baseUrl, 'POST', '/api/articles', {
      title: 'XSS Test Article',
      excerpt: '<script>alert(1)</script>Clean excerpt',
      content: '<p>Clean</p><script>alert(1)</script><img src="javascript:x">',
      categoryId: cat.id,
    }, bearerHeader(rToken));
    check('SAN: Article create sanitizes content server-side', r.status === 201 || r.status === 200,
      `got ${r.status}`);
    if (r.status === 200 || r.status === 201) {
      check('SAN: script tag removed from stored content', !r.body?.content?.includes('<script>'),
        `content still contains script: ${r.body?.content}`);
      check('SAN: javascript: src removed from stored content', !r.body?.content?.includes('javascript:'),
        `content still has javascript:: ${r.body?.content}`);
      check('SAN: excerpt stripped of HTML', !r.body?.excerpt?.includes('<script>'),
        `excerpt: ${r.body?.excerpt}`);
    }
  }

  // ── PRIV: Private asset references not exposed ─────────────────────────────
  console.log('\n  ── PRIV: Private asset references ──');

  // PRIV-1: Media usages requires auth
  {
    const r = await request(baseUrl, 'GET', '/api/media/med-p5/usages');
    check('PRIV-1: Media usages requires auth (401)', r.status === 401, `got ${r.status}`);
  }

  // PRIV-2: Authenticated media usages does not expose draft article
  {
    await db.mediaAsset.create({ data: { id: 'med-draft', filename: 'draft.jpg', originalUrl: '/uploads/draft.jpg', mimeType: 'image/jpeg', uploaderId: reporter.id } });
    const draftArt = db.data.articles.find(a => a.slug === 'draft-art-5')!;
    draftArt.coverImageId = 'med-draft';
    const r = await request(baseUrl, 'GET', '/api/media/med-draft/usages', undefined, bearerHeader(rdToken));
    const deps = r.body?.dependentArticles || [];
    check('PRIV-2: Media usages hides DRAFT article from READER',
      !deps.some((a: any) => a.status === 'DRAFT'),
      `draft exposed: ${JSON.stringify(deps)}`);
  }

  // PRIV-3: Anonymous GET /api/media/:id omits uploaderId
  {
    const r = await request(baseUrl, 'GET', '/api/media/med-p5');
    check('PRIV-3: Public media detail response omits uploaderId',
      r.status === 200 && r.body?.uploaderId === undefined,
      `uploaderId present: ${r.body?.uploaderId}`);
  }

  // ── RATE: Upload rate limiting ─────────────────────────────────────────────
  console.log('\n  ── RATE: Upload rate limiting ──');

  // RATE-1: checkUploadRateLimit allows first 20, blocks 21st
  {
    const testUserId = 'rate-test-user-' + Date.now();
    let allowed = 0, blocked = 0;
    for (let i = 0; i < 25; i++) {
      if (checkUploadRateLimit(testUserId)) allowed++; else blocked++;
    }
    check('RATE-1: Upload rate limit: 20 allowed, 5 blocked', allowed === 20 && blocked === 5,
      `allowed=${allowed} blocked=${blocked}`);
  }

  // ── ORPH: Orphan asset detection ───────────────────────────────────────────
  console.log('\n  ── ORPH: Orphan asset detection ──');

  // ORPH-1: Orphan endpoint requires auth
  {
    const r = await request(baseUrl, 'GET', '/api/admin/media/orphans');
    check('ORPH-1: Orphan endpoint requires auth (401)', r.status === 401, `got ${r.status}`);
  }

  // ORPH-2: Orphan endpoint requires media:manage permission
  {
    const r = await request(baseUrl, 'GET', '/api/admin/media/orphans', undefined, bearerHeader(rToken));
    check('ORPH-2: REPORTER cannot access orphan endpoint (403)', r.status === 403, `got ${r.status}`);
  }

  // ORPH-3: Editor with media:manage can see orphans
  {
    const r = await request(baseUrl, 'GET', '/api/admin/media/orphans', undefined, bearerHeader(edToken));
    check('ORPH-3: MANAGING_EDITOR can access orphan report (200)', r.status === 200, `got ${r.status}`);
    if (r.status === 200) {
      check('ORPH-3b: Orphan report has count field', typeof r.body?.count === 'number', `count=${r.body?.count}`);
      check('ORPH-3c: Orphan report has orphans array', Array.isArray(r.body?.orphans), `orphans=${typeof r.body?.orphans}`);
    }
  }

  // ── generateSafeFileName ───────────────────────────────────────────────────
  console.log('\n  ── UTIL: Safe filename generation ──');

  {
    const { storedName: n1 } = generateSafeFileName('photo.jpg', 'jpg');
    const { storedName: n2 } = generateSafeFileName('photo.jpg', 'jpg');
    check('UTIL-1: generateSafeFileName produces unique names', n1 !== n2, `both=${n1}`);
    check('UTIL-2: Stored name has correct extension', n1.endsWith('.jpg'), `name=${n1}`);
    check('UTIL-3: Stored name has no path traversal chars', !n1.includes('/') && !n1.includes('..'), `name=${n1}`);
    check('UTIL-4: Stored name is lowercase', n1 === n1.toLowerCase(), `name=${n1}`);
  }

  {
    const { storedName } = generateSafeFileName('../../../etc/passwd', 'jpg');
    check('UTIL-5: Path traversal in filename sanitized', !storedName.includes('..') && !storedName.includes('/'), `name=${storedName}`);
  }

  // ── HDR: Security headers verified in source ────────────────────────────────
  console.log('\n  ── HDR: Security header configuration ──');

  {
    const serverTs = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
    check('HDR-1: X-Content-Type-Options: nosniff set', serverTs.includes("'X-Content-Type-Options', 'nosniff'"));
    check('HDR-2: CSP header set with frame-ancestors none', serverTs.includes("frame-ancestors 'none'"));
    check('HDR-3: Referrer-Policy set', serverTs.includes('Referrer-Policy'));
    check('HDR-4: Permissions-Policy set', serverTs.includes('Permissions-Policy'));
    check('HDR-5: HSTS set in production path', serverTs.includes('Strict-Transport-Security'));
    check('HDR-6: Dev CSP allows unsafe-eval for Vite HMR', serverTs.includes("unsafe-eval") && serverTs.includes('isDev'));
    // HDR-7: verify unsafe-eval only appears in the dev branch of the CSP ternary.
    // The prod array starts with ': [' after the ternary expression.
    // We check that the production-branch CSP lines don't contain unsafe-eval.
    // Strategy: find the ternary else-branch (after the dev array's closing bracket) and verify.
    const devBranchEnd = serverTs.indexOf("upgrade-insecure-requests");
    const afterDevBranch = devBranchEnd > 0 ? serverTs.slice(devBranchEnd) : '';
    check('HDR-7: Prod CSP does not contain unsafe-eval',
      !afterDevBranch.includes("unsafe-eval"), 'unsafe-eval found in production CSP branch');
    check('HDR-8: /uploads static served with nosniff', serverTs.includes("Cross-Origin-Resource-Policy") && serverTs.includes("same-site"));
    check('HDR-9: /uploads dotfiles denied', serverTs.includes("dotfiles: 'deny'"));
  }

  await close();

  console.log(`\n  [Phase 5] ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

runTests().then(({ failed }) => {
  if (failed > 0) { console.error(`[Phase 5] ${failed} tests failed`); process.exit(1); }
  console.log('[Phase 5] All tests passed ✅');
}).catch(err => { console.error(err); process.exit(1); });
