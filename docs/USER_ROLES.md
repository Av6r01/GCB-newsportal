# User Roles & Granular Permissions Matrix

To ensure editorial integrity, security, and strict separation of concerns, Global Chronicle News implements backend-enforced permissions across 10 specialized newsroom roles and public readers.

## 1. Role Definitions

1. **Super Administrator (`SUPER_ADMIN`)**:
   - Master account with full system governance.
   - Only role authorized to grant or revoke administrative roles (`SUPER_ADMIN`, `ADMIN`).
   - Configures global security parameters, audit retentions, and newsroom policies.

2. **Administrator (`ADMIN`)**:
   - Manages user accounts, active status toggles, newsroom taxonomy, and site configurations.
   - Enforces newsroom guidelines and audits editorial logs.

3. **Managing Editor (`MANAGING_EDITOR`)**:
   - Executive authority over all editorial desks.
   - Final publishing sign-off (`article:publish`) across all categories.
   - Approves revisions, schedules breaking dispatches, and oversees desk chiefs.

4. **Section Editor (`SECTION_EDITOR`)**:
   - Curates and directs assigned category bureaus (e.g. Politics, Business, Tech).
   - Approves and publishes stories within their news desk.
   - Requests revisions and assigns coverage tags.

5. **Copy Editor (`COPY_EDITOR`)**:
   - Reviews and edits drafts authored by staff reporters (`article:edit_any`).
   - Checks grammar, legal compliance, and style guide standards.
   - Explicitly prohibited from publishing articles directly (`article:publish` denied).

6. **Reporter / Staff Journalist (`REPORTER`)**:
   - Drafts original stories and investigative pieces (`article:create`, `article:edit_own`).
   - Submits dispatches for editorial review.
   - Strictly forbidden from editing drafts of other reporters (horizontal access isolation).

7. **Photographer (`PHOTOGRAPHER`)**:
   - Uploads and tags high-resolution photo assets (`media:upload`, `media:manage`).
   - Captions photo assets and manages photo essays.

8. **Video Editor (`VIDEO_EDITOR`)**:
   - Manages video dispatches, streaming embeds, and multimedia packages.

9. **Advertising Manager (`ADVERTISING_MANAGER`)**:
   - Manages commercial banner placements (`ad:manage`).
   - Views traffic metrics and impression analytics.
   - Strictly prohibited from altering editorial articles, categories, or user roles.

10. **Analyst (`ANALYST`)**:
    - Accesses readership metrics, trending reports, and audience analytics (`analytics:view`).
    - Strictly prohibited from creating, editing, or deleting articles.

11. **Reader (`READER`)**:
    - Public authenticated user entitled to submit verified comments and vote in live polls.

## 2. Enforcement Rules Summary
- **Backend Enforced**: All checks execute in Express route middleware (`requireAuth`, `requirePermission`, `requireStoryAccess`), never client-side only.
- **Horizontal Access Isolation**: Validates `article.authorId === req.user.id` unless the user possesses `article:edit_any`.
- **Privilege Escalation Protection**: Verified in middleware, rejecting attempts by non-super-admins to assign administrative permissions.
- **Rate-Limited Login**: 5 attempts per window before temporary lockouts.
