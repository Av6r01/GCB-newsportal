/**
 * Phase 7 regression: duplicate route detection.
 * - The detector flags a deliberate duplicate in a synthetic source.
 * - The real server.ts + src/server/*.ts zero duplicates (mechanical proof
 *   that the P0-07 duplicate-breaks-first-registration defect class stays out).
 */
import { scanRouteSource, findDuplicateRoutes, scanProjectRoutes } from '../../scripts/route-lint.ts';

export function check(T: any) {
  // 1. A synthetic duplicate IS detected
  const src = `
app.get('/api/breaking-news', async (_req, res) => { res.json([]); });
app.post('/api/breaking-news', requireAuth, async (req, res) => { res.json({}); });
app.put('/api/breaking-news/:id', async (req, res) => { res.json({}); });
// P0-07-style later re-registration — must be caught:
app.get('/api/breaking-news', async (_req, res) => { res.json(['shadowed']); });
app.delete('/api/articles/:id', async (req, res) => { res.json({}); });
app.delete('/api/articles/:slug', async (req, res) => { res.json({}); }); // same after :param normalization
`;
  const regs = scanRouteSource(src, 'fixture.ts');
  T.eq(regs.length, 6, 'scanner finds all 6 registrations');
  const dupes = findDuplicateRoutes(regs);
  T.eq(dupes.length, 2, 'both duplicate pairs are detected');
  T.eq(dupes[0].key, 'DELETE /api/articles/param2'.replace('param2', ':param'), 'normalized :param collapse detects shadowed delete');
  T.eq(dupes[1].key, 'GET /api/breaking-news', 'shadowed breaking-news GET detected');

  // 2. The real project has zero duplicates
  const project = scanProjectRoutes();
  const projectDupes = findDuplicateRoutes(project);
  T.eq(projectDupes.length, 0, `server.ts has zero duplicate routes (found ${projectDupes.length}: ${projectDupes.map(d => d.key).join(', ')})`);
  T.ok(project.length >= 60, `real route count sane (${project.length} registrations)`);
}
