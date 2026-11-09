/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import { db } from '../src/lib/db.ts';
import { validateStateTransition, ArticleState } from '../src/modules/articles/workflow.ts';
import { runPublishingSchedulerSweep } from '../src/server/scheduler.ts';

async function runWorkflowTests() {
  console.log('🔄 Starting Editorial Workflow & Publishing Engine Test Suite...');

  // 1. Validate Valid Transitions Matrix
  console.log('  [Test 1] Testing valid state transitions...');
  const res1 = validateStateTransition('DRAFT', 'IN_REVIEW', 'REPORTER', undefined, true);
  assert.strictEqual(res1.allowed, true, 'Reporter must be allowed to submit draft for review');

  const res2 = validateStateTransition('IN_REVIEW', 'APPROVED', 'MANAGING_EDITOR');
  assert.strictEqual(res2.allowed, true, 'Managing Editor must be allowed to approve story');

  const res3 = validateStateTransition('APPROVED', 'PUBLISHED', 'MANAGING_EDITOR');
  assert.strictEqual(res3.allowed, true, 'Managing Editor must be allowed to publish approved story');
  console.log('  ✓ Valid state transitions verified.');

  // 2. Validate Invalid Transition Rejections
  console.log('  [Test 2] Testing invalid transition rejections...');
  const invalidRes = validateStateTransition('DRAFT', 'PUBLISHED', 'REPORTER');
  assert.strictEqual(invalidRes.allowed, false, 'Direct jump from DRAFT to PUBLISHED must be rejected');
  console.log('  ✓ Invalid transitions rejected.');

  // 3. Mandatory Note Requirement on CHANGES_REQUESTED
  console.log('  [Test 3] Testing mandatory note requirement on change requests...');
  const noNoteRes = validateStateTransition('IN_REVIEW', 'CHANGES_REQUESTED', 'SECTION_EDITOR', '');
  assert.strictEqual(noNoteRes.allowed, false, 'Transition to CHANGES_REQUESTED without note must be blocked');
  assert.strictEqual(noNoteRes.requiresNote, true);

  const withNoteRes = validateStateTransition(
    'IN_REVIEW',
    'CHANGES_REQUESTED',
    'SECTION_EDITOR',
    'Please verify facts in paragraph 3.'
  );
  assert.strictEqual(withNoteRes.allowed, true, 'Transition to CHANGES_REQUESTED with note must be allowed');
  console.log('  ✓ Mandatory note requirement verified.');

  // 4. Role Permission Guard Validation
  console.log('  [Test 4] Testing permission guards on workflow transitions...');
  const reporterPublishRes = validateStateTransition('APPROVED', 'PUBLISHED', 'REPORTER');
  assert.strictEqual(reporterPublishRes.allowed, false, 'Reporter must NOT be allowed to publish dispatches');
  console.log('  ✓ Workflow permission guards verified.');

  // 5. Scheduler Daemon & Overdue Downtime Reconciliation
  console.log('  [Test 5] Testing background scheduler sweep & overdue reconciliation...');
  const testCategory = (await db.category.findMany())[0];
  const testAuthor = (await db.user.findMany())[0];

  // Create an overdue scheduled article (scheduled for 1 hour ago)
  const pastTime = new Date(Date.now() - 3600000).toISOString();
  const scheduledArticle = await db.article.create({
    data: {
      title: 'Scheduled Dispatch Downtime Test ' + Date.now(),
      slug: 'scheduled-downtime-test-' + Date.now(),
      excerpt: 'Scheduled excerpt',
      content: '<p>Scheduled content</p>',
      categoryId: testCategory.id,
      authorId: testAuthor.id,
      status: 'SCHEDULED',
      scheduledFor: pastTime,
    },
  });

  // Run scheduler sweep (simulating daemon tick / startup reconciliation)
  const sweepResult = await runPublishingSchedulerSweep();
  assert.ok(sweepResult.reconciled > 0 || sweepResult.processed > 0, 'Scheduler must reconcile overdue article');

  const recheckedArticle = await db.article.findUnique({ where: { id: scheduledArticle.id } });
  assert.strictEqual(recheckedArticle.status, 'PUBLISHED', 'Overdue scheduled article must be promoted to PUBLISHED');
  console.log('  ✓ Background scheduler sweep and downtime reconciliation verified.');

  // Clean up
  await db.article.delete({ where: { id: scheduledArticle.id } });

  console.log('🎉 All Editorial Workflow & Publishing Engine tests passed successfully!');
}

runWorkflowTests().catch((err) => {
  console.error('❌ Workflow test execution failed:', err);
  process.exit(1);
});
