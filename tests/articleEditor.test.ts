/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import { db } from '../src/lib/db.ts';

async function runArticleEditorTests() {
  console.log('📝 Starting Article Model & Editor Test Suite...');

  // 1. Setup Test Author & Category
  const author = (await db.user.findMany())[0];
  const category = (await db.category.findMany())[0];
  assert.ok(author, 'Test author must exist');
  assert.ok(category, 'Test category must exist');

  // 2. Create Article with Full Metadata
  console.log('  [Test 1] Creating article with complete metadata...');
  const article = await db.article.create({
    data: {
      title: 'Investigative Report on Renewable Grids ' + Date.now(),
      slug: 'investigative-report-renewable-' + Date.now(),
      excerpt: 'Standfirst summary of the investigative report.',
      content: '<p>Initial draft body with structured paragraphs.</p>',
      categoryId: category.id,
      authorId: author.id,
      priority: 'INVESTIGATIVE',
      status: 'DRAFT',
      imageCaption: 'Plenary hall photo caption',
      imageCredit: 'Global Chronicle Wire',
      sourceAttribution: 'Special Investigative Team',
      seoTitle: 'SEO Headline for Search',
      seoDescription: 'SEO Meta Description for search snippets.',
      articleType: 'STORY',
      editorialNotes: 'Fact-checking pending on paragraph 3.',
    },
  });

  assert.ok(article.id, 'Article ID must be generated');
  assert.strictEqual(article.status, 'DRAFT');
  console.log('  ✓ Article metadata creation verified.');

  // 3. Update Article & Verify Revision Version Snapshot
  console.log('  [Test 2] Updating article content and checking revision snapshots...');
  const updatedArticle = await db.article.update({
    where: { id: article.id },
    data: {
      content: '<p>Updated paragraph with newly leaked document findings.</p>',
      changeSummary: 'Added leaked document excerpts',
    },
  });

  assert.strictEqual(updatedArticle.version, 2, 'Article version must increment');
  const revisions = await db.articleRevision.findMany({ where: { articleId: article.id } });
  assert.strictEqual(revisions.length, 2, 'Must record 2 revision snapshots');
  assert.strictEqual(revisions[0].content, '<p>Initial draft body with structured paragraphs.</p>');
  assert.strictEqual(revisions[1].content, '<p>Updated paragraph with newly leaked document findings.</p>');
  console.log('  ✓ Immutable revision history and version increment verified.');

  // 4. Clean up test article
  await db.article.delete({ where: { id: article.id } });

  console.log('🎉 All Article Model & Editor tests passed successfully!');
}

runArticleEditorTests().catch((err) => {
  console.error('❌ Article editor test execution failed:', err);
  process.exit(1);
});
