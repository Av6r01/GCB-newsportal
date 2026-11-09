# Acceptance Criteria - Global Chronicle News

This document defines testable acceptance criteria for each major feature and workflow in the platform.

## 1. Database & Backend API
- **AC-BE-01**: Prisma ORM connects successfully to the database and initializes all tables (`User`, `Category`, `Article`, `Comment`, `Poll`, `AuditLog`) without migration errors.
- **AC-BE-02**: `/api/articles` supports GET (with category filtering, search, and pagination), POST (create), PUT (update), and DELETE operations.
- **AC-BE-03**: Unauthorized requests to CMS or admin endpoints return a `401 Unauthorized` or `403 Forbidden` status.

## 2. Editorial CMS & Workflow
- **AC-CMS-01**: A journalist can create a new article draft, save it, and submit it for review. The article status updates to `REVIEW`.
- **AC-CMS-02**: An editor can view the review queue, inspect a draft article, and approve it (transitioning to `PUBLISHED` or `SCHEDULED`) or reject it back to `DRAFT`.
- **AC-CMS-03**: The AI Journalist Assistant successfully generates a concise summary and 3 alternative headlines when invoked in the article editor.

## 3. Public Portal & Reader Experience
- **AC-PUB-01**: The homepage loads within 2 seconds, displaying the breaking news ticker, hero lead story, trending sidebar, and category grids correctly.
- **AC-PUB-02**: Clicking an article navigates to `/article/[slug]`, rendering the full typography, author bio, audio TTS player, related articles, and comment thread.
- **AC-PUB-03**: Users can submit a comment on an article; pending comments appear correctly in the moderation queue.
- **AC-PUB-04**: Search bar queries return accurate article matches sorted by relevance or recency.

## 4. Quality & Compliance
- **AC-QA-01**: `compile_applet` and `lint_applet` execute with zero compilation errors or missing imports.
- **AC-QA-02**: The user interface is fully responsive across mobile (375px), tablet (768px), and desktop (1280px) viewports.
