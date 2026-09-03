---
name: CertEfficiency Architecture
description: Video storage tiers, R2 playback, Sarah/Hermes integration, DB schema, env vars, auth, and key production-readiness decisions
---

## Auth
- Stateless JWT in `localStorage` under `certefficiency_token`, sent as `Authorization: Bearer`
- SESSION_SECRET env var required in production (hard-fail guard added to `lib/auth.ts`)
- No cookies used; `credentials: true` in CORS is harmless but irrelevant for this app

## Frontend 401 handling
- Global `QueryCache.onError` in `App.tsx` clears localStorage token + redirects to `/auth/login` on 401
- Retry disabled on 401 errors in React Query config
- `ApiError` is exported from `@workspace/api-client-react` (was not exported before)

## Sarah/Hermes Integration

### Provider
- `SARAH_PROVIDER=tunnel` in production → uses `TunnelSarahService` in `lib/sarah/tunnel.ts`
- Cloudflare Tunnel at `SARAH_TUNNEL_URL` (certefficiency.certefficiency.com) with API key + HMAC signing

### Known failure mode: HTTP 530 (Cloudflare error code 1033)
- Means cloudflared tunnel is NOT connected to Hermes origin
- Requires restarting cloudflared/Hermes on the VM — NOT fixable in application code
- Health endpoint returns `"degraded"` on 530 (tunnel.ts `health()` returns `{ status: "degraded", message: "HTTP 530" }`)
- Dispatch marks job as `"failed"` with safeErrorCode `"tunnel_down"` and includes jobId ref in user-facing error

### Structured logging (message route pipeline)
Events emitted in order for a message send:
1. `sarah.message.requested` — route entry, with correlationId, userId, conversationId
2. `sarah.auth.completed` — auth middleware passed
3. `sarah.conversation.authorized` — ownership check passed
4. `sarah.persistence.started` — user message insert done
5. `sarah.job.created` — Sarah job row created, idempotencyKeyFingerprint (last 8 chars)
6. `sarah.dispatch.started` — async dispatch begins (response 201 already sent)
7. `sarah.dispatch.completed` — Hermes responded successfully, with elapsedMs
8. `sarah.persistence.completed` — assistant message saved to DB
9. `sarah.message.failed` — dispatch failed, with failureStage, safeErrorCode, httpStatus, elapsedMs

### Dispatch error UX
- When dispatch fails, a user-visible error message is inserted into the messages table
- For tunnel_down: "Sarah is temporarily unavailable. Please try again in a few minutes. (ref: <jobId last 8 chars>)"
- For other errors: "Sarah couldn't complete this response. Please try again. (ref: <jobId last 8 chars>)"

## Video Storage
- R2 credentials needed: CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET
- Without R2 creds, playback returns 503 with instructive error
- GCS fallback / HeyGen links possible for lessons 4-10

## CORS
- Production: `ALLOWED_ORIGINS=https://certefficiency.com,https://www.certefficiency.com` (Replit Secret)
- `parseAndValidateOrigins()` in app.ts rejects wildcards, HTTP, paths in entries
- Same-origin deployment: frontend and API on same domain in production → CORS not needed for real requests

## Env Vars Required in Production
- SESSION_SECRET (88 chars strong)
- SARAH_TUNNEL_URL, SARAH_API_KEY, SARAH_SIGNING_SECRET
- SARAH_PROVIDER=tunnel
- ALLOWED_ORIGINS
- NODE_ENV=production
- DATABASE_URL (via Replit postgres)
- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (via Stripe integration)

## Test Suite
- 117 tests in 4 describe blocks (sarah-integration.test.ts)
- Regression tests for 530 tunnel-down: 530-REG-1, 530-REG-2, 530-REG-3, 530-REG-4
- Tests in `"Sarah integration — Phase 21 requirements"` block (outer) need conversations router mounted
- Tests in `"Sarah health endpoint — inference status integration"` (inner) only have sarah router
