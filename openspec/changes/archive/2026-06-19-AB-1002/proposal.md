# Proposal: AB-1002 — Auth: Register, Login, Logout, JWT + Refresh Token

## Why

The application has no way to authenticate users yet. Every downstream ticket (notes, tags, search, sharing, versions) depends on a verified `userId` being attached to each request. AB-1002 establishes the complete session lifecycle — creating accounts, issuing short-lived access tokens with a rotating refresh mechanism, and revoking sessions — so that AB-1003 (OTP reset) and all resource tickets have a working auth foundation to build on.

## What Changes

**In scope (FRS §3.1 – §3.3):**
- User registration (FRS-3.1.1 – 3.1.5)
- User login — JWT access token + opaque refresh token (FRS-3.2.1 – 3.2.3)
- Refresh token rotation (FRS-3.3.1 – 3.3.2)
- Logout / token revocation (FRS-3.3.3)
- Auth middleware — protects all non-public routes (FRS-3.3.4, 9.2)
- Shared Zod schemas for all request/response shapes

**Explicitly out of scope:**
- Forgot-password / OTP reset (AB-1003)
- Any resource endpoint beyond `/api/auth/*`
- OAuth, social login, email delivery

## Capabilities

### New Capabilities
- `user-auth`: Full session lifecycle — register, login, refresh, logout, and the JWT auth middleware that guards every protected route.

### Modified Capabilities
_(none)_

## Impact

### API Delta (from SDS §6.1)

| Method | Path | Request body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password }` | 201 `{ user: { id, email, createdAt } }` | 400 (validation), 422 (duplicate email) |
| POST | `/api/auth/login` | `{ email, password }` | 200 `{ accessToken, refreshToken, user: { id, email, createdAt } }` | 400, 401 (bad credentials) |
| POST | `/api/auth/refresh` | `{ refreshToken }` | 200 `{ accessToken, refreshToken }` | 401 (expired / revoked / unknown) |
| POST | `/api/auth/logout` | `{ refreshToken }` | 204 | 401 |
| All protected routes | — | `Authorization: Bearer <jwt>` | passes through | 401 (missing / invalid / expired) |

### DB Changes

No new tables — `User` and `RefreshToken` are already in the Prisma schema from AB-1001. No migration needed for this ticket.

### Affected layers

- `packages/shared/src/schemas/auth.ts` — Zod schemas (new)
- `backend/src/lib/` — `jwt.ts`, `hash.ts`, `token.ts` (new)
- `backend/src/repositories/auth.repository.ts` (new)
- `backend/src/services/auth.service.ts` (new)
- `backend/src/controllers/auth.controller.ts` (new)
- `backend/src/routes/auth.routes.ts` (new)
- `backend/src/middleware/auth.middleware.ts` (new)
- `backend/src/app.ts` — mount `/api/auth` router (modified)

### Key assumptions

- Multiple concurrent sessions are allowed; each login creates a new `RefreshToken` row without revoking prior ones.
- A revoked refresh token presented again returns 401 only — no full-session sweep.
- All 401 responses use a single `UNAUTHORIZED` error code regardless of the specific failure reason.
- User response shape is `{ id, email, createdAt }` — no `passwordHash`, no `updatedAt`.
- Email is lower-cased at registration (storage) and at login lookup (query).
