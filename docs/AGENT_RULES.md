# Persistent Agent Rules & Project Guidelines

## Project Overview
A fully custom-coded, professional digital news publishing platform inspired by international and regional editorial standards (Al Jazeera, Somoy News, Kaler Kantho), featuring:
- Multi-category news (World, Politics, Business, Tech, Culture, Opinion, Sports, Environment)
- Live Breaking News Ticker & Live Blog coverage
- Editorial CMS & Admin Dashboard (Article creation, rich text editing, media management, review/approval workflow, scheduled publishing)
- Reader engagement (Comments, Polls, Bookmarks, Audio article text-to-speech / podcast player)
- AI-powered journalism tools (Headline suggestions, summary generation, translation, fact-checking assistance)
- Robust SEO, OpenGraph metadata, structured JSON-LD data, and PWA offline readiness

## Strict Technology & Architecture Rules
1. **Full Stack Architecture**: React (Vite) frontend with Express backend server (`server.ts`), supporting REST API endpoints, PostgreSQL / Prisma (or compatible robust SQL persistent storage layer), and secure authentication.
2. **Database & ORM**: PostgreSQL with Prisma ORM for relational article, category, comment, user, and audit log data.
3. **Editorial Workflow & CMS**: Complete role-based CMS (Admin, Editor, Journalist/Writer, Reader) with draft, review, scheduled, published, and archived states.
4. **No Placeholders or Mocks**: Real database operations, real API routes, real validations (Zod), and robust error handling.
5. **Design & UX**: Pristine typography, responsive layouts, light/dark mode, accessibility, and zero-pill discipline adhering to elite frontend design standards.
6. **Code Quality**: Strict TypeScript, modular separation of concerns, automated validation (`compile_applet`, `lint_applet`), and thorough error reporting.

## Phase Execution Checklist
- Phase 1: Documentation (`docs/AGENT_RULES.md`, initial plan & requirements gathering)
- Phase 2: Database Schema & Backend API Setup (Prisma, PostgreSQL, Express server routes for articles, users, comments, analytics, AI integration)
- Phase 3: Editorial CMS & Admin Dashboard (Article Editor, Workflow approval, Media manager, User management)
- Phase 4: Public News Portal & Reader Experience (Homepage with hero/featured grids, Category feeds, Article detail page with live blog & audio player, Interactive widgets)
- Phase 5: Advanced Features & Polish (AI news assistant tools, SEO/OpenGraph metadata, testing, and production build verification)
