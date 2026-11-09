/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from '../lib/database.ts';
import { logger } from '../lib/logger.ts';

export interface SchedulerStatus {
  lastSweep: string;
  processedCount: number;
  reconciledCount: number;
  failedCount: number;
  status: 'ACTIVE' | 'ERROR';
}

let schedulerStatus: SchedulerStatus = {
  lastSweep: new Date().toISOString(),
  processedCount: 0,
  reconciledCount: 0,
  failedCount: 0,
  status: 'ACTIVE',
};

export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

/**
 * Idempotent Scheduled Publishing Sweep (Phase 7)
 *
 * Promotes due and overdue SCHEDULED articles to PUBLISHED state. Each article
 * is executed through `db.publishScheduledArticle`, which fans out all four
 * writes (article update, editorial event, audit log, EXECUTED schedule row)
 * in a single database transaction keyed by `sched-pub-<articleId>-<version>`.
 * Re-running the sweep never re-publishes: the unique idempotencyKey makes
 * repeated executions no-ops, and a crash mid-publish rolls the article back.
 */
export async function runPublishingSchedulerSweep(): Promise<{ processed: number; reconciled: number; failed: number }> {
  let processed = 0;
  let reconciled = 0;
  let failed = 0;
  const now = new Date();

  try {
    const articles = (await db.article.findMany({ where: { status: 'SCHEDULED' } })) as any[];

    for (const article of articles) {
      if (article.scheduledFor && new Date(article.scheduledFor) <= now) {
        try {
          const isOverdue = now.getTime() - new Date(article.scheduledFor).getTime() > 120000; // Overdue by >2 mins
          const idempotencyKey = `sched-pub-${article.id}-${article.version}`;

          const result = await (db as any).publishScheduledArticle({
            articleId: article.id,
            idempotencyKey,
            scheduledFor: article.scheduledFor,
            actorId: 'usr-system-daemon',
            isOverdue,
          });

          if (!result.executed) {
            // ALREADY_EXECUTED / ALREADY_PUBLISHED / ARTICLE_NOT_FOUND — observable, not an error.
            logger.info(
              `Scheduled publish for article ID ${article.id} skipped (${result.reason}).`,
              'SCHEDULER'
            );
            continue;
          }

          if (isOverdue) reconciled++;
          else processed++;

          logger.info(
            `Published ${isOverdue ? 'overdue' : 'scheduled'} article "${result.article.title}" (ID: ${article.id})`,
            'SCHEDULER'
          );
        } catch (err: any) {
          failed++;
          logger.error(`Failed to publish scheduled article ID ${article.id}: ${err.message}`, 'SCHEDULER');
        }
      }
    }

    schedulerStatus = {
      lastSweep: now.toISOString(),
      processedCount: schedulerStatus.processedCount + processed,
      reconciledCount: schedulerStatus.reconciledCount + reconciled,
      failedCount: schedulerStatus.failedCount + failed,
      status: 'ACTIVE',
    };
  } catch (err: any) {
    schedulerStatus.status = 'ERROR';
    logger.error(`Publishing scheduler sweep error: ${err.message}`, 'SCHEDULER');
  }

  return { processed, reconciled, failed };
}

/**
 * Initializes the background Publishing Daemon (60-second sweep interval).
 */
export function startPublishingScheduler(intervalMs = 60000) {
  logger.info('Initializing background publishing scheduler daemon (60s polling sweep)...', 'SCHEDULER');

  // Immediate reconciliation sweep on server startup
  runPublishingSchedulerSweep().catch((err) => {
    logger.error(`Startup reconciliation sweep failed: ${err.message}`, 'SCHEDULER');
  });

  // Interval sweep
  setInterval(() => {
    runPublishingSchedulerSweep().catch((err) => {
      logger.error(`Interval sweep failed: ${err.message}`, 'SCHEDULER');
    });
  }, intervalMs);
}
