/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import { db, IntegrityError } from '../src/lib/db.ts';

async function runTaxonomyAndAuthorTests() {
  console.log('🏷️  Starting Taxonomy and Author Management Test Suite...');

  // 1. Category Creation & Nesting
  console.log('  [Test 1] Testing category creation and nesting...');
  const parentCat = await db.category.create({
    data: {
      name: 'Test Desk ' + Date.now(),
      slug: 'test-desk-' + Date.now(),
      description: 'Test Desk Description',
      color: 'bg-indigo-600',
    },
  });
  assert.ok(parentCat.id, 'Parent category must be created');

  const childCat = await db.category.create({
    data: {
      name: 'Test Sub Desk',
      slug: 'test-sub-desk-' + Date.now(),
      parentId: parentCat.id,
    },
  });
  assert.strictEqual(childCat.parentId, parentCat.id, 'Child category must have parentId set');
  console.log('  ✓ Category creation and nesting verified.');

  // 2. Circular Category Reference Prevention
  console.log('  [Test 2] Testing circular category reference prevention...');
  let circularBlocked = false;
  try {
    await db.category.update({
      where: { id: parentCat.id },
      data: { parentId: childCat.id }, // Child cannot be parent of its parent
    });
  } catch (err: any) {
    if (err instanceof IntegrityError) {
      circularBlocked = true;
    }
  }
  assert.strictEqual(circularBlocked, true, 'Circular reference must be strictly blocked');
  console.log('  ✓ Circular category reference prevention verified.');

  // 3. Tag CRUD & Slug Uniqueness
  console.log('  [Test 3] Testing tag creation and slug uniqueness...');
  const uniqueTagSlug = 'exclusive-topic-' + Date.now();
  const tag1 = await db.tag.create({
    data: {
      name: 'Exclusive Topic',
      slug: uniqueTagSlug,
    },
  });
  assert.ok(tag1.id, 'Tag must be created');

  let duplicateTagBlocked = false;
  try {
    await db.tag.create({
      data: {
        name: 'Another Topic',
        slug: uniqueTagSlug, // duplicate slug
      },
    });
  } catch (err: any) {
    if (err instanceof IntegrityError) {
      duplicateTagBlocked = true;
    }
  }
  assert.strictEqual(duplicateTagBlocked, true, 'Duplicate tag slugs must be blocked');
  console.log('  ✓ Tag CRUD and slug uniqueness verified.');

  // 4. Author Profiles & Reporter Accounts
  console.log('  [Test 4] Testing author profile updates...');
  const testUser = await db.user.create({
    data: {
      email: 'author-test-' + Date.now() + '@gc.test',
      name: 'Test Author',
      passwordHash: 'hash',
      role: 'JOURNALIST',
    },
  });

  const profile = await db.authorProfile.update({
    where: { userId: testUser.id },
    data: {
      byline: 'Senior Investigative Correspondent at Global Chronicle',
      biography: 'Covering politics and global diplomacy.',
      designation: 'Senior Reporter',
      socialLinks: { twitter: '@test_author' },
    },
  });
  assert.strictEqual(profile.userId, testUser.id);
  assert.strictEqual(profile.designation, 'Senior Reporter');
  console.log('  ✓ Author profile updates verified.');

  // Clean up
  await db.category.delete({ where: { id: childCat.id } });
  await db.category.delete({ where: { id: parentCat.id } });
  await db.tag.delete({ where: { id: tag1.id } });

  console.log('🎉 All Taxonomy and Author Management tests passed successfully!');
}

runTaxonomyAndAuthorTests().catch((err) => {
  console.error('❌ Taxonomy test execution failed:', err);
  process.exit(1);
});
