import React, { useState, useEffect } from 'react';
import { UtilityBar } from './components/design-system/UtilityBar';
import { BrandHeader } from './components/design-system/BrandHeader';
import { DesktopNav } from './components/design-system/DesktopNav';
import { MobileNav } from './components/design-system/MobileNav';
import { BreakingNewsBanner } from './components/design-system/BreakingNewsBanner';
import { SearchInterface } from './components/design-system/SearchInterface';
import { Footer } from './components/design-system/Footer';

import { AuthModal } from './components/AuthModal';
import { Home } from './pages/Home';
import { ArticleDetail } from './pages/ArticleDetail';
import { CategoryFeed } from './pages/CategoryFeed';
import { SearchResults } from './pages/SearchResults';
import { AdminLayout } from './components/admin/AdminLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminLogin } from './pages/admin/AdminLogin';
import { CmsArticles } from './pages/CmsArticles';
import { CmsArticleEditor } from './pages/CmsArticleEditor';
import { CmsComments } from './pages/CmsComments';
import { CmsMediaManager } from './pages/CmsMediaManager';
import { CmsHomepageManager } from './components/admin/CmsHomepageManager';
// Phase 10: functional completeness screens
import { CmsBreakingNews } from './pages/admin/CmsBreakingNews';
import { CmsAds } from './pages/admin/CmsAds';
import { CmsNewsletter } from './pages/admin/CmsNewsletter';
import { CmsAnalytics } from './pages/admin/CmsAnalytics';
import { CmsTaxonomy } from './pages/admin/CmsTaxonomy';
import { CmsAuthors } from './pages/admin/CmsAuthors';
import { CmsStaff } from './pages/admin/CmsStaff';
import { CmsRedirects } from './pages/admin/CmsRedirects';
import { CmsSettings } from './pages/admin/CmsSettings';
import { CmsJobs } from './pages/admin/CmsJobs';
import { hasPermission } from './modules/auth/permissions';
import { TopicPage } from './pages/TopicPage';
import { DateArchivePage } from './pages/DateArchivePage';
import { AuthorProfile } from './pages/AuthorProfile';
import { LatestPage } from './pages/LatestPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PublicPage } from './pages/PublicPage';
import { isStaticPageSlug } from './pages/publicPages';
import { BreadcrumbSegment } from './components/admin/AdminBreadcrumbs';

// Phase 9: REAL URLs — history router + one URL map for every internal link.
import { useRouter } from './router';
import { parseRoute, PublicRoute } from './routes';
import {
  homeUrl, articleUrl, categoryUrl, topicUrl, archiveUrl, authorUrl, searchUrl, cmsUrl,
} from './urls';
// Phase 12: Motion system
import { AnimatePresence, motion } from 'motion/react';
import { pageVariant } from './motionTokens';

export default function App() {
  // ── Routing (Phase 9): path is the single source of truth for public views ──
  const router = useRouter();
  const route: PublicRoute = parseRoute(router.state.path, router.state.query.toString());
  const { navigate } = router;

  // Handlers shared with every public view / nav component
  const goArticle = (slug: string) => navigate(articleUrl(slug));
  const goCategory = (slug: string, parentSlug?: string) =>
    navigate(parentSlug ? categoryUrl(slug, parentSlug) : categoryUrl(slug));
  const goHome = () => navigate(homeUrl());
  const goBack = goHome; // "back" affordance is a stable section link

  const [categories, setCategories] = useState<any[]>([]);
  const [breakingArticles, setBreakingArticles] = useState<any[]>([]);
  const [cmsSubView, setCmsSubView] = useState<
    'dashboard' | 'articles' | 'editor' | 'comments' | 'media' | 'layout'
    | 'breaking-news' | 'ads' | 'newsletter' | 'analytics' | 'taxonomy' | 'authors'
    | 'staff' | 'redirects' | 'settings' | 'jobs'
  >('dashboard');
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);

  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('gc_token'));
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    // Fetch categories & breaking ticker items
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setCategories(data);
      })
      .catch(() => {});

    fetch('/api/articles?limit=5')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setBreakingArticles(data);
      })
      .catch(() => {});

    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data.error) setUser(data);
          else {
            localStorage.removeItem('gc_token');
            setToken(null);
          }
        })
        .catch(() => {});
    }
  }, [token]);

  const handleLogout = () => {
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem('gc_token');
    setToken(null);
    setUser(null);
    goHome();
  };

  const handleAuthSuccess = (userData: any, authToken: string) => {
    localStorage.setItem('gc_token', authToken);
    setToken(authToken);
    setUser(userData);
  };

  // Compute dynamic CMS breadcrumbs
  const getBreadcrumbs = (): BreadcrumbSegment[] => {
    const crumbs: Record<string, string> = {
      articles: 'Articles & Queues',
      editor: editingArticleId ? 'Edit Dispatch' : 'New Dispatch',
      comments: 'Comment Moderation',
      media: 'Media Library',
      layout: 'Homepage Layout',
      'breaking-news': 'Breaking News',
      ads: 'Ad Slots',
      newsletter: 'Newsletter Subscribers',
      analytics: 'Analytics',
      taxonomy: 'Categories & Topics',
      authors: 'Author Profiles',
      staff: 'Staff Accounts',
      redirects: 'URL Redirects',
      settings: 'Site Settings',
      jobs: 'Publishing Pipeline',
    };
    const activeLabel = crumbs[cmsSubView] ?? 'Command Center';
    if (cmsSubView === 'dashboard') return [{ label: 'Command Center', active: true }];
    return [
      { label: 'Command Center', onClick: () => setCmsSubView('dashboard') },
      { label: activeLabel, active: true },
    ];
  };

  const isCms = route.kind === 'cms';

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] dark:bg-[#121212] text-[#1A1A1A] dark:text-[#E5E5E5] font-sans selection:bg-[#990000] selection:text-white">
      {/* Public Header Suite (shown when outside CMS) */}
      {!isCms && (
        <>
          <UtilityBar
            user={user}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenCms={() => navigate(cmsUrl())}
            onLogout={handleLogout}
          />

          <BrandHeader
            onOpenSearch={() => setSearchOverlayOpen(true)}
            onHomeClick={goHome}
          />

          <DesktopNav
            categories={categories}
            currentCategorySlug={route.kind === 'category' ? route.slug : null}
            onSelectCategory={(slug) => {
              if (slug) goCategory(slug);
              else goHome();
            }}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onOpenSearch={() => setSearchOverlayOpen(true)}
          />

          <BreakingNewsBanner
            articles={breakingArticles}
            onSelectArticle={goArticle}
          />
        </>
      )}

      {/* Main View Router — now PATH-driven (Phase 9): refresh, deep links and
          back/forward work; panel state above is only query-derivable data. */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={route.kind === 'article' ? `article-${(route as any).slug}` : route.kind}
            variants={pageVariant}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
        {route.kind === 'home' && (
          <Home
            onSelectArticle={goArticle}
            onSelectCategory={(slug) => goCategory(slug)}
          />
        )}

        {route.kind === 'article' && (
          <ArticleDetail
            slug={route.slug}
            onBack={goBack}
            onSelectCategory={(slug) => goCategory(slug)}
          />
        )}

        {route.kind === 'category' && (
          <CategoryFeed
            categorySlug={route.slug}
            onSelectArticle={goArticle}
            onBack={goBack}
          />
        )}

        {route.kind === 'latest' && (
          <LatestPage
            onSelectArticle={goArticle}
          />
        )}

        {route.kind === 'topic' && (
          <TopicPage
            tagSlug={route.tagSlug}
            onSelectArticle={goArticle}
            onBack={goBack}
          />
        )}

        {route.kind === 'archive' && (
          <DateArchivePage
            year={route.year}
            month={route.month || ''}
            onSelectArticle={goArticle}
            onBack={goBack}
          />
        )}

        {route.kind === 'author' && (
          <AuthorProfile
            authorId={route.authorId}
            onSelectArticle={goArticle}
            onBack={goBack}
          />
        )}

        {route.kind === 'search' && (
          <SearchResults
            query={route.query}
            onSelectArticle={goArticle}
            onBack={goBack}
          />
        )}

        {route.kind === 'page' && (isStaticPageSlug(route.slug) ? (
          <PublicPage
            slug={route.slug}
            onBack={goBack}
          />
        ) : (
          <NotFoundPage onHome={goHome} />
        ))}

        {route.kind === 'notfound' && (
          <NotFoundPage onHome={goHome} />
        )}

        {/* CMS Protected Route: Prompt login if unauthenticated */}
        {isCms && (!user || !token) && (
          <AdminLogin
            onSuccess={(userData, authToken) => handleAuthSuccess(userData, authToken)}
            onReturnToPortal={goHome}
          />
        )}

        {/* CMS Application Shell */}
        {isCms && user && token && (
          <AdminLayout
            user={user}
            token={token}
            currentSubView={cmsSubView}
            breadcrumbs={getBreadcrumbs()}
            onNavigate={(view) => {
              if (view === 'editor-new') {
                setEditingArticleId(null);
                setCmsSubView('editor');
              } else if (['dashboard', 'articles', 'comments', 'media', 'layout', 'breaking-news', 'ads', 'newsletter', 'analytics', 'taxonomy', 'staff', 'redirects', 'settings', 'jobs', 'authors'].includes(view)) {
                setEditingArticleId(null);
                setCmsSubView(view as any);
              } else if (view.startsWith('search:')) {
                navigate(searchUrl(view.replace('search:', '')));
              }
            }}
            onLogout={handleLogout}
            onReturnToPortal={goHome}
          >
            {cmsSubView === 'dashboard' && (
              <AdminDashboard
                token={token}
                onNavigate={(view, param) => {
                  if (view === 'editor-new') {
                    setEditingArticleId(null);
                    setCmsSubView('editor');
                  } else if (view === 'editor' && param) {
                    setEditingArticleId(param);
                    setCmsSubView('editor');
                  } else if (view === 'articles' || view === 'comments' || view === 'media' || view === 'layout' || view === 'breaking-news' || view === 'ads' || view === 'newsletter' || view === 'analytics') {
                    setEditingArticleId(null);
                    setCmsSubView(view as any);
                  }
                }}
              />
            )}

            {cmsSubView === 'articles' && (
              <CmsArticles
                token={token}
                onEditArticle={(id) => {
                  setEditingArticleId(id);
                  setCmsSubView('editor');
                }}
                onNewArticle={() => {
                  setEditingArticleId(null);
                  setCmsSubView('editor');
                }}
              />
            )}

            {cmsSubView === 'editor' && (
              <CmsArticleEditor
                token={token}
                articleId={editingArticleId}
                onBack={() => setCmsSubView('articles')}
              />
            )}

            {cmsSubView === 'comments' && (
              <CmsComments token={token} onBack={() => setCmsSubView('dashboard')} />
            )}

            {cmsSubView === 'media' && (
              <CmsMediaManager token={token} onBack={() => setCmsSubView('dashboard')} />
            )}

            {cmsSubView === 'layout' && (
              <CmsHomepageManager />
            )}

            {/* ── Phase 10: functional completeness screens ── */}
            {cmsSubView === 'breaking-news' && (
              <CmsBreakingNews token={token} />
            )}

            {cmsSubView === 'ads' && (
              <CmsAds token={token} />
            )}

            {cmsSubView === 'newsletter' && (
              <CmsNewsletter token={token} />
            )}

            {cmsSubView === 'analytics' && (
              <CmsAnalytics token={token} />
            )}

            {cmsSubView === 'taxonomy' && (
              <CmsTaxonomy token={token} />
            )}

            {cmsSubView === 'authors' && (
              <CmsAuthors token={token} currentUserId={user.id} />
            )}

            {cmsSubView === 'redirects' && (
              <CmsRedirects token={token} />
            )}

            {cmsSubView === 'jobs' && (
              <CmsJobs
                token={token}
                canPublish={hasPermission(user.role as any, 'article:publish')}
              />
            )}

            {cmsSubView === 'staff' && hasPermission(user.role as any, 'users:manage') && (
              <CmsStaff token={token} />
            )}

            {cmsSubView === 'settings' && hasPermission(user.role as any, 'settings:manage') && (
              <CmsSettings token={token} />
            )}
          </AdminLayout>
        )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Public Footer (shown when outside CMS) */}
      {!isCms && (
        <Footer
          onSelectCategory={(slug) => goCategory(slug)}
          onOpenCms={() => navigate(cmsUrl())}
          onOpenAuth={() => setAuthModalOpen(true)}
          onNavigate={(path) => navigate(path)}
        />
      )}

      {/* Mobile Navigation Drawer */}
      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        categories={categories}
        currentCategorySlug={route.kind === 'category' ? route.slug : null}
        onSelectCategory={(slug) => {
          if (slug) goCategory(slug);
          else goHome();
        }}
        onOpenSearch={() => setSearchOverlayOpen(true)}
        user={user}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenCms={() => navigate(cmsUrl())}
        onLogout={handleLogout}
      />

      {/* Search Overlay Drawer */}
      <SearchInterface
        isOpen={searchOverlayOpen}
        onClose={() => setSearchOverlayOpen(false)}
        onSelectArticle={goArticle}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}
