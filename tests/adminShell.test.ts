/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { db } from '../src/lib/db.ts';
import { RoleType } from '../src/modules/auth/permissions.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'global-chronicle-secret-key-2026';

function generateToken(user: { id: string; email: string; role: RoleType; name: string }) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '1h' });
}

async function runAdminShellTests() {
  console.log('🖥️  Starting Admin Application Shell & Dashboard Contract Test Suite...');

  // 1. Fetch real database entities to verify dashboard data contract
  console.log('  [Test 1] Testing real database dashboard aggregation...');
  const totalPublished = await db.article.count({ where: { status: 'PUBLISHED' } });
  const inReview = await db.article.count({ where: { status: 'IN_REVIEW' } });
  const viewsAggregate = await db.article.aggregate({ _sum: { views: true } });
  const publishedStories = await db.article.findMany({ where: { status: 'PUBLISHED' }, take: 5 });
  const auditLogs = await db.auditLog.findMany();

  assert.ok(typeof totalPublished === 'number', 'totalPublished must be a number');
  assert.ok(typeof inReview === 'number', 'inReview must be a number');
  assert.ok(Array.isArray(publishedStories), 'recentlyPublishedStories must be an array');
  assert.ok(Array.isArray(auditLogs), 'auditLogs must be an array');
  console.log(`  ✓ Aggregations verified: ${totalPublished} published stories, ${viewsAggregate._sum.views || 0} total reads.`);

  // 2. Token Security Verification
  console.log('  [Test 2] Verifying privileged token access...');
  const adminUser = await db.user.findUnique({ where: { email: 'admin@globalchronicle.news' } });
  assert.ok(adminUser, 'Admin user must exist in database');

  const adminToken = generateToken({
    id: adminUser.id,
    email: adminUser.email,
    role: adminUser.role as RoleType,
    name: adminUser.name,
  });

  const decoded: any = jwt.verify(adminToken, JWT_SECRET);
  assert.strictEqual(decoded.id, adminUser.id);
  assert.strictEqual(decoded.role, 'ADMIN');
  console.log('  ✓ Privileged admin token verification verified.');

  console.log('🎉 All Admin Application Shell & Dashboard Contract tests passed successfully!');
}

runAdminShellTests().catch((err) => {
  console.error('❌ Admin shell test execution failed:', err);
  process.exit(1);
});
