/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import { db, IntegrityError } from '../src/lib/db.ts';
import { seedDevelopmentData } from '../src/lib/seed.ts';

async function runDatabaseIntegrityTests() {
  console.log('🛡️  Starting Database & Data Integrity Test Suite...');
  await seedDevelopmentData();

  // Test 1: Category Foreign Key Protection (onDelete: Restrict)
  console.log('  [Test 1] Testing referential integrity: category deletion protection...');
  const categories = await db.category.findMany();
  const worldCategory = categories.find((c) => c.slug === 'world');
  assert.ok(worldCategory, 'World category must exist');

  let deleteBlocked = false;
  try {
    await db.category.delete({ where: { id: worldCategory.id } });
  } catch (err: any) {
    if (err instanceof IntegrityError) {
      deleteBlocked = true;
    }
  }
  assert.strictEqual(deleteBlocked, true, 'Deleting a category with articles must be strictly blocked');
  console.log('  ✓ Category referential integrity verified (historical articles protected).');

  // Test 2: Author Deletion Protection (onDelete: Restrict)
  console.log('  [Test 2] Testing author referential integrity: user deletion protection...');
  const firstArticle = (await db.article.findMany({ take: 1 }))[0];
  assert.ok(firstArticle, 'At least one article must exist');
  const author = await db.user.findUnique({ where: { id: firstArticle.authorId } });
  assert.ok(author, 'Author of first article must exist');

  let authorDeleteBlocked = false;
  try {
    await db.user.delete({ where: { id: author.id } });
  } catch (err: any) {
    if (err instanceof IntegrityError) {
      authorDeleteBlocked = true;
    }
  }
  assert.strictEqual(authorDeleteBlocked, true, 'Deleting an author with published articles must be strictly blocked');
  console.log('  ✓ Author referential integrity verified (byline history protected).');

  // Test 3: Foreign Key Validation on Article Create
  console.log('  [Test 3] Testing foreign key validation on article creation...');
  let invalidFkBlocked = false;
  try {
    await db.article.create({
      data: {
        title: 'Invalid Article Test',
        slug: 'invalid-article-test-' + Date.now(),
        excerpt: 'Test',
        content: '<p>Test</p>',
        categoryId: 'non-existent-category-id',
        authorId: author.id,
      },
    });
  } catch (err: any) {
    if (err instanceof IntegrityError) {
      invalidFkBlocked = true;
    }
  }
  assert.strictEqual(invalidFkBlocked, true, 'Article creation with invalid category ID must be rejected');
  console.log('  ✓ Foreign key validation verified.');

  // Test 4: Slug Uniqueness Rule
  console.log('  [Test 4] Testing slug uniqueness constraint...');
  let duplicateSlugBlocked = false;
  try {
    await db.article.create({
      data: {
        title: 'Duplicate Slug Article',
        slug: 'global-climate-summit-reaches-landmark-accord', // already exists
        excerpt: 'Test duplicate',
        content: '<p>Test</p>',
        categoryId: worldCategory.id,
        authorId: author.id,
      },
    });
  } catch (err: any) {
    if (err instanceof IntegrityError) {
      duplicateSlugBlocked = true;
    }
  }
  assert.strictEqual(duplicateSlugBlocked, true, 'Duplicate article slugs must be rejected');
  console.log('  ✓ Slug uniqueness constraint verified.');

  // Test 5: Immutable Revision History Tracking
  console.log('  [Test 5] Testing immutable revision history...');
  const testArticle = await db.article.create({
    data: {
      title: 'Breaking Investigative Piece on Energy Grid',
      slug: 'breaking-investigative-energy-grid-' + Date.now(),
      excerpt: 'First draft excerpt',
      content: '<p>Initial version of investigative story</p>',
      categoryId: worldCategory.id,
      authorId: author.id,
      status: 'DRAFT',
    },
  });

  const initialRevisions = await db.articleRevision.findMany({ where: { articleId: testArticle.id } });
  assert.strictEqual(initialRevisions.length, 1, 'Initial creation must generate revision version 1');
  assert.strictEqual(initialRevisions[0].version, 1);

  // Update content
  await db.article.update({
    where: { id: testArticle.id },
    data: {
      content: '<p>Updated content with leaked committee documents.</p>',
      changeSummary: 'Added leaked document excerpts',
    },
  });

  const updatedRevisions = await db.articleRevision.findMany({ where: { articleId: testArticle.id } });
  assert.strictEqual(updatedRevisions.length, 2, 'Content update must record an immutable second revision snapshot');
  assert.strictEqual(updatedRevisions[0].version, 1);
  assert.strictEqual(updatedRevisions[1].version, 2);
  assert.strictEqual(updatedRevisions[0].content, '<p>Initial version of investigative story</p>');
  assert.strictEqual(updatedRevisions[1].content, '<p>Updated content with leaked committee documents.</p>');
  console.log('  ✓ Immutable revision history verified (previous version preserved unaltered).');

  // Test 6: Nested Category Hierarchy
  console.log('  [Test 6] Testing nested category parent-child relationships...');
  const nestedCategories = await db.category.findMany();
  const parent = nestedCategories.find((c) => c.slug === 'world');
  assert.ok(parent, 'Parent category must exist');
  assert.ok(parent.children.length > 0, 'Parent category must reflect nested child categories');
  const asiaChild = parent.children.find((child: any) => child.slug === 'asia-pacific');
  assert.ok(asiaChild, 'Nested child category Asia-Pacific must be linked to World parent');
  console.log('  ✓ Nested category hierarchy verified.');

  // Clean up test article
  await db.article.delete({ where: { id: testArticle.id } });

  console.log('🎉 All Database & Data Integrity tests passed successfully!');
}

runDatabaseIntegrityTests().catch((err) => {
  console.error('❌ Data integrity test execution failed:', err);
  process.exit(1);
});
