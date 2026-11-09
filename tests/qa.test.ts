/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import { db, IntegrityError } from '../src/lib/db.ts';
import { seedDevelopmentData } from '../src/lib/seed.ts';

async function runQATests() {
  console.log('🧪 Starting Global Chronicle News QA & Regression Test Suite...');
  await seedDevelopmentData();

  // 1. Authentication & Session
  console.log('  [Category 1] Testing Authentication & Session...');
  const adminEmail = 'demo-editor@globalchronicle.test';
  const admin = await db.user.findUnique({ where: { email: adminEmail } });
  assert.ok(admin, 'Admin user must exist in seeded data');
  assert.strictEqual(admin.isActive, true, 'Seeded admin must be active');
  console.log('  ✓ Admin account verified.');

  // 2. CMS Workflow - Create, Edit, Publish
  console.log('  [Category 2] Testing CMS Publication Lifecycle...');
  const newArticle = await db.article.create({
    data: {
      title: 'QA Test Article',
      slug: 'qa-test-article-' + Date.now(),
      excerpt: 'Test excerpt',
      content: '<p>Initial content</p>',
      categoryId: (await db.category.findMany())[0].id,
      authorId: admin.id,
      status: 'DRAFT',
      articleType: 'STANDARD'
    }
  });
  assert.strictEqual(newArticle.status, 'DRAFT', 'New article must start as draft');
  console.log('  ✓ Article draft creation verified.');

  // Update
  await db.article.update({
    where: { id: newArticle.id },
    data: { content: '<p>Updated content</p>', status: 'PUBLISHED' }
  });
  const published = await db.article.findUnique({ where: { id: newArticle.id } });
  assert.strictEqual(published.status, 'PUBLISHED', 'Article status must be PUBLISHED');
  assert.ok(published.publishedAt, 'Published article must have a publishedAt timestamp');
  console.log('  ✓ Article publication workflow verified.');

  // 3. Specialized Content Types (Video & Gallery)
  console.log('  [Category 3] Testing Specialized Content Types...');
  const videoArticle = await db.article.create({
    data: {
      title: 'QA Video Article',
      slug: 'qa-video-' + Date.now(),
      excerpt: 'Video test',
      content: '<p>Video article body</p>',
      categoryId: published.categoryId,
      authorId: admin.id,
      articleType: 'VIDEO',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    }
  });
  assert.strictEqual(videoArticle.articleType, 'VIDEO');
  assert.strictEqual(videoArticle.videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  console.log('  ✓ Video article type verified.');

  // Gallery
  const galleryArticle = await db.article.create({
    data: {
      title: 'QA Gallery Article',
      slug: 'qa-gallery-' + Date.now(),
      excerpt: 'Gallery test',
      content: '<p>Gallery article body</p>',
      categoryId: published.categoryId,
      authorId: admin.id,
      articleType: 'PHOTO_GALLERY'
    }
  });

  // Create test media assets
  const media1 = await db.mediaAsset.create({
    data: {
      filename: 'test1.jpg',
      originalUrl: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=1200',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      uploaderId: admin.id
    }
  });
  const media2 = await db.mediaAsset.create({
    data: {
      filename: 'test2.jpg',
      originalUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=1200',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      uploaderId: admin.id
    }
  });

  const assets = [media1, media2];
  console.log(`    Created ${assets.length} test media assets for gallery.`);
  for (const [idx, asset] of assets.entries()) {
    const am = await db.articleMedia.create({
      data: {
        articleId: galleryArticle.id,
        mediaAssetId: asset.id,
        position: idx
      }
    });
    console.log(`    Created articleMedia link for asset ${asset.id}: ${am.id}`);
  }
  const fullGallery = await db.article.findUnique({ where: { id: galleryArticle.id } });
  console.log(`    Full gallery mediaAssets length: ${fullGallery.mediaAssets?.length || 0}`);
  assert.strictEqual(fullGallery.mediaAssets.length, 2, 'Gallery article must have linked media assets');
  console.log('  ✓ Photo gallery article type and media linking verified.');

  // 4. Security & Access Control
  console.log('  [Category 4] Testing Security & Access Control...');
  let deleteAuthorBlocked = false;
  try {
    await db.user.delete({ where: { id: admin.id } });
  } catch (err) {
    if (err instanceof IntegrityError) deleteAuthorBlocked = true;
  }
  assert.strictEqual(deleteAuthorBlocked, true, 'Deleting an author with articles must be blocked');
  console.log('  ✓ Author referential integrity verified.');

  // 5. SEO & Metadata
  console.log('  [Category 5] Testing SEO Data Integrity...');
  const seoArticle = await db.article.findUnique({ where: { id: published.id } });
  assert.ok(seoArticle.slug, 'Article must have a stable URL slug');
  assert.ok(seoArticle.updatedAt, 'Article must have modification timestamp');
  console.log('  ✓ SEO core metadata verified.');

  console.log('🎉 All QA tests passed successfully!');
}

runQATests().catch((err) => {
  console.error('❌ QA test execution failed:', err);
  process.exit(1);
});
