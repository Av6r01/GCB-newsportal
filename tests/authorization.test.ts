/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { db } from '../src/lib/db.ts';
import { hasPermission, RoleType } from '../src/modules/auth/permissions.ts';
import { loginRateLimiter, revokedTokens } from '../src/server/authMiddleware.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'global-chronicle-secret-key-2026';

function generateTestToken(user: { id: string; email: string; role: RoleType; name: string }) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '1h' });
}

async function runAuthorizationTests() {
  console.log('🔒 Starting Authentication & Access Control Test Suite...');

  // 1. Role Permission Matrix Integrity
  console.log('  [Test 1] Verifying permission matrix for newsroom roles...');
  assert.strictEqual(hasPermission('REPORTER', 'article:create'), true);
  assert.strictEqual(hasPermission('REPORTER', 'article:edit_own'), true);
  assert.strictEqual(hasPermission('REPORTER', 'article:edit_any'), false);
  assert.strictEqual(hasPermission('REPORTER', 'article:publish'), false);

  assert.strictEqual(hasPermission('COPY_EDITOR', 'article:edit_any'), true);
  assert.strictEqual(hasPermission('COPY_EDITOR', 'article:publish'), false);

  assert.strictEqual(hasPermission('MANAGING_EDITOR', 'article:publish'), true);
  assert.strictEqual(hasPermission('MANAGING_EDITOR', 'roles:assign'), false);

  assert.strictEqual(hasPermission('ADVERTISING_MANAGER', 'ad:manage'), true);
  assert.strictEqual(hasPermission('ADVERTISING_MANAGER', 'article:create'), false);
  assert.strictEqual(hasPermission('ADVERTISING_MANAGER', 'roles:assign'), false);

  assert.strictEqual(hasPermission('ANALYST', 'analytics:view'), true);
  assert.strictEqual(hasPermission('ANALYST', 'article:create'), false);
  assert.strictEqual(hasPermission('ANALYST', 'users:manage'), false);

  assert.strictEqual(hasPermission('SUPER_ADMIN', 'roles:assign'), true);
  console.log('  ✓ Role permission matrix verified.');

  // 2. Setup Test Users
  console.log('  [Test 2] Setting up distinct role accounts for tests...');
  const reporterA = (await db.user.findUnique({ where: { email: 'reporterA@gc.test' } })) ||
    await db.user.create({ data: { id: 'usr-reporter-a', email: 'reporterA@gc.test', name: 'Reporter Alice', role: 'REPORTER', passwordHash: 'hash' } });
  const reporterB = (await db.user.findUnique({ where: { email: 'reporterB@gc.test' } })) ||
    await db.user.create({ data: { id: 'usr-reporter-b', email: 'reporterB@gc.test', name: 'Reporter Bob', role: 'REPORTER', passwordHash: 'hash' } });
  const copyEditor = (await db.user.findUnique({ where: { email: 'copyeditor@gc.test' } })) ||
    await db.user.create({ data: { id: 'usr-copy-editor', email: 'copyeditor@gc.test', name: 'Copy Editor Carol', role: 'COPY_EDITOR', passwordHash: 'hash' } });
  const managingEditor = (await db.user.findUnique({ where: { email: 'managing@gc.test' } })) ||
    await db.user.create({ data: { id: 'usr-managing-editor', email: 'managing@gc.test', name: 'Managing Editor Dave', role: 'MANAGING_EDITOR', passwordHash: 'hash' } });
  const adManager = (await db.user.findUnique({ where: { email: 'ads@gc.test' } })) ||
    await db.user.create({ data: { id: 'usr-ad-manager', email: 'ads@gc.test', name: 'Ad Manager Eve', role: 'ADVERTISING_MANAGER', passwordHash: 'hash' } });

  const tokenReporterA = generateTestToken(reporterA);
  const tokenReporterB = generateTestToken(reporterB);
  const tokenCopyEditor = generateTestToken(copyEditor);
  const tokenManagingEditor = generateTestToken(managingEditor);
  const tokenAdManager = generateTestToken(adManager);

  // 3. Horizontal Access Control Simulation
  console.log('  [Test 3] Testing horizontal access violation prevention...');
  const testCategory = (await db.category.findMany())[0];
  const draftA = await db.article.create({
    data: {
      title: 'Secret Draft by Reporter A',
      slug: 'secret-draft-a-' + Date.now(),
      excerpt: 'Excerpt A',
      content: '<p>Body A</p>',
      categoryId: testCategory.id,
      authorId: reporterA.id,
      status: 'DRAFT',
    },
  });

  // Reporter A can edit their own draft
  const canReporterAEditOwn = hasPermission(reporterA.role, 'article:edit_own') && draftA.authorId === reporterA.id;
  assert.strictEqual(canReporterAEditOwn, true, 'Reporter A must be permitted to edit their own draft');

  // Reporter B CANNOT edit Reporter A's draft (Horizontal Access Violation)
  const canReporterBEditA =
    hasPermission(reporterB.role, 'article:edit_any') ||
    (hasPermission(reporterB.role, 'article:edit_own') && draftA.authorId === reporterB.id);
  assert.strictEqual(canReporterBEditA, false, 'Reporter B must NOT be permitted to edit Reporter A draft');
  console.log('  ✓ Horizontal access violation blocked.');

  // 4. Copy Editor vs Managing Editor Publishing Permissions
  console.log('  [Test 4] Testing publishing authority boundary...');
  const canCopyEditorEditAny = hasPermission(copyEditor.role, 'article:edit_any');
  assert.strictEqual(canCopyEditorEditAny, true, 'Copy editor can review and edit any draft');

  const canCopyEditorPublish = hasPermission(copyEditor.role, 'article:publish');
  assert.strictEqual(canCopyEditorPublish, false, 'Copy editor must NOT have publishing authority');

  const canManagingEditorPublish = hasPermission(managingEditor.role, 'article:publish');
  assert.strictEqual(canManagingEditorPublish, true, 'Managing editor must have publishing authority');
  console.log('  ✓ Publishing boundary verified.');

  // 5. Advertising Manager & Analyst Boundaries
  console.log('  [Test 5] Testing non-editorial role boundaries...');
  assert.strictEqual(hasPermission(adManager.role, 'ad:manage'), true);
  assert.strictEqual(hasPermission(adManager.role, 'article:create'), false);
  assert.strictEqual(hasPermission(adManager.role, 'article:edit_any'), false);
  assert.strictEqual(hasPermission(adManager.role, 'roles:assign'), false);
  console.log('  ✓ Non-editorial role boundaries verified.');

  // 6. Login Rate Limiter (Brute-Force Protection)
  console.log('  [Test 6] Testing login brute-force rate limiter...');
  const testIpKey = '192.168.1.100:victim@gc.test';
  loginRateLimiter.recordSuccess(testIpKey); // Reset

  for (let i = 0; i < 4; i++) {
    loginRateLimiter.recordFailure(testIpKey);
  }
  assert.strictEqual(loginRateLimiter.isBlocked(testIpKey).blocked, false, '4 failures must not trigger block');

  // 5th failure triggers block
  loginRateLimiter.recordFailure(testIpKey);
  const blockCheck = loginRateLimiter.isBlocked(testIpKey);
  assert.strictEqual(blockCheck.blocked, true, '5th consecutive failure must trigger rate-limit block');
  assert.ok((blockCheck.remainingSec || 0) > 0, 'Remaining lock seconds must be positive');
  console.log('  ✓ Login rate limiter verified (brute-force locked out).');

  // 7. Session Invalidation — Phase 4: DB-backed jti revocation (durable across restarts)
  console.log('  [Test 7] Testing session revocation...');
  const testJti = 'test-jti-' + Date.now();
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();

  const beforeRevoke = await db.revokedSession.isRevoked(testJti);
  assert.strictEqual(beforeRevoke, false, 'Active jti must not be in revokedSessions');

  await db.revokedSession.revoke(testJti, reporterA.id, expiresAt);
  const afterRevoke = await db.revokedSession.isRevoked(testJti);
  assert.strictEqual(afterRevoke, true, 'Revoked jti must be present in revokedSessions');
  console.log('  ✓ Session revocation verified (DB-backed jti revocation).');

  // Clean up test draft
  await db.article.delete({ where: { id: draftA.id } });

  console.log('🎉 All Authentication & Access Control tests passed successfully!');
}

runAuthorizationTests().catch((err) => {
  console.error('❌ Authorization test execution failed:', err);
  process.exit(1);
});
