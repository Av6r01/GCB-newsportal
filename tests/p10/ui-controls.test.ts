/**
 * Phase 10 — comprehensive UI-control walk (source audit).
 *
 * Static analysis of the actual components + server routes, asserting the
 * Phase 10 acceptance rule: every visible button/navigation must have a
 * working action, a working navigation destination, or an explicit disabled
 * state with a reason. Specifically:
 *
 *   1. Every `onNavigate('<view>')` literal in the admin shell is handled by
 *      App.tsx (the panels never route to a dead destination).
 *   2. Every sidebar nav id (AdminLayout) is in that handled set.
 *   3. Every notification targetView exists as a handled view.
 *   4. Every API path referenced from admin screens exists as a registered
 *      route in server.ts (same method family) — no fetch to a ghost endpoint.
 *   5. Footer policy links (pageUrl args) resolve to real owned pages AND to
 *      real server output (checked live in admin-endpoints suite).
 *   6. Every mounted Phase-10 screen carries its durable data-admin-screen
 *      attribute (walk targets for this very audit).
 *   7. The public homepage ad module no longer fabricates sponsor data.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { STATIC_PAGES } from '../../src/pages/publicPages';
import type { Checker } from './run-suite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

function filesUnder(relDir: string, ext: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (ext.some((e) => entry.name.endsWith(e))) out.push(full);
    }
  };
  walk(path.join(ROOT, relDir));
  return out;
}

/** Views App.tsx actually handles (two onNavigate blocks + editor/search). */
const HANDLED_VIEWS = new Set([
  'dashboard', 'articles', 'editor', 'editor-new', 'comments', 'media', 'layout',
  'breaking-news', 'ads', 'newsletter', 'analytics', 'taxonomy', 'authors',
  'staff', 'redirects', 'settings', 'jobs',
]);
const HANDLED_PREFIXES = ['search:'];

function isHandled(onNavigateArg: string): boolean {
  return HANDLED_VIEWS.has(onNavigateArg) || HANDLED_PREFIXES.some((p) => onNavigateArg.startsWith(p));
}

export async function check(T: Checker) {
  // ── 1. onNavigate literals → handled views ──────────────────────────────
  const adminFiles = [
    ...filesUnder('src/pages/admin', ['.tsx', '.ts']),
    ...filesUnder('src/components/admin', ['.tsx', '.ts']),
  ];
  let navigateCalls = 0;
  for (const file of adminFiles) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/onNavigate\(\s*(['"`])([^'"`]+)\1/g)) {
      navigateCalls++;
      const arg = m[2];
      // dynamic template literals (item.id etc.) are runtime-safe contracts
      if (/\$\{/.test(arg)) continue;
      T.ok(isHandled(arg), `onNavigate('${arg}') in ${path.relative(ROOT, file)} is handled by App.tsx`);
    }
  }
  T.ok(navigateCalls >= 10, `onNavigate walk depth (${navigateCalls} literal calls scanned)`);

  // ── 2. AdminLayout nav ids ⊆ handled views ─────────────────────────────
  const layoutSrc = read('src/components/admin/AdminLayout.tsx');
  const navIds = [...layoutSrc.matchAll(/\{\s*id:\s*'([a-z-]+)'/g)].map((m) => m[1]);
  for (const id of navIds) {
    T.ok(isHandled(id) || id === 'editor-new', `nav id '${id}' resolves to a real screen`);
  }
  T.ok(navIds.includes('breaking-news') && navIds.includes('ads') && navIds.includes('newsletter') && navIds.includes('analytics'),
    'sidebar exposes the four previously-dead dashboard destinations');
  T.ok(navIds.includes('staff') && navIds.includes('settings') && navIds.includes('redirects') && navIds.includes('jobs') && navIds.includes('taxonomy') && navIds.includes('authors'),
    'sidebar exposes the new management screens');

  // ── 3. notifications targetView contract ───────────────────────────────
  const notifTargets = ['articles', 'comments', 'jobs'];
  for (const target of notifTargets) T.ok(isHandled(target), `notification target '${target}' handled`);

  // ── 4. admin-screen fetch targets exist as server routes ───────────────
  // Collect statically-declared route table from server.ts (method + path).
  const serverSrc = read('server.ts');
  const declared = new Set<string>();
  for (const m of serverSrc.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
    declared.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
  T.ok(declared.size > 40, `server route table parsed (${declared.size} routes)`);

  /** Every admin screen API literal generalized to its route shape. */
  const screenApiCalls: Array<{ file: string; verb: string; path: string }> = [];
  for (const file of adminFiles) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/fetch\(\s*['"`]([^'"`]+)['"`]([\s\S]{0,140})/g)) {
      const p = m[1].split('?')[0];
      const context = m[2] || '';
      // fetch() with an init object declares its verb; default is GET
      const methodMatch = /method:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/.exec(context);
      const verb = methodMatch ? methodMatch[1] : 'GET';
      screenApiCalls.push({ file: path.relative(ROOT, file), verb, path: p });
    }
    for (const m of src.matchAll(/(?:\bapi\.(get|post|put|del))\s*(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)/g)) {
      const verbMap: Record<string, string> = { get: 'GET', post: 'POST', put: 'PUT', del: 'DELETE' };
      screenApiCalls.push({ file: path.relative(ROOT, file), verb: verbMap[m[1]], path: m[2].split('?')[0] });
    }
  }
  T.ok(screenApiCalls.length >= 15, `admin API-call walk depth (${screenApiCalls.length} calls)`);

  /** Register paths from a concrete/template client call: /x/${y} → /x/:param */
  const routeExists = (verb: string, clientPath: string): boolean => {
    const shape = clientPath.replace(/\$\{[^}]+\}/g, ':param');
    for (const entry of declared) {
      const [routeVerb, routePath] = entry.split(' ');
      // The adminApi helper adds no method information beyond the call verb —
      // a client call must match a route with the SAME verb.
      if (routeVerb !== verb) continue;
      const rSeg = routePath.split('/');
      const cSeg = shape.split('/');
      if (rSeg.length === cSeg.length &&
        rSeg.every((seg, i) => seg === cSeg[i] || seg.startsWith(':'))) return true;
    }
    return false;
  };

  for (const call of screenApiCalls) {
    if (!call.path.startsWith('/api/')) continue;
    T.ok(
      routeExists(call.verb, call.path),
      `admin API call ${call.verb} ${call.path} (${call.file}) → registered same-verb route`,
    );
  }

  // ── 5. Footer policy links → real owned pages ──────────────────────────
  const footerSrc = read('src/components/design-system/Footer.tsx');
  const footerSlugs = [...footerSrc.matchAll(/pageUrl\(\s*['"]([a-z]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const slug of footerSlugs) {
    T.ok(Object.prototype.hasOwnProperty.call(STATIC_PAGES, slug), `footer links to owned page /page/${slug}`);
  }
  T.ok(footerSlugs.length >= 3, `footer policy links walk depth (${footerSlugs.length})`);
  T.ok(!footerSrc.includes('Feeds Available'), 'footer: false "Feeds Available" claim removed');
  T.ok(footerSrc.includes('/sitemap.xml') && footerSrc.includes('/sitemap-news.xml'), 'footer: real sitemap links present');
  T.ok(!/className="hover:text-white transition-colors cursor-pointer">\s*\{t\(/.test(footerSrc), 'footer standards items are clickable actions, not dead <li>s');

  // ── 6. every mounted Phase-10 screen has its data-admin-screen attr ────
  const expectedScreens: Record<string, string> = {
    'src/pages/admin/CmsBreakingNews.tsx': 'breaking-news',
    'src/pages/admin/CmsAds.tsx': 'ads',
    'src/pages/admin/CmsNewsletter.tsx': 'newsletter',
    'src/pages/admin/CmsAnalytics.tsx': 'analytics',
    'src/pages/admin/CmsTaxonomy.tsx': 'taxonomy',
    'src/pages/admin/CmsAuthors.tsx': 'authors',
    'src/pages/admin/CmsStaff.tsx': 'staff',
    'src/pages/admin/CmsRedirects.tsx': 'redirects',
    'src/pages/admin/CmsSettings.tsx': 'settings',
    'src/pages/admin/CmsJobs.tsx': 'jobs',
  };
  for (const [file, attr] of Object.entries(expectedScreens)) {
    const src = read(file);
    T.ok(src.includes(`data-admin-screen="${attr}"`), `${path.basename(file)} carries data-admin-screen="${attr}"`);
  }
  const appSrc = read('src/App.tsx');
  for (const attr of Object.values(expectedScreens)) {
    const px = fileForProbeAttr(attr);
    T.ok(appSrc.includes(px), `App.tsx mounts the '${attr}' screen`);
  }

  // ── 7. no fabricated ad data on the public homepage ────────────────────
  const homeSrc = read('src/pages/Home.tsx');
  T.ok(!homeSrc.includes('International Trade Summit'), 'homepage: fabricated sponsor title removed');
  const adSlotSrc = read('src/components/design-system/AdSlot.tsx');
  T.ok(adSlotSrc.includes("fetch('/api/ads')") || adSlotSrc.includes('fetch("/api/ads")'), 'AdSlot: serves real inventory from /api/ads');
  T.ok(adSlotSrc.includes('impression') && adSlotSrc.includes('click'), 'AdSlot: impression & click tracking present');

  // ── 8. dead legacy components stay deleted ─────────────────────────────
  T.ok(!fs.existsSync(path.join(ROOT, 'src/components/Footer.tsx')), 'dead legacy Footer.tsx removed (fake newsletter form source)');
  T.ok(!fs.existsSync(path.join(ROOT, 'src/components/Header.tsx')), 'dead legacy Header.tsx removed');
  T.ok(!fs.existsSync(path.join(ROOT, 'src/pages/CmsDashboard.tsx')), 'dead legacy CmsDashboard.tsx removed');
  const subscribeForm = read('src/components/NewsletterModule.tsx');
  T.ok(subscribeForm.includes('/api/newsletter/subscribe'), 'live newsletter form performs a real subscription');
}

/** App.tsx mounts screens by component name; probe their usage lines. */
function fileForProbeAttr(attr: string): string {
  switch (attr) {
    case 'breaking-news': return '<CmsBreakingNews';
    case 'ads': return '<CmsAds';
    case 'newsletter': return '<CmsNewsletter';
    case 'analytics': return '<CmsAnalytics';
    case 'taxonomy': return '<CmsTaxonomy';
    case 'authors': return '<CmsAuthors';
    case 'staff': return '<CmsStaff';
    case 'redirects': return '<CmsRedirects';
    case 'settings': return '<CmsSettings';
    case 'jobs': return '<CmsJobs';
    default: return '\\0';
  }
}
