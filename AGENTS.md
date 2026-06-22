# AGENTS.md — Note Taking Application

Single source of truth for all AI tools on this team. Derived from `docs/FRS.md` and `docs/SDS.md`.

---

## 1. Project Overview

A single-user-per-account note-taking API + SPA where authenticated users can create, organize, search, and share rich-text notes. Notes are private by default and exposed only through explicit, revocable public share links. Six functional domains: Authentication, Notes CRUD, Tags, Full-Text Search, Sharing, and Version History.

---

## 2. Repository Structure

```
note-app/
├── backend/src/
│   ├── routes/          # HTTP routing only — no logic
│   ├── controllers/     # request/response mapping, validation entry point
│   ├── services/        # business logic — owns all FRS rules
│   ├── repositories/    # Prisma data access only
│   ├── middleware/      # auth guard, error handler, request-id
│   ├── lib/             # jwt, argon2 hashing, otp, token utilities
│   └── prisma/          # schema.prisma, migrations, seed
├── backend/tests/       # Vitest unit + Supertest integration tests
├── frontend/src/
│   ├── pages/           # route-level screens
│   ├── features/        # auth, notes, tags, search, share, versions
│   ├── components/      # shadcn/ui-based reusable UI
│   ├── api/             # TanStack Query hooks → backend calls
│   └── stores/          # Zustand client state
├── packages/shared/src/
│   ├── schemas/         # ALL Zod validators (request + response shapes)
│   └── types/           # TypeScript types inferred from Zod (z.infer only)
├── docs/                # FRS.md (business truth), SDS.md (technical truth)
└── openspec/            # specs, changes, archive, project.md
```

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (LTS) |
| Language | TypeScript — `strict: true`, no implicit any |
| Frontend | React 19, Vite, TanStack Query v5, Zustand, TipTap v2, shadcn/ui |
| Backend | Express 5 (async error handling enabled) |
| ORM / DB | Prisma + PostgreSQL 16 (FTS via native tsvector) |
| Auth | JWT HS256 (15 min) + opaque refresh token (7 days, argon2-hashed in DB) |
| Validation | Zod — defined once in `packages/shared`, used by both frontend and backend |
| Hashing | argon2id — passwords, OTPs, and refresh tokens |
| Testing | Vitest (unit), Supertest (integration), Playwright (E2E) |
| Tooling | pnpm workspaces, ESLint, Husky, commitlint |

---

## 4. Key Commands

```bash
pnpm install                        # install all workspace dependencies
pnpm -w build                       # build all packages
pnpm -w test                        # run all tests (Vitest)
pnpm --filter backend test          # backend unit + integration tests only
pnpm --filter frontend test         # frontend tests only
pnpm --filter frontend e2e          # Playwright E2E tests
pnpm -w lint                        # ESLint across all packages
pnpm --filter backend dev           # backend dev server
pnpm --filter frontend dev          # Vite frontend dev server
pnpm --filter backend prisma migrate dev   # run DB migrations
pnpm --filter backend prisma db seed      # seed the database
```

---

## 5. Architecture Patterns

**Backend layering (strictly one direction):**
`routes → controllers → services → repositories → Prisma`
- Controllers never import Prisma directly.
- Services never touch `req`/`res` objects.
- This makes services unit-testable with Vitest and routes integration-testable with Supertest.

**Shared-package rule (non-negotiable):** Every request/response shape lives as a Zod schema in `packages/shared`. TypeScript types are inferred via `z.infer<>`. Neither `frontend` nor `backend` redefines a type that exists in shared.

**Frontend:** feature-sliced under `features/` (auth, notes, tags, search, share, versions). TanStack Query handles server state; Zustand handles client-only state.

---

## 6. Coding Standards

- **Naming:** camelCase for variables/functions, PascalCase for types/classes, kebab-case for file names.
- **Validation:** always use the shared Zod schema at the controller/middleware boundary. Emit `400 + fields[]` on failure. Never validate the same shape in two places.
- **Error responses** use the standard envelope (see §8). Services throw typed errors; the central Express error middleware maps them to HTTP codes.
- **No secrets in code or logs:** passwords, password hashes, OTPs, and tokens are never serialized to responses or log output.
- **Tag names** are lower-cased before write to enforce case-insensitive uniqueness at the DB constraint level.
- **TipTap content** is stored as `contentJson` (TipTap JSON document) and derived `contentText` (plaintext for FTS). Always update both on save.

---

## 7. Auth Approach

- **Passwords:** hashed with argon2id. Plaintext never stored or logged.
- **Access token:** JWT HS256, 15-minute TTL. Claims: `sub` (userId), `iat`, `exp`. Sent as `Authorization: Bearer <jwt>`.
- **Refresh token:** 32-byte random opaque value returned to client; only argon2 hash stored in `RefreshToken` table. 7-day TTL. Each successful refresh revokes the old row and issues a new one (rotation).
- **OTP (password reset):** 6-digit numeric, argon2-hashed in `PasswordResetOtp`, 10-minute TTL, single-use, 5-attempt cap then invalidated. Logged to server console only — no email sent.
- **Auth middleware:** validates access token, attaches `req.userId`, returns 401 on any failure.
- **Public routes (no token required):** register, login, refresh, forgot-password, reset-password, `GET /api/public/notes/:token`.

---

## 8. API Design Conventions

- **Base path:** `/api`. Public share view: `/api/public`.
- **Success envelope:** single resource → return it directly. Lists → `{ data: [...], page, limit, total }`.
- **Error envelope:**
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": [{ "field": "password", "message": "..." }] } }
  ```
  `fields` only present on 400.

**Status code catalog (binding — must match SDS exactly):**

| Code | When |
|---|---|
| 200 | successful read / update / list / login / refresh |
| 201 | register, create note, create tag, create share |
| 204 | logout, soft-delete note, revoke share, delete tag |
| 400 | validation failure (includes `fields[]`) |
| 401 | missing/invalid/expired token; bad login creds; bad refresh token |
| 403 | authenticated but not permitted |
| 404 | resource absent or not owned by caller (no existence leak) |
| 410 | expired or revoked share link; share on a soft-deleted note |
| 422 | business-rule conflict: dup email, dup tag, bad/expired OTP, restore past 30d, update deleted note |
| 500 | unexpected fault — generic body, no internals leaked |

**Pagination:** `?page` (default 1, min 1) and `?limit` (default 20, min 1, max 100). Out-of-range values are clamped, not rejected. Response always includes `total`.

---

## 9. DB Schema Summary

| Model | Key fields | Notes |
|---|---|---|
| `User` | `id` (cuid), `email` (unique, lower-cased), `passwordHash` | — |
| `RefreshToken` | `tokenHash`, `expiresAt`, `revokedAt` | argon2 hash only |
| `PasswordResetOtp` | `codeHash`, `expiresAt`, `attempts`, `consumedAt` | argon2 hash, max 5 attempts |
| `Note` | `userId`, `title`, `contentJson` (JSON), `contentText`, `deletedAt` | soft-delete via `deletedAt` |
| `Tag` | `userId`, `name`, `color` (hex) | unique `[userId, name]` |
| `NoteTag` | `[noteId, tagId]` composite PK | join table |
| `NoteVersion` | `noteId`, `versionNumber`, `title`, `contentJson`, `contentText` | max 50 per note, auto-purge |
| `ShareLink` | `token` (32-byte base64url, unique), `expiresAt?`, `revokedAt?`, `viewCount` | atomic increment via Prisma |

**FTS:** `Note` has a generated `tsvector` column (`search_vector`) added via raw SQL migration, indexed with GIN. Title weighted `A`, content weighted `B`. Queried with `websearch_to_tsquery`.

---

## 10. Testing Approach

- **Unit (Vitest):** services in isolation — business rules like OTP attempt cap, version retention (50-max), OR-semantics tag filtering.
- **Integration (Supertest):** HTTP routes against a real test PostgreSQL DB; asserts exact status codes from §5.1 of SDS.
- **E2E (Playwright):** full journey — register → create/edit note → tag → search → share → version restore.
- **Coverage:** ≥ 80% on new code (Definition of Done).
- **Traceability:** every FRS acceptance criterion maps to exactly one named test.
- **Location:** `backend/tests/` for backend; Playwright tests under `e2e/` or `frontend/tests/`.

---

## 11. Do NOT Do

- Do not send real emails — OTPs are logged to server console only.
- Do not store plaintext passwords, OTPs, or raw refresh tokens in the DB or logs.
- Do not define request/response types or Zod schemas outside `packages/shared`.
- Do not access Prisma from controllers or routes; use repositories.
- Do not touch `req`/`res` inside services; pass plain data in/out.
- Do not expose another user's data — every query must be scoped to `req.userId`.
- Do not leak a note's existence to a non-owner — return 404, not 403.
- Do not expose tags, version history, or owner identity through a public share link.
- Do not physically delete soft-deleted notes within the 30-day window.
- Do not rewrite version history — restore creates a new version, never overwrites.
- Do not build: real-time collab, file attachments, mobile app, OAuth, note folders, or admin roles.
- Do not use a read-modify-write pattern for `viewCount` — use Prisma's atomic `{ increment: 1 }`.

---

## 12. Shared Packages (`packages/shared`)

Everything in `packages/shared/src/` is the single authoritative source:

- **`schemas/`** — Zod schemas for every API request body, query params, and response shape. Both frontend (client-side validation) and backend (server-side validation middleware) import from here. Adding a new field means editing the schema here first.
- **`types/`** — TypeScript types derived exclusively via `z.infer<typeof SomeSchema>`. No hand-authored types that duplicate a schema definition.

Import pattern:
```ts
import { CreateNoteSchema, type CreateNoteInput } from '@note-app/shared/schemas/notes'
```
