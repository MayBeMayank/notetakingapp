# Software Design Specification (SDS)

**Product:** Note Taking Application
**Project:** Claude Code · Spec-Driven Development assignment
**Status:** v1.0 — derived from FRS v1.0
**Document role:** Source of *technical* truth (the **HOW**). Schema, API contracts, and **HTTP status codes defined here are binding** — the Definition of Done requires implementation codes to match this document exactly, and `/review` checks against it. Business rules live in `FRS.md`.

---

## 1. Architecture overview

A **pnpm-workspace monorepo** with three packages and a strict dependency direction: `frontend` and `backend` both depend on `packages/shared`; nothing depends on `frontend`.

```
note-app/
├── backend/                # Node 22 + Express 5 + TS API
│   ├── src/
│   │   ├── routes/         # HTTP routing only
│   │   ├── controllers/    # request/response mapping, validation entry
│   │   ├── services/       # business logic (owns the FRS rules)
│   │   ├── repositories/   # Prisma data access
│   │   ├── middleware/     # auth, error handler, request-id
│   │   ├── lib/            # jwt, hashing, otp, tokens
│   │   └── prisma/         # schema.prisma, migrations, seed
│   └── tests/              # Vitest unit + Supertest integration
├── frontend/               # React 19 + Vite + TS SPA
│   └── src/
│       ├── pages/          # route-level screens
│       ├── features/       # auth, notes, tags, search, share, versions
│       ├── components/     # shadcn/ui-based building blocks
│       ├── api/            # TanStack Query hooks → backend
│       └── stores/         # Zustand client state
├── packages/shared/        # the ONLY home of cross-cutting types + Zod schemas
│   └── src/
│       ├── schemas/        # Zod validators (request/response)
│       └── types/          # types inferred from Zod
├── docs/                   # FRS.md, SDS.md, decisions/
├── openspec/               # specs / changes / archive / project.md
└── .claude/                # commands + agents
```

**Backend layering (one direction):** `routes → controllers → services → repositories → Prisma`. Controllers never touch Prisma; services never touch `req`/`res`. This keeps services unit-testable (Vitest) and routes integration-testable (Supertest).

**Shared-package rule (assignment Rule 11):** every request/response shape is a **Zod schema in `packages/shared`**, and TypeScript types are *inferred* from those schemas (`z.infer`). Neither `frontend` nor `backend` redefines a type that exists in shared.

---

## 2. Tech stack (versions pinned in package.json — Rule 20)

| Layer | Technology | Notes |
| --- | --- | --- |
| Runtime | Node.js 22 | LTS |
| Language | TypeScript (strict) | `strict: true`, no implicit any |
| Frontend | React 19, Vite, TanStack Query v5, Zustand, TipTap v2, shadcn/ui | TipTap stores content as JSON |
| Backend | Express 5 | async error handling enabled |
| ORM / DB | Prisma + PostgreSQL 16 | FTS via native tsvector |
| Auth | JWT (access 15 min) + opaque refresh token (7 days, hashed in DB) | |
| Validation | Zod (in `packages/shared`) | single source of schemas |
| Hashing | argon2id (passwords + OTP + refresh tokens) | |
| Testing | Vitest, Supertest, Playwright | one test per spec scenario, ≥ 80 % |
| Tooling | pnpm workspaces, ESLint, Husky, commitlint, Prism (mock) | |

> Exact patch versions are pinned in `package.json` and **verified against live docs via Context7 (Rule 9)** before use. This document deliberately does not invent patch numbers.

---

## 3. Data model (Prisma schema)

```prisma
// backend/src/prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id           String   @id @default(cuid())
  email        String   @unique          // stored lower-cased
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  notes         Note[]
  tags          Tag[]
  refreshTokens RefreshToken[]
  resetOtps     PasswordResetOtp[]
}

model RefreshToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String                         // argon2 hash of the opaque token
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([tokenHash])
}

model PasswordResetOtp {
  id         String    @id @default(cuid())
  userId     String
  codeHash   String                        // argon2 hash of the 6-digit OTP
  expiresAt  DateTime
  attempts   Int       @default(0)
  consumedAt DateTime?
  createdAt  DateTime  @default(now())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model Note {
  id          String    @id @default(cuid())
  userId      String
  title       String    @default("")
  contentJson Json                          // TipTap document
  contentText String    @default("")        // plaintext, derived on save, used by FTS
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?                      // soft delete (FRS-4.4)

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  tags     NoteTag[]
  versions NoteVersion[]
  shares   ShareLink[]

  // searchVector tsvector — GENERATED column added via raw SQL migration (see §7)
  @@index([userId, deletedAt, updatedAt])
}

model Tag {
  id        String   @id @default(cuid())
  userId    String
  name      String
  color     String                           // hex e.g. "#3B82F6"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  notes     NoteTag[]
  @@unique([userId, name])                   // case-insensitivity enforced by lower-casing on write
}

model NoteTag {
  noteId String
  tagId  String
  note   Note @relation(fields: [noteId], references: [id], onDelete: Cascade)
  tag    Tag  @relation(fields: [tagId],  references: [id], onDelete: Cascade)
  @@id([noteId, tagId])
  @@index([tagId])
}

model NoteVersion {
  id            String   @id @default(cuid())
  noteId        String
  versionNumber Int
  title         String
  contentJson   Json
  contentText   String
  createdAt     DateTime @default(now())
  note          Note     @relation(fields: [noteId], references: [id], onDelete: Cascade)
  @@unique([noteId, versionNumber])
  @@index([noteId, createdAt])
}

model ShareLink {
  id        String    @id @default(cuid())
  noteId    String
  token     String    @unique               // 32-byte base64url, unguessable
  expiresAt DateTime?                        // null = no expiry
  revokedAt DateTime?
  viewCount Int       @default(0)
  createdAt DateTime  @default(now())
  note      Note      @relation(fields: [noteId], references: [id], onDelete: Cascade)
  @@index([noteId])
}
```

**Tag case-insensitivity (FRS-5.3):** names are lower-cased before write so the `@@unique([userId, name])` constraint enforces case-insensitive uniqueness. (The display name may be stored separately if mixed case is desired; v1 stores normalized.)

---

## 4. Authentication design

**Passwords (FRS-3.1.4):** hashed with argon2id. Plaintext is never stored or logged.

**Access token (FRS-3.2.2):** JWT, HS256, 15-minute TTL. Claims: `sub` (userId), `iat`, `exp`. Sent as `Authorization: Bearer <jwt>`.

**Refresh token (FRS-3.2.2 / 3.3):** an opaque random 32-byte value returned to the client; only its **argon2 hash** is stored in `RefreshToken`. 7-day TTL. On `/refresh` the presented token is hashed and looked up; expired/unknown/revoked → 401. **Rotation:** each successful refresh revokes the old row and issues a new one. Logout sets `revokedAt`. Password reset revokes all of a user's refresh tokens (FRS-3.4.6).

**OTP (FRS-3.4):** 6-digit numeric, argon2-hashed in `PasswordResetOtp`, 10-minute TTL, single-use (`consumedAt`), `attempts` capped at 5 then invalidated. The code is **logged to the server console only** — no email is sent (FRS §10). `/forgot-password` returns an identical response whether or not the email exists (anti-enumeration, FRS-3.4.3).

**Auth middleware:** validates the access token, attaches `req.userId`, and returns **401** on any missing/invalid/expired token (FRS-3.3.4 / 9.2). Every route except those in §6.2 is behind it.

---

## 5. API conventions

- **Base path:** `/api`. Public share view lives under `/api/public`.
- **Auth:** all routes require a valid access token **except** register, login, refresh, forgot-password, reset-password, and the public share endpoint.
- **Success envelope:** resource endpoints return the resource directly; list endpoints return `{ "data": [...], "page": n, "limit": n, "total": n }`.
- **Error envelope (FRS-9.5):**
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "…", "fields": [ { "field": "password", "message": "…" } ] } }
  ```
  `fields` is present only for 400 validation errors.

### 5.1 Status code catalog (binding)

| Code | Meaning | When |
| --- | --- | --- |
| 200 | OK | successful read / update / list / login / refresh |
| 201 | Created | register, create note, create tag, create share |
| 204 | No Content | logout, soft-delete note, revoke share, delete tag |
| 400 | Bad Request | malformed input / failed validation → includes `fields[]` |
| 401 | Unauthorized | missing/invalid/expired access token; invalid login credentials; invalid/expired/revoked refresh token |
| 403 | Forbidden | authenticated but operation not permitted |
| 404 | Not Found | resource absent **or not owned by caller** (no existence leak, FRS-4.2.2); unknown share token |
| 410 | Gone | expired or revoked share link; share on a soft-deleted note (FRS-7.2/7.5/7.6) |
| 422 | Unprocessable Entity | business-rule conflict: duplicate email, duplicate tag name, invalid/expired OTP, restore past 30-day window, update of a deleted note |
| 429 | Too Many Requests | (reserved — rate limiting, not required in v1) |
| 500 | Internal Server Error | unexpected fault (generic body, no internals leaked) |

### 5.2 Pagination contract (FRS-9.6)

Query params `page` (default 1, min 1) and `limit` (default 20, min 1, max 100). Out-of-range values are clamped, not rejected. Response always reports `total`.

---

## 6. API contracts by domain

> Every row maps to one or more FRS acceptance criteria. Request/response bodies are the Zod schemas in `packages/shared`.

### 6.1 Auth — `/api/auth`

| Method | Path | Request | Success | Errors | FRS |
| --- | --- | --- | --- | --- | --- |
| POST | `/register` | `{ email, password }` | 201 `{ user }` | 400, 422 (dup email) | 3.1 |
| POST | `/login` | `{ email, password }` | 200 `{ accessToken, refreshToken, user }` | 400, 401 | 3.2 |
| POST | `/refresh` | `{ refreshToken }` | 200 `{ accessToken, refreshToken }` | 401 | 3.3.1–2 |
| POST | `/logout` ¹ | `{ refreshToken }` | 204 | 401 | 3.3.3 |
| POST | `/forgot-password` | `{ email }` | 200 `{ ok: true }` (always) | 400 | 3.4.1–3 |
| POST | `/reset-password` | `{ email, otp, newPassword }` | 200 `{ ok: true }` | 400, 422 (bad/expired OTP) | 3.4.4–6 |

> ¹ `/logout` requires a valid access token (`Authorization: Bearer <jwt>`). The service verifies that the presented `refreshToken` was issued to the authenticated user — mismatched ownership returns 401.

### 6.2 Public share — `/api/public` (no auth)

| Method | Path | Success | Errors | FRS |
| --- | --- | --- | --- | --- |
| GET | `/notes/:token` | 200 `{ title, content }` + atomic view-count increment | 404 (unknown), 410 (expired/revoked/note deleted) | 7.3, 7.4, 7.6, 7.8 |

### 6.3 Notes — `/api/notes` (auth)

| Method | Path | Request / Query | Success | Errors | FRS |
| --- | --- | --- | --- | --- | --- |
| POST | `/` | `{ title?, content?, tagIds? }` | 201 `{ note }` (+ initial version) | 400 | 4.1 |
| GET | `/` | `?page&limit&sort=updatedAt\|createdAt\|title&order=asc\|desc&tags=a,b&status=active\|trashed` | 200 `{ data, page, limit, total }` | 400 | 4.5, 4.4.2 |
| GET | `/:id` | — | 200 `{ note }` | 404 | 4.2 |
| PATCH | `/:id` | `{ title?, content?, tagIds? }` | 200 `{ note }` (+ new version) | 400, 404, 422 (if deleted) | 4.3 |
| DELETE | `/:id` | — | 204 (soft delete) | 404 | 4.4.1 |
| POST | `/:id/restore` | — | 200 `{ note }` | 404, 422 (past 30d) | 4.4.3 |

Tag associations (attach/detach, FRS-5.7) are set by passing `tagIds` on create/update; only the caller's own tags are accepted (others → 422).

### 6.4 Tags — `/api/tags` (auth)

| Method | Path | Request | Success | Errors | FRS |
| --- | --- | --- | --- | --- | --- |
| POST | `/` | `{ name, color }` | 201 `{ tag }` | 400, 422 (dup) | 5.2, 5.3 |
| GET | `/` | — | 200 `[ { ...tag, noteCount } ]` | — | 5.6 |
| PATCH | `/:id` | `{ name?, color? }` | 200 `{ tag }` | 400, 404, 422 (dup) | 5.4 |
| DELETE | `/:id` | — | 204 (associations removed, notes kept) | 404 | 5.4, 5.5 |

`noteCount` counts only active (non-deleted) notes (FRS-5.6).

### 6.5 Search — `/api/search` (auth)

| Method | Path | Query | Success | FRS |
| --- | --- | --- | --- | --- |
| GET | `/` | `?q&page&limit` | 200 `{ data: [ { noteId, title, snippet, rank } ], page, limit, total }` | 6.1–6.6 |

`snippet` contains `<mark>…</mark>` around matched terms (FRS-6.4). Empty/whitespace `q` → 200 with empty `data` (FRS-6.6).

### 6.6 Sharing (owner) — `/api/notes/:id/shares` & `/api/shares` (auth)

| Method | Path | Request | Success | Errors | FRS |
| --- | --- | --- | --- | --- | --- |
| POST | `/notes/:id/shares` | `{ expiresAt? }` | 201 `{ share }` (token, url, expiresAt, viewCount) | 404, 422 (note deleted) | 7.1, 7.2 |
| GET | `/shares` | — | 200 `[ { ...share, viewCount } ]` | — | 7.7 |
| DELETE | `/shares/:id` | — | 204 (revoke) | 404 | 7.5 |

### 6.7 Version history — `/api/notes/:id/versions` (auth)

| Method | Path | Success | Errors | FRS |
| --- | --- | --- | --- | --- |
| GET | `/` | 200 `[ { id, versionNumber, title, createdAt } ]` (reverse chrono) | 404 | 8.2 |
| GET | `/:versionId` | 200 `{ version with content }` | 404 | 8.3 |
| POST | `/:versionId/restore` | 200 `{ note }` (sets current + creates a **new** version) | 404 | 8.4 |

---

## 7. Full-text search design (Postgres native — FRS-6.2)

1. **Indexed text:** on every save the service derives `contentText` (plaintext) from the TipTap `contentJson`.
2. **Search vector:** a generated column added by raw SQL migration (Prisma's `Unsupported` type for the column):
   ```sql
   ALTER TABLE "Note" ADD COLUMN search_vector tsvector
     GENERATED ALWAYS AS (
       setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
       setweight(to_tsvector('english', coalesce("contentText",'')), 'B')
     ) STORED;
   CREATE INDEX note_search_idx ON "Note" USING GIN (search_vector);
   ```
3. **Query** (via `prisma.$queryRaw`, parameterized):
   ```sql
   SELECT id, title,
          ts_headline('english', "contentText", websearch_to_tsquery('english', $1),
            'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=5, MaxWords=18') AS snippet,
          ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
   FROM "Note"
   WHERE "userId" = $2 AND "deletedAt" IS NULL
     AND search_vector @@ websearch_to_tsquery('english', $1)
   ORDER BY rank DESC
   LIMIT $3 OFFSET $4;
   ```
   `websearch_to_tsquery` gives safe, user-friendly query parsing. Ownership + `deletedAt IS NULL` enforce FRS-6.5.

---

## 8. Sharing design

- **Token:** `crypto.randomBytes(32)` → base64url; stored unique. Public URL: `/s/:token` on the frontend, resolved through `GET /api/public/notes/:token`.
- **Atomic view count (FRS-7.4):** a single statement — `prisma.shareLink.update({ where: { id }, data: { viewCount: { increment: 1 } } })` — compiles to `SET view_count = view_count + 1`, safe under concurrency (no read-modify-write race).
- **Access guard:** resolve token → reject with **404** if unknown, **410** if `revokedAt` set, `expiresAt` passed, or the note is soft-deleted. Otherwise return current `title` + `contentJson` only (no tags, versions, owner — FRS-7.8).

---

## 9. Version history design

- **Snapshot on save (FRS-8.1):** create and each update insert a `NoteVersion` with the next `versionNumber` inside the same transaction as the note write.
- **Restore (FRS-8.4):** copy the chosen version's title/content onto the note, then create a **new** version capturing the result. History is append-only; nothing is overwritten.
- **Retention / purge (FRS-8.5):** after inserting a version, delete rows beyond the most recent 50 for that note (`ORDER BY versionNumber DESC OFFSET 50`). Current content is on `Note`, so purge never affects it.

---

## 10. Soft delete design (FRS-4.4)

- **Delete** sets `deletedAt = now()`; rows are never physically removed within the window (assignment Rule 15).
- **Exclusion:** the default note list, search, and tag counts all filter `deletedAt IS NULL`.
- **Restore** clears `deletedAt`; rejected with **422** if `now() - deletedAt > 30 days`.
- **Purge:** a scheduled job (cron-style, not a user endpoint) hard-deletes notes where `deletedAt < now() - 30 days` (FRS-4.4.4).

---

## 11. Validation strategy

Every endpoint validates its body/query against a Zod schema imported from `packages/shared`. The backend runs validation in a middleware/controller boundary and emits **400 + `fields[]`** on failure; the frontend reuses the same schemas for client-side validation, guaranteeing one definition (Rule 11).

---

## 12. Testing strategy

- **Unit (Vitest):** services in isolation (business rules, e.g. OTP attempt cap, version retention, AND tag filtering).
- **Integration (Supertest):** routes against a test Postgres DB; asserts exact status codes from §5.1.
- **E2E (Playwright, AB-1016):** full journey — register → create/edit note → tag → search → share → version restore.
- **Rule:** every FRS acceptance criterion / spec scenario maps to exactly one named test; **≥ 80 % coverage** on new code (Definition of Done).

---

## 13. Configuration & cross-cutting

**Environment:** `DATABASE_URL`, `JWT_SECRET`, `ACCESS_TOKEN_TTL=15m`, `REFRESH_TOKEN_TTL=7d`, `OTP_TTL=10m`, `PORT`. No secrets in code or logs (FRS-9.4).

**Error handling:** a central Express 5 error middleware maps known errors to the §5.1 codes and unknown errors to 500 with a generic body; it never serializes stack traces or secrets to clients.

**Request tracing:** each request gets an id, logged for debugging; OTPs/tokens/passwords are redacted.

---

## 14. Traceability — FRS → SDS

| FRS | Realized by |
| --- | --- |
| §3.1–3.4 Auth | §4 auth design + §6.1 contracts |
| §4.1–4.4 Notes/soft delete | §6.3 contracts + §9 versions + §10 soft delete |
| §4.5 List/sort/filter | §5.2 pagination + §6.3 query params |
| §5 Tags | §6.4 contracts + §3 schema (NoteTag, unique) |
| §6 Search | §7 FTS design + §6.5 contract |
| §7 Sharing | §8 sharing design + §6.2 / §6.6 contracts |
| §8 Versions | §9 version design + §6.7 contracts |
| §9 Cross-cutting | §4 auth middleware + §5 conventions + §11 validation + §13 |
