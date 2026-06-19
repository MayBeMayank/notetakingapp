# AB-1001 — Project Setup: Monorepo, Prisma, Tooling

## Why

The application cannot be built without a functioning monorepo, a shared type
system, and a database schema in place. AB-1001 establishes the foundation that
every subsequent ticket depends on: pnpm workspace configuration, TypeScript
strict-mode compilation across all three packages, ESLint/Husky/commitlint
quality gates, the Prisma client with the full data model, Express 5 and
Vite/React 19 skeletons, and the `packages/shared` directory structure that
enforces the single-schema rule (AGENTS.md §5, SDS §1). Without this ticket,
no feature ticket can be started.

## What Changes

Covers **SDS §1** (architecture overview), **§2** (tech stack), and **§3**
(data model). No FRS behavioral requirements are implemented — this ticket is
infrastructure and project scaffolding only.

### In scope
- pnpm workspace (`backend`, `frontend`, `packages/shared`)
- TypeScript `strict: true` for all three packages
- ESLint + Husky pre-commit hook + commitlint conventional-commits gate
- Prisma schema with all 7 models per SDS §3
- `packages/shared/src/schemas/` and `types/` directory stubs (empty barrels)
- Express 5 backend skeleton (`app.ts`, `server.ts`, empty layer directories)
- React 19 + Vite frontend skeleton (standard template, empty feature folders)
- `.env.example` and `.env.test.example` for the backend
- `prisma/seed.ts` skeleton (no data inserted)
- Initial Prisma migration against developer's local Postgres

### Out of scope
- Raw SQL `tsvector` / GIN index migration — deferred to AB-1007
- Docker Compose — developers use their own running Postgres instance
- Any route, controller, service, or repository implementation — deferred to AB-1002+
- Any actual Zod schema content — stubs only; schemas populated by feature tickets
- Real-time collaboration, file attachments, OAuth (explicitly excluded, FRS §10)

## Capabilities

### New Capabilities
- `monorepo-scaffold`: pnpm workspace with TypeScript, ESLint, Husky, commitlint,
  Express 5 backend skeleton, and Vite/React 19 frontend skeleton
- `prisma-schema`: Prisma client configuration with all 7 data models defined
  exactly per SDS §3, plus an initial migration
- `shared-package`: `packages/shared` with Zod schema and types directory
  structure stubs, resolvable as `@note-app/shared` from backend and frontend

### Modified Capabilities
- (none — this is the first ticket)

## Impact

### API Delta
None — no endpoints are implemented in this ticket.

### DB Changes
Prisma schema defines all 7 models:
`User`, `RefreshToken`, `PasswordResetOtp`, `Note`, `Tag`, `NoteTag`,
`NoteVersion`, `ShareLink`.

An initial `prisma migrate dev --name init` creates the tables and all indexes
declared in the schema. No raw SQL additions yet (tsvector deferred).

### Affected layers
- All layers bootstrapped but empty of feature logic.
- `packages/shared` established as the cross-cutting dependency for both
  `backend` and `frontend`.
- `backend` can resolve `@note-app/shared` via pnpm workspace protocol.
- `frontend` can resolve `@note-app/shared` via pnpm workspace protocol.

### Key assumptions
- Developer has PostgreSQL 16 running locally and can populate `DATABASE_URL`
  in `.env` before running the migration.
- Node.js 22 LTS is installed.
- pnpm is installed globally.
