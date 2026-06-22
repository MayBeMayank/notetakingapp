# Project Context — Note Taking Application

## Product summary
Single-user-per-account note-taking API + SPA. Authenticated users create, organize, search, and share rich-text notes. Notes are private by default; sharing requires an explicit, revocable public link. Six functional domains: Authentication, Notes CRUD, Tags, Full-Text Search, Sharing, Version History.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (LTS) |
| Language | TypeScript — `strict: true`, no implicit any |
| Frontend | React 19, Vite, TanStack Query v5, Zustand, TipTap v2, shadcn/ui |
| Backend | Express 5 (async error handling enabled) |
| ORM / DB | Prisma + PostgreSQL 16 — FTS via native `tsvector` / GIN index |
| Auth | JWT HS256 (15 min access) + opaque refresh token (7 days, argon2-hashed in DB) |
| Validation | Zod — defined once in `packages/shared`, consumed by both frontend and backend |
| Hashing | argon2id — passwords, OTPs, refresh tokens |
| Testing | Vitest (unit), Supertest (integration), Playwright (E2E) |
| Tooling | pnpm workspaces, ESLint, Husky, commitlint |

## Repository layout
```
backend/src/
  routes/        # HTTP routing only
  controllers/   # req/res mapping, validation entry point
  services/      # business logic — owns all FRS rules
  repositories/  # Prisma data access only
  middleware/    # auth guard, error handler, request-id
  lib/           # jwt, argon2, otp, token utilities
  prisma/        # schema.prisma, migrations, seed
backend/tests/   # Vitest unit + Supertest integration
frontend/src/
  pages/         # route-level screens
  features/      # auth | notes | tags | search | share | versions
  components/    # shadcn/ui-based primitives
  api/           # TanStack Query hooks → backend
  stores/        # Zustand client-only state
packages/shared/src/
  schemas/       # ALL Zod validators (request + response)
  types/         # z.infer<> types — no hand-authored duplicates
docs/            # FRS.md (business truth), SDS.md (technical truth)
openspec/        # specs, changes, archive, project.md
```

## Architectural constraints

**Backend layering (non-negotiable, one direction):**
`routes → controllers → services → repositories → Prisma`
- Controllers never import Prisma.
- Services never touch `req`/`res`.

**Shared-package rule (non-negotiable):**
Every request/response shape is a Zod schema in `packages/shared`. Types are inferred via `z.infer<>`. Neither frontend nor backend redefines a shape that exists in shared.

**Frontend state split:**
- Server state → TanStack Query only.
- Client-only state → Zustand only.
- Never store API responses in Zustand.

## API conventions

- Base path: `/api`. Public share: `/api/public`.
- Success: single resource returned directly; lists as `{ data, page, limit, total }`.
- Error envelope: `{ "error": { "code": "…", "message": "…", "fields": […] } }` (`fields` on 400 only).
- Pagination: `?page` (default 1) + `?limit` (default 20, max 100); clamped, never rejected.

### Status code catalog (binding — never deviate)
| Code | When |
|---|---|
| 200 | read / update / list / login / refresh |
| 201 | register, create note/tag/share |
| 204 | logout, soft-delete note, revoke share, delete tag |
| 400 | validation failure → includes `fields[]` |
| 401 | bad/missing/expired token; bad credentials; bad refresh token |
| 403 | authenticated but not permitted |
| 404 | absent or not owned by caller (no existence leak) |
| 410 | expired/revoked share link; share on soft-deleted note |
| 422 | dup email, dup tag, bad/expired OTP, restore past 30 d, update deleted note |
| 500 | unexpected fault — generic body, no internals |

## Key business rules (binding — sourced from FRS)

- **Password policy:** ≥ 8 chars, ≥ 1 letter + 1 number.
- **OTP:** 6-digit, 10-min TTL, single-use, 5-attempt cap then invalidated. Logged to console only — no email sent.
- **Soft delete:** sets `deletedAt`; note recoverable for 30 days. Never physically deleted within window.
- **Tag filter semantics:** multi-tag filter = OR (note matches if it carries any supplied tag).
- **Share link:** serves note's current content, not a frozen snapshot.
- **Version retention:** max 50 per note; older auto-purged. Restore creates a new version — history is never rewritten.
- **Default note sort:** last-updated, descending.
- **viewCount:** atomic `{ increment: 1 }` — never read-modify-write.
- **Tag names:** lower-cased before write for case-insensitive uniqueness.
- **TipTap content:** always update `contentJson` and `contentText` together on every save.
- **Ownership:** every query scoped to `req.userId`; 404 (not 403) when resource absent or not owned.

## Auth public routes (no token required)
`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`,
`POST /api/auth/forgot-password`, `POST /api/auth/reset-password`,
`GET /api/public/notes/:token`

## Quality standards

- Lint: `pnpm -w lint` — zero errors before commit.
- Tests: `pnpm --filter backend test` + `pnpm --filter frontend test` — all green.
- Build: `pnpm -w build` — zero TypeScript errors.
- E2E: `pnpm --filter frontend e2e` — required for user-facing feature changes.
- Coverage: ≥ 80 % on new code.
- Every FRS acceptance criterion maps to exactly one named test.
- Never commit with `--no-verify`.

## Commit + branch conventions

**Commit format:** `<type>(<scope>): <summary under 72 chars>`
Types: `feat` | `fix` | `refactor` | `test` | `chore` | `docs`
Scopes: `auth` | `notes` | `tags` | `search` | `share` | `versions` | `shared` | `db` | `infra`

**Branch format:** `<type>/<scope>-<short-slug>` — branches off `main` only.

## Out of scope (do not build)
Real-time collaboration, file/image attachments, mobile app, OAuth/social login,
note folders/nesting, actual email sending.

## Build order (tickets)
AB-1001 (infra) → AB-1002–1003 (auth) → AB-1004–1005 (notes) → AB-1006 (tags) →
AB-1007 (search) → AB-1008 (sharing) → AB-1009 (versions) →
AB-1010–1015 (frontend) → AB-1016 (E2E)
