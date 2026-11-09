# Global Chronicle News — Verified Project Conventions
**Last verified:** Phase 1 Baseline, 2026-10-24

## Stack (source-verified, not from README)
- **Frontend:** React 19 + Vite 8 + Tailwind 4 (SPA, client-side routing via App.tsx)
- **Backend:** Express 4 in `server.ts` (single file, ~1800 lines)
- **Database:** Custom JSON-file persistence in `src/lib/db.ts` → `data/database.json`
- **Auth:** JWT (jsonwebtoken), bcrypt, in-memory rate limiter + revocation set
- **AI:** Google Gemini SDK (`@google/genai`) — optional, server-side only
- **Media:** multer (memory storage) → local disk at `public/uploads/`
- **Prisma:** Schema exists at `prisma/schema.prisma` but is **NOT connected at runtime**.
  The `import { db as prisma } from './src/lib/db.ts'` alias points to the custom DB.
  Prisma client is never generated or used.

## Commands (all verified to run)
```bash
npm install --legacy-peer-deps   # required — react-twitter-embed conflicts with React 19
npm run lint                     # tsc --noEmit — type-check only, no ESLint
npm run dev                      # tsx server.ts — starts Express + Vite dev middleware
npm run build                    # vite build → dist/
npm run start                    # node server.ts (production, requires built dist/)
npm test                         # runs 7 test files sequentially via tsx
```

## Test files (run individually with `npx tsx tests/<name>.test.ts`)
- `bootstrap.test.ts` — config, logger, DB connection
- `integrity.test.ts` — referential integrity, slug uniqueness, revisions
- `authorization.test.ts` — permission matrix, rate limiter, token revocation
- `adminShell.test.ts` — dashboard aggregation
- `taxonomy.test.ts` — category/tag CRUD
- `articleEditor.test.ts` — article create/update
- `workflow.test.ts` — state machine, scheduler sweep

## Environment variables
```
PORT=3000
NODE_ENV=development|production
JWT_SECRET=<required in production; two different dev fallbacks exist — see P0-09>
GEMINI_API_KEY=<optional>
APP_URL=http://localhost:3000
DATABASE_URL=<unused at runtime — Prisma not wired>
```

## Key architectural facts
- DB is a single JSON file; all writes are synchronous `fs.writeFileSync`
- No transactions (the `$transaction` method just does `Promise.all`)
- `db.user` has NO `update()` method — user mutations in server.ts are in-memory only
- `data/database.json` only persists 6 collections on disk; others init empty at runtime
- Seed (`src/lib/seed.ts`) runs on every cold start with NO production guard
- Roles in permissions.ts: `SUPER_ADMIN ADMIN MANAGING_EDITOR SECTION_EDITOR COPY_EDITOR REPORTER PHOTOGRAPHER VIDEO_EDITOR ADVERTISING_MANAGER ANALYST READER`
- Roles in Prisma schema (unused): `ADMIN EDITOR JOURNALIST CONTRIBUTOR READER`
- Roles in seed data: `ADMIN JOURNALIST CONTRIBUTOR` — JOURNALIST and CONTRIBUTOR map to no runtime permissions
- Bangla default language configured in `src/lib/config.ts`; both BN and EN supported in `src/context/LanguageContext.tsx`

## Known defects summary (see docs/DEFECT_REGISTER.md for full detail)
- P0-01: Password reset doesn't persist (no db.user.update)
- P0-02: Role assignment doesn't persist
- P0-03: isActive change doesn't persist
- P0-04: JOURNALIST/CONTRIBUTOR roles have zero runtime permissions
- P0-05: Seed runs in production (no NODE_ENV guard)
- P0-06: GET /api/articles/:slug leaks unpublished articles publicly
- P0-07: /api/breaking-news routes registered twice (second set is dead)
- P0-08: Admin dashboard recentlyPublishedStories is always undefined
- P0-09: JWT secret mismatch between server.ts and authMiddleware.ts in dev
- P0-10: Revision restore has no permission check
- P0-11: SVG XSS filter incomplete

## Do not
- Run `prisma generate` or `prisma migrate` without explicit approval
- Call `npm audit fix --force` (will downgrade prisma to 7.x, breaking change)
- Delete `data/database.json` (live data)
- Run tests against the live database file without isolated test storage
