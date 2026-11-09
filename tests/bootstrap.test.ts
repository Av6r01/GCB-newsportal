/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import { appConfig } from '../src/lib/config.ts';
import { db } from '../src/lib/db.ts';
import { logger } from '../src/lib/logger.ts';
import { AppError, NotFoundError } from '../src/lib/errors.ts';

async function runTests() {
  console.log('🧪 Starting Global Chronicle News Test Suite...');

  // Test 1: Configuration Module
  console.log('  Testing app configuration...');
  assert.strictEqual(appConfig.name, 'Global Chronicle News');
  assert.ok(appConfig.editorial.categories.length > 0, 'Categories must be configured');
  assert.strictEqual(appConfig.editorial.defaultLanguage, 'BN');
  console.log('  ✓ App configuration verified.');

  // Test 2: Error Handling Classes
  console.log('  Testing custom error classes...');
  const notFound = new NotFoundError('Article not found');
  assert.strictEqual(notFound.statusCode, 404);
  assert.strictEqual(notFound.isOperational, true);
  console.log('  ✓ Error classes verified.');

  // Test 3: Structured Logger
  console.log('  Testing structured logging...');
  assert.doesNotThrow(() => {
    logger.info('Test execution info message', 'TEST_RUNNER');
    logger.debug('Test execution debug message', 'TEST_RUNNER');
  });
  console.log('  ✓ Structured logger verified.');

  // Test 4: Database Layer
  console.log('  Testing persistent database operations...');
  const catCount = await db.category.count();
  assert.ok(typeof catCount === 'number', 'Category count must return a number');

  const categories = await db.category.findMany();
  assert.ok(Array.isArray(categories), 'Categories must be an array');
  console.log(`  ✓ Database queries verified (${categories.length} categories active).`);

  // Test 5: Articles Query
  console.log('  Testing article query logic...');
  const result = await db.article.findMany({ take: 5 });
  const articles = Array.isArray(result) ? result : result.articles;
  assert.ok(Array.isArray(articles), 'Articles query must return an array');
  console.log(`  ✓ Article query verified (${articles.length} sample articles retrieved).`);

  console.log('🎉 All bootstrap and integrity tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test execution failed:', err);
  process.exit(1);
});
