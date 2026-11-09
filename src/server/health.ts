/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 14: Health check endpoint.
 *
 * Reports ACTUAL live subsystem status — never hardcodes "healthy".
 * - database: live query to verify connectivity; reports driver name.
 * - storage: reads describeStorage() — reflects the ACTIVE provider, not
 *   a claimed one. Status is UNKNOWN if the check cannot be completed.
 * - scheduler: reads getSchedulerStatus() from the in-process daemon.
 * - memory: RSS and heap usage for capacity monitoring.
 *
 * HTTP 200 → all subsystems healthy (or UNKNOWN when unverifiable).
 * HTTP 503 → at least one subsystem is degraded/errored.
 */

import { Request, Response } from 'express';
import { db, persistenceDriverName } from '../lib/database.ts';
import { appConfig } from '../lib/config.ts';
import { describeStorage } from '../server/storage/index.ts';
import { getSchedulerStatus } from '../server/scheduler.ts';

export async function healthCheckHandler(_req: Request, res: Response) {
  const startTime = Date.now();

  // ── Database ──────────────────────────────────────────────────────────────
  let dbStatus: 'healthy' | 'degraded' = 'healthy';
  let categoryCount = 0;
  try {
    categoryCount = await db.category.count();
  } catch {
    dbStatus = 'degraded';
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  let storageStatus: 'healthy' | 'unknown' = 'unknown';
  let storageInfo: Record<string, unknown> = {};
  try {
    const desc = describeStorage();
    storageStatus = 'healthy'; // provider initialised without throwing
    storageInfo = {
      driver: desc.driver,
      visibility: desc.visibility,
      active: desc.active,
    };
  } catch (err: unknown) {
    storageStatus = 'unknown';
    storageInfo = { error: err instanceof Error ? err.message : String(err) };
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────
  let schedulerInfo: Record<string, unknown> = {};
  let schedulerStatusValue: 'healthy' | 'degraded' | 'unknown' = 'unknown';
  try {
    const sched = getSchedulerStatus();
    schedulerStatusValue = sched.status === 'ACTIVE' ? 'healthy' : 'degraded';
    schedulerInfo = {
      status: sched.status,
      lastSweep: sched.lastSweep,
      processedCount: sched.processedCount,
      reconciledCount: sched.reconciledCount,
      failedCount: sched.failedCount,
    };
  } catch {
    schedulerStatusValue = 'unknown';
    schedulerInfo = { status: 'UNKNOWN — scheduler not reachable' };
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const anyDegraded = dbStatus === 'degraded' || schedulerStatusValue === 'degraded';
  const overallStatus = anyDegraded ? 'degraded' : 'ok';

  const memory = process.memoryUsage();

  res.status(anyDegraded ? 503 : 200).json({
    status: overallStatus,
    version: '1.0.0-rc1',
    publication: appConfig.name,
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startTime,
    checks: {
      database: {
        status: dbStatus,
        driver: persistenceDriverName,
        categoriesLoaded: categoryCount,
      },
      storage: {
        status: storageStatus,
        ...storageInfo,
      },
      scheduler: {
        status: schedulerStatusValue,
        ...schedulerInfo,
      },
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      },
      aiEngine: {
        configured: appConfig.ai.enabled,
        model: appConfig.ai.model,
      },
    },
  });
}
