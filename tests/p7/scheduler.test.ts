/**
 * Phase 7 regression: background scheduler idempotency + observability.
 * - Sweeping twice publishes each scheduled article exactly once; the EXECUTED
 *   publicationSchedule row with idempotencyKey makes repeats no-ops.
 * - The scheduler is observable: getSchedulerStatus exposes counts; the admin
 *   dashboard reflects real jobs (not placeholders) and bounded activity.
 *
 * NOTE: src/server/scheduler.ts must be imported dynamically AFTER the harness
 * set JSON_DB_PATH — the harness annotation in harness.ts applies to the whole
 * import graph.
 */
import { buildFixture, makeRequest, BuiltFixture } from './harness.ts';

export async function check(T: any) {
  const { runPublishingSchedulerSweep, getSchedulerStatus } = await import('../../src/server/scheduler.ts');
  const fx: BuiltFixture = await buildFixture();
  try {
    const { db, users, baseUrl, category } = fx;

    const scheduled = await db.article.create({
      data: {
        title: 'Scheduled Story', slug: 'p7-scheduled-story', excerpt: 'e', content: '<p>c</p>',
        coverImage: '', categoryId: category.id, authorId: users.reporter.id,
        status: 'SCHEDULED', scheduledFor: new Date(Date.now() - 5000).toISOString(),
      },
    });

    const run1 = await runPublishingSchedulerSweep();
    T.ok(run1.processed === 1 || run1.reconciled === 1, 'first sweep promotes the due article');
    const published = fx.readArticle(scheduled.id);
    T.eq(published.status, 'PUBLISHED', 'article is PUBLISHED after sweep');
    T.ok(published.publishedAt, 'publishedAt stamped');

    const executedRows = db.data.publicationSchedules.filter(
      (s: any) => s.idempotencyKey === `sched-pub-${scheduled.id}-${scheduled.version || 1}` && s.status === 'EXECUTED'
    );
    T.eq(executedRows.length, 1, 'exactly one EXECUTED schedule row written');

    // Event + audit written exactly once
    const events = db.data.editorialEvents.filter(
      (e: any) => e.articleId === scheduled.id && (e.eventType === 'AUTOMATED_PUBLISH' || e.eventType === 'RECONCILED_PUBLISH')
    );
    T.eq(events.length, 1, 'exactly one editorial event for automated publish');

    // Second sweep: no double-execution
    const run2 = await runPublishingSchedulerSweep();
    const executedRows2 = db.data.publicationSchedules.filter(
      (s: any) => s.idempotencyKey === `sched-pub-${scheduled.id}-${scheduled.version || 1}` && s.status === 'EXECUTED'
    );
    T.eq(executedRows2.length, 1, 're-sweep does NOT duplicate the schedule row');
    const events2 = db.data.editorialEvents.filter(
      (e: any) => e.articleId === scheduled.id && (e.eventType === 'AUTOMATED_PUBLISH' || e.eventType === 'RECONCILED_PUBLISH')
    );
    T.eq(events2.length, 1, 're-sweep does NOT duplicate the editorial event');

    // Idempotency even if statuses are mutated (PUBLISHED article skipped safely)
    const stale = await db.article.create({
      data: {
        title: 'Already Live', slug: 'p7-already-live', excerpt: 'e', content: '<p>c</p>',
        coverImage: '', categoryId: category.id, authorId: users.reporter.id,
        status: 'SCHEDULED', scheduledFor: new Date(Date.now() - 9_000).toISOString(),
      },
    });
    fx.readArticle(stale.id).status = 'PUBLISHED'; // manually pre-published
    const run3 = await runPublishingSchedulerSweep();
    T.ok(run3.processed === 0 && run3.reconciled === 0, 'same-article double promotion skipped');

    // ── observability on the dashboard ──
    const dash = await makeRequest(baseUrl, 'GET', '/api/admin/dashboard', undefined, users.admin.token);
    T.eq(dash.status, 200, 'dashboard 200');
    const daemonJob = dash.body.publicationJobs.find((j: any) => j.id === 'job-worker-01');
    T.ok(daemonJob, 'scheduler daemon job surfaced');
    T.ok(daemonJob.lastRun, 'job carries a lastRun timestamp');
    T.eq(dash.body.metrics.failedJobsCount, getSchedulerStatus().failedCount, 'failedJobsCount ties to real scheduler state');
    T.ok(Array.isArray(dash.body.recentEditorialActivity), 'activity feed present');
    T.ok(dash.body.recentEditorialActivity.length <= 8, 'activity feed bounded to 8 (no unbounded scan)');
    if (dash.body.recentEditorialActivity.length > 1) {
      const ts = dash.body.recentEditorialActivity.map((x: any) => new Date(x.timestamp).getTime());
      let sorted = true;
      for (let i = 1; i < ts.length; i++) if (ts[i - 1] < ts[i]) sorted = false;
      T.ok(sorted, 'activity feed is descending (newest first)');
    }
  } finally {
    await fx.close();
  }
}
