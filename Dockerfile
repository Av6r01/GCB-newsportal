# Global Chronicle News — app image (Phase 6B)
# The image ships the runtime plus the Prisma CLI so the same image can run
# `npm run db:migrate:deploy` as a one-shot sidecar (see docker-compose.yml).
# tsx is required at runtime: `npm start` runs `tsx server.ts` (Node cannot
# execute the server's non-erasable TypeScript directly).
FROM node:22-alpine AS runtime

WORKDIR /app

# Full dependency install (no --omit=dev): tsx (runtime) and the Prisma CLI
# (`npm run db:migrate:deploy`) are intentional production-sidecar tools.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps || npm install --no-audit --no-fund --legacy-peer-deps

COPY . .

# Generate the Prisma client into the image (API key of @prisma/client runtime)
RUN npx prisma generate

ENV NODE_ENV=production
ENV DB_DRIVER=postgres
EXPOSE 3000

# Startup is fail-closed: without a reachable, migrated PostgreSQL instance
# (fail with a clear config error) or without migrated schema the process
# exits — health check `wget /api/health` (compose below) offers liveness.
CMD ["npm", "start"]
