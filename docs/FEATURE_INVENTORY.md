# Feature Inventory - Global Chronicle News

This document provides a comprehensive inventory of all public pages, CMS administrative screens, and backend modules required for the platform.

## 1. Public Portal Pages & Views (P0 / P1)
1. **Homepage (`/`)**:
   - Top utility bar (Date, Weather, Currency/Stock Ticker, Edition switch).
   - Breaking News Ticker (animated marquee).
   - Main navigation header with logo, category links, search modal trigger, and user profile drawer.
   - Hero Section: Lead breaking news story with high-impact visual and summary.
   - Secondary Grid: 3-4 top stories across politics and world news.
   - Trending Sidebar: Ranked list (1 to 5) of most read articles.
   - Category Highlights: Dedicated rows for Business, Tech, Culture, and Opinion.
   - Interactive Widgets: Live Opinion Poll & Newsletter Subscription.
   - Footer: Sitemap, category links, copyright, and policy disclaimers.

2. **Category Feed Page (`/category/[slug]`)**:
   - Category header banner and description.
   - Filterable article grid (Latest, Most Popular, Editor's Pick).
   - Pagination controls.

3. **Article Detail Page (`/article/[slug]`)**:
   - Breadcrumb navigation (`Home > Politics > Article Title`).
   - Title, subtitle, author card with avatar, and publication timestamp.
   - Cover image with caption and photo credit.
   - Audio Narration Bar (Text-to-Speech simulation player).
   - Article body with rich typography, blockquotes, and inline images.
   - Social share bar (Facebook, Twitter, LinkedIn, Copy Link).
   - Author bio box and tag list.
   - Related stories recommendations (3 cards).
   - Interactive comment thread with reply form.

4. **Search Results Page (`/search?q=query`)**:
   - Search input query box with real-time suggestion filter.
   - Result count and matching article cards.
   - Date range and category filters.

## 2. Editorial CMS & Admin Dashboard (P0)
1. **Dashboard Overview (`/admin`)**:
   - Key metrics cards (Total Articles, Pending Review, Total Views, Active Comments).
   - Quick action buttons ("New Article", "Review Queue").
   - Recent publishing activity log.

2. **Article Management (`/admin/articles`)**:
   - Tabular view of all articles with filters (All, Draft, Review, Scheduled, Published).
   - Actions: Edit, Delete, Preview, Change Status.

3. **Article Editor (`/admin/articles/new` & `/admin/articles/[id]/edit`)**:
   - Title & Slug inputs.
   - Excerpt / Summary text area.
   - Rich-text editor for article body.
   - Category selector and priority toggles (Breaking, Featured).
   - Cover image URL / media selector.
   - Publication status & Schedule date picker.
   - **AI Journalist Assistant Panel**: Instant generation of AI summaries, headline suggestions, and translations.

4. **Category Manager (`/admin/categories`)**:
   - Add, edit, and delete news sections and categories.

5. **Comment Moderation (`/admin/comments`)**:
   - Review pending user comments; approve or reject.

6. **User Management (`/admin/users`)**:
   - View staff accounts, assign roles (ADMIN, EDITOR, JOURNALIST).

## 3. Backend API Modules (P0 / P1)
- `/api/auth`: Authentication and session management.
- `/api/articles`: CRUD operations, search, filtering, and view count incrementing.
- `/api/categories`: Category taxonomy endpoints.
- `/api/comments`: Comment submission and moderation endpoints.
- `/api/polls`: Active poll voting endpoints.
- `/api/ai`: Gemini SDK integration for text generation and summarization.
