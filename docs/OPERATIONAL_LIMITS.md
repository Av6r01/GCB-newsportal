# Operational Limits — Global Chronicle News

**Phase:** 8 (Public API Abuse Controls)
**Date:** 2026-11-08
**Scope:** per-endpoint limits, identity models, trusted-proxy configuration, TTS cost controls, abuse monitoring, and how to tune every value via environment variables.

All limits are implemented in `src/server/abuse.ts` (shared module) and wired in `server.ts`. Every number below is configurable via env (`src/configuration/env.ts`) — defaults are documented per section.

---

## 1. Limits table (per endpoint)

| Endpoint | Control | Default | Env var | Notes |
|---|---|---|---|---|
| `POST /api/comments` | rate limit | 5 / hour / IP | `COMMENTS_RATE_MAX`, `COMMENTS_RATE_WINDOW_MS` | Counts every attempt, including invalid payloads (fail-closed) |
| | payload bound | 2,000 chars content | `COMMENT_MAX_CONTENT_CHARS` | `authorName` ≤60, `authorEmail` ≤120 chars; control characters stripped |
| | honeypot | `website` field | — | Non-empty ⇒ silent 200 success, **no row created** |
| | duplicate content | same IP + same text | — | In-process registry (cap 50,000); repeat ⇒ silent 200, no row |
| | link-spam heuristic | ≥3 URLs, or URL/word ratio > 0.2 | — | Auto-routed to `SPAM` status bucket for editorial triage |
| `POST /api/reactions/:articleId` | rate limit | 20 / min / (IP, article) | `REACTIONS_RATE_MAX`, `REACTIONS_RATE_WINDOW_MS` | Different articles have independent buckets |
| | dedup cooldown | same (IP, article, type) within 10 min ⇒ idempotent 200 `{deduplicated:true}` | `REACTION_DEDUPE_COOLDOWN_MS` | Registry is only marked **after a successful write**; different reaction types are counted separately (documented identity model, §3) |
| `POST /api/polls/:id/vote` | rate limit | 10 / min / (IP, poll) | `POLLS_RATE_MAX`, `POLLS_RATE_WINDOW_MS` | Validation runs **before** identity burn — a malformed vote does not consume the voter identity (fixed bug, P8-D3) |
| | duplicate-vote control | one vote per poll per identity | — | `gcn_poll_voter` HttpOnly cookie token is primary; resolved IP is best-effort fallback (§2). Duplicate ⇒ 429 (kept for client compatibility) |
| `POST /api/ai/tts` | authentication | any authenticated role | — | Anonymous requests never reach the provider (401) |
| | input length | 5,000 chars | `TTS_MAX_CHARS` | Zod-bounded; `voice` is format-checked (`^[A-Za-z][A-Za-z-]{1,23}$`) |
| | daily quota | 30 / user / UTC day | `TTS_DAILY_QUOTA_PER_USER` (`0` = unlimited) | Counts **attempts**, including provider-unavailable 503s — protects spend when the provider recovers mid-day (§4) |
| | concurrency | 3 parallel provider calls | `TTS_MAX_CONCURRENT` | Overflow ⇒ 503 "busy" |
| | provider timeout | 20 s | `TTS_TIMEOUT_MS` | Timeout ⇒ 504 `{error, retryable:true}` |
| `POST /api/analytics/track` | rate limit | 60 / min / IP | `ANALYTICS_RATE_MAX`, `ANALYTICS_RATE_WINDOW_MS` | — |
| | event allowlist | 8 event types | — | `PAGE_VIEW, ARTICLE_VIEW, SHARE, CLICK, SEARCH, SUBSCRIBE, COMMENT, REACTION` |
| | metadata allowlist | 10 keys | `ANALYTICS_METADATA_MAX_BYTES` (1,024) | `articleId, path, referrer, sessionId, queryKey, shareChannel, optionIndex, searchTerm, sectionSlug, variant`; unknown keys silently dropped; string values ≤200 chars, control chars stripped; total budget enforced by dropping entries |
| `POST /api/newsletter/subscribe` | rate limit | 5 / hour / IP | `NEWSLETTER_RATE_MAX`, `NEWSLETTER_RATE_WINDOW_MS` | Email ≤254 chars, RFC-format checked; response is generic (no record echo) |
| `GET /api/admin/abuse-report` | authentication | `analytics:view` permission | — | Hashed-identity report only (§5) |
| `GET /api/comments` | list bound | default 100, max `MAX_PAGE_SIZE` | — | Public responses are structurally whitelisted: only `id, articleId, authorName, content, status, createdAt` leave the server; `authorEmail` and future internal fields can never leak by construction |
| `GET /api/comments/pending` | editorial queue | bounded by `parsePagination` (default 100) | — | `article:request_changes` permission required |
| All endpoints | body size | 100 kB JSON cap | express.json default | Oversized ⇒ 413 "Request body is too large." |

## 2. Request-body and error-shape guarantees

- **Malformed JSON** ⇒ 400 `{"error":"Malformed request body."}` — parser internals never leave the server.
- **Oversized body** ⇒ 413 `{"error":"Request body is too large."}`.
- **Validation failures** ⇒ 400 with a field-oriented generic message (`Invalid request: please review the "<field>" field.`) — never a raw Zod dump.
- **Unexpected errors** ⇒ 500 generic `{"error":"The request could not be completed. Please try again later."}` — `err.message` is never echoed publicly; full details go to the internal log.
- **Backend failure messages** (IntegrityError family, business rules) may surface to authenticated callers when they match a conservative pattern (uppercase-start, ≤120 chars, no braces/angle brackets).

## 3. Identity models (what each control actually guarantees)

| Feature | Primary identity | Fallback | What it does NOT guarantee |
|---|---|---|---|
| Rate limiting (all public endpoints) | resolved `req.ip` (socket address unless `TRUST_PROXY` configured) | — | Per-*person* limits behind large shared NAT/CGN networks |
| Poll duplicate voting | `gcn_poll_voter` HttpOnly cookie — random 32-hex token, 180-day max-age, issued in the same response as the first successful vote | Resolved IP (cookies disabled/scripts) | **Perfect identity.** Cookie-clearing/incognito users get a fresh identity; IP fallback collapses all users behind one proxy address |
| Reaction dedup | resolved IP + article + type | — | Per-person dedup — an IP can inflate *different* reaction types up to the rate limit; reactions are deliberately login-free and this is documented rather than over-claimed |
| Comment duplicate suppression | resolved IP + SHA-256 of content | — | Cross-restart suppression (in-process registry) or different-IP reposting |

**Poll policy statement (for ops/audit):** one vote per (poll, voter-token) and best-effort one per IP. Identity is NOT claimed to be deterministic — clearing cookies or switching networks is a fresh identity. A persistent production deployment should move (pollId, token) pairs and IP hashes into the database; the in-process registry matches the rest of the abuse controls and resets on restart.

## 4. TTS cost policy

1. `requireAuth` — no unauthenticated access; invalid/expired tokens never reach the provider.
2. Zod validation (text ≤ `TTS_MAX_CHARS`, `voice` format-checked) — malformed requests do not burn quota.
3. Quota consume (`ttsCostGuard.consume`) — **counts attempts**, including requests that later fail with provider-unavailable 503. Rationale: the quota exists to bound spend/abuse, and attempts—regardless of provider outcome—are what cost an attacker time; counting failures only would let an offline-provider day mask unlimited synchronized bursts at recovery time.
4. Provider presence check (503 "not available" when unconfigured).
5. Concurrency gate (`TTS_MAX_CONCURRENT`); waiters get 503 "busy", never a queue.
6. `Promise.race` against `TTS_TIMEOUT_MS`; timeout ⇒ 504 with `retryable:true`.
7. Quota-exhausted ⇒ 429 "Daily audio narration limit reached. Please try again tomorrow." + abuse-monitor record.
8. Provider failure ⇒ 502 generic "temporarily unavailable" — no provider/key names in the response.
9. Concurrency slot always released in `finally` (no leaks on timeout paths).

Access policy: any authenticated role (READER…SUPER_ADMIN) may narrate text within the per-request length and per-user daily quotas. There is no role bypass of the per-user caps (`TTS_DAILY_QUOTA_PER_USER=0` disables the cap entirely). Timeout behavior requires a live provider key and is covered by this document rather than unit-tested.

## 5. Trusted proxy configuration (`TRUST_PROXY`)

Rate limits and IP dedup key on Express `req.ip`. That value is the **socket address** unless Express is told to trust `X-Forwarded-For`.

| Deployment | `TRUST_PROXY` value | Behavior |
|---|---|---|
| Direct exposure (no reverse proxy) | unset (default) | `req.ip` = socket address; `X-Forwarded-For` **cannot** spoof identity. Safest. |
| One reverse proxy (nginx/Caddy/ALB/Cloudflare with origin lock) | `1` (also what `"true"` resolves to) | One hop of `X-Forwarded-For` is trusted; the client line is used |
| `N` chained proxies | e.g. `2` | Last `N` hops trusted |
| Mixed/proxy allowlist | comma list, e.g. `10.0.0.5, 10.0.0.6` | Passes through to `app.set('trust proxy', ...)` |

**Warnings**
- NEVER set `TRUST_PROXY=true` on a directly reachable host: Express would use the client-supplied header, letting attackers rotate fake IPs and reset every ratelimit/dedup bucket per request. The string `true` is therefore resolved to ONE hop (`1`), never "trust everything" — prefer explicit hop counts or IP lists.
- Values other than `true`/`false`/integer are passed to Express verbatim; malformed values will fail at boot (fail-fast), not silently.
- Behind Cloudflare this should be the origin-allowlisted hop count plus CF IPs if anything sits in front of the origin.

## 6. Abuse monitoring

- Every throttling, duplicate-vote, link-spam, and TTS-quota event is recorded in `abuseMonitor` keyed by route and by `sha256(identityKey)` truncated to 12 hex chars — **raw IPs, tokens, emails, and headers are never logged** in these records.
- Logging cadence: one WARN line on an identity's first trip per route, then every 25th repeat — correlates bursts without flooding logs.
- Operational inspection: `GET /api/admin/abuse-report` (permission `analytics:view`) returns `{ generatedAt, routes: [{ route, identities, topOffenders: [{ identityHash, count }] }] }`. Correlate `identityHash` with reverse-proxy/edge logs at incident time if a real address is needed — the app itself stores no raw identity.
- All monitor state is in-process and capped (64 routes × 5,000 identities): hostile floods cannot grow the memory footprint without bound, and restarts start a clean slate.

## 7. Tuning cheat-sheet

```bash
# comments tighter during a moderation incident
COMMENTS_RATE_MAX=2 COMMENTS_RATE_WINDOW_MS=3600000 npm start

# reactions: allow more activity + shorter dedup window
REACTIONS_RATE_MAX=60 REACTION_DEDUPE_COOLDOWN_MS=60000 npm start

# TTS tighter spend control
TTS_DAILY_QUOTA_PER_USER=10 TTS_MAX_CHARS=3000 TTS_MAX_CONCURRENT=2 TTS_TIMEOUT_MS=10000 npm start

# behind one reverse proxy
TRUST_PROXY=1 npm start
```

All env vars are Zod-validated at startup with sane defaults (`src/configuration/env.ts`); invalid values fail fast with a clear error instead of silently zeroing a limit.

## 8. Multi-instance caveat

Every limiter, dedup registry, vote registry, TTS guard, and the abuse monitor is **in-process**. Running N instances multiplies effective limits by N and splits dedup state (e.g. one vote per instance). For multi-replica production:

- front the public write routes with a shared edge/Redis limiter (Fastly/Cloudflare rules or `rate-limiter-flexible` + Redis),
- keep these in-process controls as a second layer — they remain correct per-instance and protect single-node deployments,
- the poll `(pollId, token)` set and comment-fingerprint set should move to the database (schema fields already exist for a future migration).
